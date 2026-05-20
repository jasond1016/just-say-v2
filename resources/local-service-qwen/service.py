import asyncio
import base64
import json
import os
import time
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import torch
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

HOST = os.environ.get("JUSTSAY_LOCAL_SERVICE_HOST", "127.0.0.1")
PORT = int(os.environ.get("JUSTSAY_LOCAL_SERVICE_PORT", "8765"))
MODEL_NAME = os.environ.get("JUSTSAY_LOCAL_SERVICE_MODEL", "Qwen/Qwen3-ASR-1.7B")
RUNTIME_FAMILY = os.environ.get("JUSTSAY_LOCAL_SERVICE_RUNTIME_FAMILY", "qwen3-asr")
QWEN_BACKEND = os.environ.get("JUSTSAY_QWEN_BACKEND", "auto").strip().lower()
GPU_MEMORY_UTILIZATION = float(os.environ.get("JUSTSAY_QWEN_GPU_MEMORY_UTILIZATION", "0.8"))
MAX_MODEL_LEN = int(os.environ.get("JUSTSAY_QWEN_MAX_MODEL_LEN", "32768"))
MAX_NEW_TOKENS = int(os.environ.get("JUSTSAY_QWEN_MAX_NEW_TOKENS", "32"))
PUSH_MS = int(os.environ.get("JUSTSAY_QWEN_PUSH_MS", "500"))
END_OF_SPEECH_MS = int(os.environ.get("JUSTSAY_QWEN_END_OF_SPEECH_MS", "800"))
MAX_UTTERANCE_MS = int(os.environ.get("JUSTSAY_QWEN_MAX_UTTERANCE_MS", "15000"))
CHUNK_SIZE_SEC = float(os.environ.get("JUSTSAY_QWEN_CHUNK_SIZE_SEC", "1.0"))
UNFIXED_CHUNK_NUM = int(os.environ.get("JUSTSAY_QWEN_UNFIXED_CHUNK_NUM", "4"))
UNFIXED_TOKEN_NUM = int(os.environ.get("JUSTSAY_QWEN_UNFIXED_TOKEN_NUM", "5"))
VAD_THRESHOLD = float(os.environ.get("JUSTSAY_QWEN_VAD_THRESHOLD", "0.5"))
VAD_WINDOW_SAMPLES = 512

CAPABILITIES = {
    "streaming": True,
    "translation": False,
    "wordTiming": False,
    "speakerSeparation": False,
    "requiresNetwork": False,
    "requiresLocalService": True,
}


class QwenRuntime:
    def __init__(self, model_name: str) -> None:
        self.model_name = model_name
        self.model: Any | None = None
        self.backend = "uninitialized"
        self.error: str | None = None

    @property
    def ready(self) -> bool:
        return self.model is not None and self.error is None

    @property
    def supports_native_streaming(self) -> bool:
        return self.backend == "vllm"

    def prewarm(self) -> None:
        if self.ready:
            return

        try:
            from qwen_asr import Qwen3ASRModel

            backend = resolve_qwen_backend()
            self.backend = backend

            if backend == "vllm":
                self.model = Qwen3ASRModel.LLM(
                    model=self.model_name,
                    gpu_memory_utilization=GPU_MEMORY_UTILIZATION,
                    max_model_len=MAX_MODEL_LEN,
                    max_new_tokens=MAX_NEW_TOKENS,
                )
            else:
                self.model = Qwen3ASRModel.from_pretrained(
                    self.model_name,
                    device_map=resolve_transformers_device_map(),
                    torch_dtype=resolve_transformers_dtype(),
                    trust_remote_code=True,
                    max_inference_batch_size=1,
                    max_new_tokens=MAX_NEW_TOKENS,
                )
            self.error = None
        except Exception as exc:  # pragma: no cover - depends on runtime environment
            self.model = None
            self.error = str(exc)
            raise

    def create_stream_state(self) -> Any:
        if not self.model:
            raise RuntimeError(self.error or "Qwen runtime is not prewarmed")

        if self.backend != "vllm":
            return {"backend": self.backend}

        return self.model.init_streaming_state(
            unfixed_chunk_num=UNFIXED_CHUNK_NUM,
            unfixed_token_num=UNFIXED_TOKEN_NUM,
            chunk_size_sec=CHUNK_SIZE_SEC,
        )

    def streaming_transcribe(self, samples: np.ndarray, state: Any) -> str:
        if not self.model:
            raise RuntimeError(self.error or "Qwen runtime is not prewarmed")

        self.model.streaming_transcribe(samples.astype(np.float32, copy=False), state)
        return extract_state_text(state)

    def finish_streaming_transcribe(self, state: Any) -> str:
        if not self.model:
            raise RuntimeError(self.error or "Qwen runtime is not prewarmed")

        self.model.finish_streaming_transcribe(state)
        return extract_state_text(state)

    def transcribe(self, samples: np.ndarray, language: str) -> str:
        if not self.model:
            raise RuntimeError(self.error or "Qwen runtime is not prewarmed")

        if samples.size == 0:
            return ""

        results = self.model.transcribe(
            audio=(samples.astype(np.float32, copy=False), 16000),
            language=normalize_runtime_language(language),
        )

        if not results:
            return ""

        text = getattr(results[0], "text", "")
        return text if isinstance(text, str) else ""


class SileroRuntime:
    def __init__(self) -> None:
        self.model: Any | None = None
        self.iterator_factory: Any | None = None
        self.error: str | None = None

    @property
    def ready(self) -> bool:
        return self.model is not None and self.iterator_factory is not None and self.error is None

    def prewarm(self) -> None:
        if self.ready:
            return

        try:
            from silero_vad import VADIterator, load_silero_vad

            self.model = load_silero_vad()

            def create_iterator() -> Any:
                return VADIterator(
                    self.model,
                    sampling_rate=16000,
                    threshold=VAD_THRESHOLD,
                    min_silence_duration_ms=END_OF_SPEECH_MS,
                    speech_pad_ms=0,
                )

            self.iterator_factory = create_iterator
            self.error = None
        except Exception as exc:  # pragma: no cover - depends on runtime environment
            self.model = None
            self.iterator_factory = None
            self.error = str(exc)
            raise

    def create_iterator(self) -> Any:
        if not self.iterator_factory:
            raise RuntimeError(self.error or "Silero VAD is not prewarmed")

        return self.iterator_factory()

    def update(self, iterator: Any, samples: np.ndarray) -> tuple[bool, bool]:
        if samples.size == 0:
            return False, False

        speech_started = False
        speech_ended = False
        sample_count = samples.shape[0]
        cursor = 0

        while cursor + VAD_WINDOW_SAMPLES <= sample_count:
            vad_input = torch.from_numpy(
                samples[cursor : cursor + VAD_WINDOW_SAMPLES].astype(np.float32, copy=False)
            )
            event = iterator(vad_input, return_seconds=False)

            if isinstance(event, dict):
                speech_started = speech_started or "start" in event
                speech_ended = speech_ended or "end" in event

            cursor += VAD_WINDOW_SAMPLES

        return speech_started, speech_ended


@dataclass
class SourceState:
    block_index: int = 0
    started_at: int | None = None
    last_updated_at: int = 0
    last_text: str = ""
    utterance_samples: list[np.ndarray] = field(default_factory=list)
    push_buffer: list[np.ndarray] = field(default_factory=list)
    vad_buffer: np.ndarray = field(default_factory=lambda: np.zeros((0,), dtype=np.float32))
    stream_state: Any | None = None
    vad_iterator: Any | None = None
    speaking: bool = False

    def begin_utterance(
        self,
        runtime: QwenRuntime,
        timestamp: int,
        vad_runtime: SileroRuntime | None = None,
    ) -> None:
        self.stream_state = runtime.create_stream_state()
        if vad_runtime is not None and self.vad_iterator is None:
            self.vad_iterator = vad_runtime.create_iterator()
        self.started_at = timestamp
        self.last_updated_at = timestamp
        self.last_text = ""
        self.utterance_samples.clear()
        self.push_buffer.clear()
        self.speaking = True

    def append(self, chunk: np.ndarray, timestamp: int) -> None:
        self.utterance_samples.append(chunk)
        self.push_buffer.append(chunk)
        self.last_updated_at = timestamp
        if self.started_at is None:
            self.started_at = timestamp

    def utterance_duration_ms(self) -> int:
        total_samples = sum(chunk.shape[0] for chunk in self.utterance_samples)
        return int(total_samples / 16)

    def should_push(self) -> bool:
        total_samples = sum(chunk.shape[0] for chunk in self.push_buffer)
        return total_samples >= PUSH_MS * 16

    def take_push_buffer(self) -> np.ndarray:
        if not self.push_buffer:
            return np.zeros((0,), dtype=np.float32)

        combined = np.concatenate(self.push_buffer).astype(np.float32, copy=False)
        self.push_buffer.clear()
        return combined

    def concatenate_utterance(self) -> np.ndarray:
        if not self.utterance_samples:
            return np.zeros((0,), dtype=np.float32)

        return np.concatenate(self.utterance_samples).astype(np.float32, copy=False)

    def clear(self) -> None:
        self.started_at = None
        self.last_updated_at = 0
        self.last_text = ""
        self.utterance_samples.clear()
        self.push_buffer.clear()
        self.vad_buffer = np.zeros((0,), dtype=np.float32)
        self.stream_state = None
        self.vad_iterator = None
        self.speaking = False


@dataclass
class SessionState:
    session_id: str
    mode: str
    language: str
    translation_enabled: bool
    sources: dict[str, SourceState] = field(default_factory=dict)

    def source_state(self, source: str) -> SourceState:
        state = self.sources.get(source)
        if state is None:
            state = SourceState()
            self.sources[source] = state
        return state


class JustSayQwenService:
    def __init__(self, runtime: QwenRuntime, vad_runtime: SileroRuntime) -> None:
        self.runtime = runtime
        self.vad_runtime = vad_runtime
        self.sessions: dict[str, SessionState] = {}

    async def handle_connection(self, websocket: Any) -> None:
        try:
            async for raw_message in websocket:
                message = json.loads(raw_message)
                await self.handle_message(websocket, message)
        except ConnectionClosed:
            return

    async def handle_message(self, websocket: Any, message: dict[str, Any]) -> None:
        message_type = message.get("type")

        if message_type == "health-check":
            await websocket.send(json.dumps(self.build_health_payload()))
            return

        if message_type == "prewarm":
            await self.handle_prewarm(websocket)
            return

        if message_type == "start-session":
            if not self.runtime.ready or not self.vad_runtime.ready:
                await websocket.send(
                    json.dumps(
                        {
                            "type": "error",
                            "payload": {
                                "code": "E_ENGINE_UNAVAILABLE",
                                "message": "Qwen runtime is not ready. Run Check / Load before starting recognition.",
                                "retryable": True,
                                "detail": self.build_health_payload().get("detail", {}),
                            },
                        }
                    )
                )
                return

            session = SessionState(
                session_id=message["sessionId"],
                mode=message["mode"],
                language=message["language"],
                translation_enabled=bool(message.get("translationEnabled")),
            )
            self.sessions[session.session_id] = session
            await websocket.send(
                json.dumps({"type": "session-ready", "sessionId": session.session_id})
            )
            if session.translation_enabled:
                await websocket.send(
                    json.dumps(
                        {
                            "type": "warning",
                            "sessionId": session.session_id,
                            "payload": {
                                "code": "W_TRANSLATION_DISABLED",
                                "message": "Cloud translation is disabled for the local Qwen service.",
                                "recoverable": True,
                            },
                        }
                    )
                )
            return

        if message_type == "audio-chunk":
            session = self.sessions.get(message["sessionId"])
            if not session:
                return

            await self.handle_audio_chunk(websocket, session, message["chunk"])
            return

        if message_type == "stop-session":
            session = self.sessions.pop(message["sessionId"], None)
            if session:
                await self.finalize_session(websocket, session)
                await websocket.send(
                    json.dumps({"type": "session-ended", "sessionId": session.session_id})
                )
            return

        if message_type == "abort-session":
            self.sessions.pop(message["sessionId"], None)
            await websocket.send(
                json.dumps({"type": "session-ended", "sessionId": message["sessionId"]})
            )

    async def handle_prewarm(self, websocket: Any) -> None:
        try:
            await asyncio.to_thread(self.runtime.prewarm)
            await asyncio.to_thread(self.vad_runtime.prewarm)
        except Exception:  # pragma: no cover - depends on runtime environment
            await websocket.send(json.dumps(self.build_health_payload()))
            return

        await websocket.send(
            json.dumps(
                {
                    "type": "prewarm-complete",
                    "runtimeFamilyId": RUNTIME_FAMILY,
                    "modelIdentifier": self.runtime.model_name,
                }
            )
        )

    async def handle_audio_chunk(
        self, websocket: Any, session: SessionState, chunk: dict[str, Any]
    ) -> None:
        source = chunk["source"]
        timestamp = int(chunk["timestamp"])
        samples = decode_chunk(chunk["dataBase64"])
        source_state = session.source_state(source)

        if session.mode == "ptt":
            if source_state.stream_state is None:
                source_state.begin_utterance(self.runtime, timestamp)
            source_state.append(samples, timestamp)
            await self.maybe_emit_streaming_draft(websocket, session, source, source_state)
            return

        if source_state.vad_iterator is None:
            source_state.vad_iterator = self.vad_runtime.create_iterator()

        vad_samples = np.concatenate([source_state.vad_buffer, samples]).astype(np.float32, copy=False)
        complete_sample_count = (vad_samples.shape[0] // VAD_WINDOW_SAMPLES) * VAD_WINDOW_SAMPLES
        source_state.vad_buffer = vad_samples[complete_sample_count:]

        speech_started = False
        speech_ended = False
        if complete_sample_count > 0:
            speech_started, speech_ended = self.vad_runtime.update(
                source_state.vad_iterator,
                vad_samples[:complete_sample_count],
            )

        if speech_started and source_state.stream_state is None:
            source_state.begin_utterance(self.runtime, timestamp, self.vad_runtime)

        if source_state.stream_state is None:
            return

        source_state.append(samples, timestamp)
        await self.maybe_emit_streaming_draft(websocket, session, source, source_state)

        if speech_ended:
            await self.emit_commit(websocket, session, source, source_state)
            return

        if source_state.utterance_duration_ms() >= MAX_UTTERANCE_MS:
            await self.emit_commit(websocket, session, source, source_state)

    async def maybe_emit_streaming_draft(
        self, websocket: Any, session: SessionState, source: str, source_state: SourceState
    ) -> None:
        text = await self.consume_push_buffer(source_state, session.language)
        if not text:
            return

        stable_text, preview_text = split_stable_preview(source_state.last_text, text)
        if stable_text == source_state.last_text and preview_text == "":
            return

        source_state.last_text = text
        await websocket.send(
            json.dumps(
                {
                    "type": "draft-updated",
                    "sessionId": session.session_id,
                    "payload": {
                        "blockId": self.next_block_id(session, source, source_state),
                        "source": source,
                        "stableText": stable_text,
                        "previewText": preview_text,
                        "startedAt": source_state.started_at or source_state.last_updated_at,
                        "updatedAt": source_state.last_updated_at,
                    },
                }
            )
        )

    async def emit_commit(
        self, websocket: Any, session: SessionState, source: str, source_state: SourceState
    ) -> None:
        if source_state.stream_state is None:
            return

        if source_state.push_buffer:
            text = await self.consume_push_buffer(source_state, session.language, force=True)
            if text:
                source_state.last_text = text

        if self.runtime.supports_native_streaming:
            text = await asyncio.to_thread(
                self.runtime.finish_streaming_transcribe,
                source_state.stream_state,
            )
        else:
            text = await asyncio.to_thread(
                self.runtime.transcribe,
                source_state.concatenate_utterance(),
                session.language,
            )
        text = text.strip()
        if not text:
            text = source_state.last_text.strip()

        if text:
            await websocket.send(
                json.dumps(
                    {
                        "type": "block-committed",
                        "sessionId": session.session_id,
                        "payload": {
                            "block": {
                                "id": self.next_block_id(session, source, source_state),
                                "source": source,
                                "text": text,
                                "startedAt": source_state.started_at
                                or source_state.last_updated_at,
                                "endedAt": source_state.last_updated_at,
                            }
                        },
                    }
                )
            )

        source_state.block_index += 1
        source_state.clear()

    async def consume_push_buffer(
        self, source_state: SourceState, language: str, force: bool = False
    ) -> str:
        if source_state.stream_state is None:
            return ""

        if not source_state.push_buffer:
            return ""

        if not force and not source_state.should_push():
            return ""

        chunk = source_state.take_push_buffer()
        if chunk.size == 0:
            return ""

        if self.runtime.supports_native_streaming:
            text = await asyncio.to_thread(
                self.runtime.streaming_transcribe,
                chunk,
                source_state.stream_state,
            )
        else:
            text = await asyncio.to_thread(
                self.runtime.transcribe,
                source_state.concatenate_utterance(),
                language,
            )
        return text.strip()

    async def finalize_session(self, websocket: Any, session: SessionState) -> None:
        for source, source_state in session.sources.items():
            if source_state.stream_state is not None:
                await self.emit_commit(websocket, session, source, source_state)

    def build_health_payload(self) -> dict[str, Any]:
        errors = {}
        if self.runtime.error:
            errors["runtime"] = self.runtime.error
        if self.vad_runtime.error:
            errors["vad"] = self.vad_runtime.error

        detail: dict[str, Any] = {}
        if self.runtime.backend != "uninitialized":
            detail["backend"] = self.runtime.backend
        if errors:
            detail.update(errors)

        return {
            "type": "health-status",
            "ok": not errors,
            "runtimeFamilyId": RUNTIME_FAMILY,
            "modelIdentifier": self.runtime.model_name,
            "readiness": "ready" if self.runtime.ready and self.vad_runtime.ready else "prewarm-required",
            "capabilities": CAPABILITIES,
            **({"detail": detail} if detail else {}),
        }

    def next_block_id(
        self,
        session: SessionState,
        source: str,
        source_state: SourceState,
    ) -> str:
        return f"{session.session_id}:{source}:{source_state.block_index}"


def decode_chunk(data_base64: str) -> np.ndarray:
    raw = base64.b64decode(data_base64)
    pcm16 = np.frombuffer(raw, dtype=np.int16)
    return pcm16.astype(np.float32) / 32768.0


def extract_state_text(state: Any) -> str:
    text = getattr(state, "text", "")
    return text if isinstance(text, str) else ""


def normalize_runtime_language(language: str) -> str | None:
    normalized = language.strip().lower()

    if normalized in {"", "auto"}:
        return None

    language_map = {
        "zh": "Chinese",
        "zh-cn": "Chinese",
        "en": "English",
        "en-us": "English",
        "ja": "Japanese",
        "ja-jp": "Japanese",
        "ko": "Korean",
        "ko-kr": "Korean",
    }

    return language_map.get(normalized, language)


def resolve_qwen_backend() -> str:
    if QWEN_BACKEND in {"vllm", "transformers"}:
        return QWEN_BACKEND

    if os.name == "nt":
        return "transformers"

    try:
        import vllm  # noqa: F401

        return "vllm"
    except Exception:
        return "transformers"


def resolve_transformers_device_map() -> str:
    return "cuda:0" if torch.cuda.is_available() else "cpu"


def resolve_transformers_dtype() -> torch.dtype:
    if not torch.cuda.is_available():
        return torch.float32

    if hasattr(torch.cuda, "is_bf16_supported") and torch.cuda.is_bf16_supported():
        return torch.bfloat16

    return torch.float16


def split_stable_preview(previous_text: str, current_text: str) -> tuple[str, str]:
    prefix_chars = []
    for left, right in zip(previous_text, current_text):
        if left != right:
            break
        prefix_chars.append(left)

    stable = "".join(prefix_chars).rstrip()
    preview = current_text[len(stable) :].lstrip()

    if stable == current_text:
        return stable, ""

    return stable, preview


async def main() -> None:
    runtime = QwenRuntime(MODEL_NAME)
    vad_runtime = SileroRuntime()
    service = JustSayQwenService(runtime, vad_runtime)

    async with serve(service.handle_connection, HOST, PORT, max_size=4 * 1024 * 1024):
        print(
            json.dumps(
                {
                    "type": "ready",
                    "host": HOST,
                    "port": PORT,
                    "model": MODEL_NAME,
                    "runtimeFamilyId": RUNTIME_FAMILY,
                    "ts": int(time.time() * 1000),
                }
            ),
            flush=True,
        )
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())

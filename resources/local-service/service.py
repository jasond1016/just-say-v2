import asyncio
import base64
import json
import os
import tempfile
import time
import wave
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import torch
from funasr import AutoModel
from funasr.utils.postprocess_utils import rich_transcription_postprocess
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

HOST = os.environ.get("JUSTSAY_LOCAL_SERVICE_HOST", "127.0.0.1")
PORT = int(os.environ.get("JUSTSAY_LOCAL_SERVICE_PORT", "8765"))
MODEL_NAME = os.environ.get("JUSTSAY_LOCAL_SERVICE_MODEL", "iic/SenseVoiceSmall")
DEVICE = os.environ.get("JUSTSAY_LOCAL_SERVICE_DEVICE", "auto")
RUNTIME_FAMILY = os.environ.get("JUSTSAY_LOCAL_SERVICE_RUNTIME_FAMILY", "sensevoice")

CAPABILITIES = {
    "streaming": True,
    "translation": False,
    "wordTiming": False,
    "speakerSeparation": False,
    "requiresNetwork": False,
    "requiresLocalService": True,
}

MIN_DRAFT_CHUNKS = 4
DRAFT_REFRESH_CHUNKS = 3


class SenseVoiceRuntime:
    def __init__(self, model_name: str, device: str) -> None:
        self.model_name = model_name
        self.device = device
        self.requested_device = device
        self.error: str | None = None
        self.model: AutoModel | None = None
        self.load_errors: dict[str, str] = {}

        for candidate in resolve_device_candidates(device):
            try:
                self.model = AutoModel(model=model_name, device=candidate)
                self.device = candidate
                return
            except Exception as exc:  # pragma: no cover - depends on local runtime
                self.load_errors[candidate] = str(exc)

        self.error = format_device_error(model_name, device, self.load_errors)

    @property
    def ready(self) -> bool:
        return self.model is not None and self.error is None

    def transcribe(self, samples: np.ndarray, sample_rate: int, language: str) -> str:
        if not self.model:
            raise RuntimeError(self.error or "SenseVoice model is unavailable")

        if samples.size == 0:
            return ""

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
            temp_path = Path(handle.name)

        try:
            pcm16 = np.clip(samples, -1.0, 1.0)
            pcm16 = (pcm16 * 32767.0).astype(np.int16)

            with wave.open(str(temp_path), "wb") as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(sample_rate)
                wav_file.writeframes(pcm16.tobytes())

            result = self.model.generate(
                input=[str(temp_path)],
                cache={},
                language=language,
                batch_size_s=0,
                use_itn=True,
            )
            raw_text = result[0].get("text", "") if result else ""
            return rich_transcription_postprocess(raw_text).strip()
        finally:
            try:
                temp_path.unlink(missing_ok=True)
            except Exception:
                pass


@dataclass
class SourceState:
    block_index: int = 0
    speaking: bool = False
    silence_chunks: int = 0
    started_at: int | None = None
    samples: list[np.ndarray] = field(default_factory=list)
    last_updated_at: int = 0
    last_draft_text: str = ""
    last_draft_chunk_count: int = 0

    def append(self, chunk: np.ndarray, timestamp: int) -> None:
        self.samples.append(chunk)
        self.last_updated_at = timestamp
        if self.started_at is None:
            self.started_at = timestamp

    def clear(self) -> None:
        self.speaking = False
        self.silence_chunks = 0
        self.started_at = None
        self.samples.clear()
        self.last_draft_text = ""
        self.last_draft_chunk_count = 0

    def combine(self) -> np.ndarray:
        if not self.samples:
            return np.array([], dtype=np.float32)

        return np.concatenate(self.samples)

    @property
    def chunk_count(self) -> int:
        return len(self.samples)


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


class JustSayLocalService:
    def __init__(self, runtime: SenseVoiceRuntime) -> None:
        self.runtime = runtime
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
            await websocket.send(
                json.dumps(
                    {
                        "type": "health-status",
                        "ok": self.runtime.ready,
                        "runtimeFamilyId": RUNTIME_FAMILY,
                        "modelIdentifier": self.runtime.model_name,
                        "readiness": "ready" if self.runtime.ready else "prewarm-required",
                        "capabilities": CAPABILITIES,
                        **(
                            {"detail": {"error": self.runtime.error}}
                            if self.runtime.error
                            else {}
                        ),
                    }
                )
            )
            return

        if message_type == "prewarm":
            if not self.runtime.ready:
                await websocket.send(
                    json.dumps(
                        {
                            "type": "health-status",
                            "ok": False,
                            "runtimeFamilyId": RUNTIME_FAMILY,
                            "modelIdentifier": self.runtime.model_name,
                            "readiness": "prewarm-required",
                            "capabilities": CAPABILITIES,
                            "detail": {"error": self.runtime.error},
                        }
                    )
                )
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
            return

        if message_type == "start-session":
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
                                "message": "Cloud translation is disabled for the local SenseVoice service.",
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
            return

    async def handle_audio_chunk(
        self, websocket: Any, session: SessionState, chunk: dict[str, Any]
    ) -> None:
        source = chunk["source"]
        timestamp = int(chunk["timestamp"])
        source_state = session.source_state(source)
        samples = decode_chunk(chunk["dataBase64"])
        energy = rms_energy(samples)

        if session.mode == "ptt":
            source_state.append(samples, timestamp)
            return

        if energy >= 0.015:
            source_state.append(samples, timestamp)
            source_state.speaking = True
            source_state.silence_chunks = 0
            await self.emit_draft(websocket, session, source, source_state)
            return

        if source_state.speaking:
            source_state.append(samples, timestamp)
            source_state.silence_chunks += 1

            if source_state.silence_chunks >= 6:
                await self.emit_commit(websocket, session, source, source_state)

    async def emit_draft(
        self, websocket: Any, session: SessionState, source: str, source_state: SourceState
    ) -> None:
        if source_state.chunk_count < MIN_DRAFT_CHUNKS:
            return

        if (
            source_state.last_draft_chunk_count > 0
            and source_state.chunk_count - source_state.last_draft_chunk_count
            < DRAFT_REFRESH_CHUNKS
        ):
            return

        text = await asyncio.to_thread(
            self.runtime.transcribe,
            source_state.combine(),
            16000,
            session.language,
        )
        text = text.strip()

        if not text or text == source_state.last_draft_text:
            return

        source_state.last_draft_text = text
        source_state.last_draft_chunk_count = source_state.chunk_count
        block_id = self.next_block_id(session, source, source_state)
        await websocket.send(
            json.dumps(
                {
                    "type": "draft-updated",
                    "sessionId": session.session_id,
                    "payload": {
                        "blockId": block_id,
                        "source": source,
                        "stableText": "",
                        "previewText": text,
                        "startedAt": source_state.started_at or source_state.last_updated_at,
                        "updatedAt": source_state.last_updated_at,
                    },
                }
            )
        )

    async def emit_commit(
        self, websocket: Any, session: SessionState, source: str, source_state: SourceState
    ) -> None:
        text = await asyncio.to_thread(
            self.runtime.transcribe,
            source_state.combine(),
            16000,
            session.language,
        )
        block_id = self.next_block_id(session, source, source_state)

        if text:
            await websocket.send(
                json.dumps(
                    {
                        "type": "block-committed",
                        "sessionId": session.session_id,
                        "payload": {
                            "block": {
                                "id": block_id,
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

    async def finalize_session(self, websocket: Any, session: SessionState) -> None:
        for source, source_state in session.sources.items():
            if source_state.samples:
                await self.emit_commit(websocket, session, source, source_state)

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


def rms_energy(samples: np.ndarray) -> float:
    if samples.size == 0:
        return 0.0

    return float(np.sqrt(np.mean(np.square(samples))))


def resolve_device_candidates(requested_device: str) -> list[str]:
    normalized = requested_device.strip().lower()

    if normalized == "auto":
        return ["cuda", "cpu"] if torch.cuda.is_available() else ["cpu"]

    if normalized.startswith("cuda"):
        return [requested_device, "cpu"] if torch.cuda.is_available() else ["cpu"]

    return [requested_device]


def format_device_error(
    model_name: str, requested_device: str, load_errors: dict[str, str]
) -> str:
    if not load_errors:
        return f"Failed to load {model_name} on requested device {requested_device}"

    attempts = ", ".join(
        f"{device}: {message}" for device, message in load_errors.items()
    )
    return (
        f"Failed to load {model_name} on requested device {requested_device}. "
        f"Attempts: {attempts}"
    )


async def main() -> None:
    runtime = SenseVoiceRuntime(MODEL_NAME, DEVICE)
    service = JustSayLocalService(runtime)

    async with serve(service.handle_connection, HOST, PORT, max_size=4 * 1024 * 1024):
        print(
            json.dumps(
                {
                    "type": "ready",
                    "host": HOST,
                    "port": PORT,
                    "model": MODEL_NAME,
                    "device": runtime.device,
                    "ts": int(time.time() * 1000),
                }
            ),
            flush=True,
        )
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())

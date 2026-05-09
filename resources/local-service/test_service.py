import json
import unittest
from unittest.mock import patch

import numpy as np

from service import JustSayLocalService, SenseVoiceRuntime, SessionState


class FakeRuntime:
    def __init__(self, responses: list[str]) -> None:
        self.responses = responses
        self.calls: list[tuple[int, int, str]] = []

    def transcribe(self, samples: np.ndarray, sample_rate: int, language: str) -> str:
        self.calls.append((samples.size, sample_rate, language))
        return self.responses.pop(0) if self.responses else ""


class FakeWebSocket:
    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def send(self, message: str) -> None:
        self.messages.append(json.loads(message))


class JustSayLocalServiceDraftTests(unittest.IsolatedAsyncioTestCase):
    async def test_emit_draft_uses_transcribed_preview_text(self) -> None:
        runtime = FakeRuntime(["hello from draft"])
        service = JustSayLocalService(runtime)
        websocket = FakeWebSocket()
        session = SessionState("meeting-1", "meeting", "auto", False)
        source_state = session.source_state("system")

        for index in range(4):
            source_state.append(np.array([0.2, 0.1, 0.2], dtype=np.float32), 1000 + index * 100)

        await service.emit_draft(websocket, session, "system", source_state)

        self.assertEqual(len(websocket.messages), 1)
        self.assertEqual(websocket.messages[0]["type"], "draft-updated")
        self.assertEqual(websocket.messages[0]["payload"]["blockId"], "meeting-1:system:0")
        self.assertEqual(websocket.messages[0]["payload"]["previewText"], "hello from draft")
        self.assertEqual(websocket.messages[0]["payload"]["stableText"], "")

    async def test_emit_commit_reuses_the_same_block_id_as_the_draft(self) -> None:
        runtime = FakeRuntime(["hello from draft", "hello from commit"])
        service = JustSayLocalService(runtime)
        websocket = FakeWebSocket()
        session = SessionState("meeting-1", "meeting", "auto", False)
        source_state = session.source_state("system")

        for index in range(4):
            source_state.append(np.array([0.2, 0.1, 0.2], dtype=np.float32), 1000 + index * 100)

        await service.emit_draft(websocket, session, "system", source_state)
        await service.emit_commit(websocket, session, "system", source_state)

        self.assertEqual(len(websocket.messages), 2)
        self.assertEqual(websocket.messages[0]["payload"]["blockId"], "meeting-1:system:0")
        self.assertEqual(
            websocket.messages[1]["payload"]["block"]["id"],
            websocket.messages[0]["payload"]["blockId"],
        )
        self.assertEqual(websocket.messages[1]["payload"]["block"]["text"], "hello from commit")
        self.assertEqual(source_state.block_index, 1)
        self.assertEqual(source_state.chunk_count, 0)


class SenseVoiceRuntimeTests(unittest.TestCase):
    def test_prefers_cuda_and_falls_back_to_cpu(self) -> None:
        created_devices: list[str] = []

        def fake_auto_model(*, model: str, device: str) -> object:
            created_devices.append(device)
            if device == "cuda":
                raise RuntimeError("CUDA unavailable")
            return object()

        with (
            patch("service.torch.cuda.is_available", return_value=True),
            patch("service.AutoModel", side_effect=fake_auto_model),
        ):
            runtime = SenseVoiceRuntime("iic/SenseVoiceSmall", "auto")

        self.assertTrue(runtime.ready)
        self.assertEqual(runtime.device, "cpu")
        self.assertEqual(runtime.requested_device, "auto")
        self.assertEqual(created_devices, ["cuda", "cpu"])
        self.assertEqual(runtime.load_errors, {"cuda": "CUDA unavailable"})

    def test_cpu_request_only_uses_cpu(self) -> None:
        created_devices: list[str] = []

        def fake_auto_model(*, model: str, device: str) -> object:
            created_devices.append(device)
            return object()

        with (
            patch("service.torch.cuda.is_available", return_value=True),
            patch("service.AutoModel", side_effect=fake_auto_model),
        ):
            runtime = SenseVoiceRuntime("iic/SenseVoiceSmall", "cpu")

        self.assertTrue(runtime.ready)
        self.assertEqual(runtime.device, "cpu")
        self.assertEqual(created_devices, ["cpu"])


if __name__ == "__main__":
    unittest.main()

import asyncio
import base64
import json
import sys
import time
import wave
from pathlib import Path

import websockets


async def drain_messages(
    socket: websockets.WebSocketClientProtocol,
    timeout: float,
    max_messages: int | None = None,
) -> list[dict]:
    messages: list[dict] = []

    while True:
        try:
            raw = await asyncio.wait_for(socket.recv(), timeout=timeout)
        except asyncio.TimeoutError:
            return messages

        messages.append(json.loads(raw))
        if max_messages is not None and len(messages) >= max_messages:
            return messages


async def run(audio_path: Path) -> int:
    uri = "ws://127.0.0.1:8765"
    session_id = f"smoke-{int(time.time() * 1000)}"

    async with websockets.connect(uri, max_size=4 * 1024 * 1024) as socket:
        await socket.send(json.dumps({"type": "health-check"}))
        for message in await drain_messages(socket, 5, max_messages=1):
            print(json.dumps(message, ensure_ascii=False))

        await socket.send(
            json.dumps(
                {
                    "type": "prewarm",
                    "mode": "ptt",
                    "language": "en",
                }
            )
        )
        for message in await drain_messages(socket, 900, max_messages=1):
            print(json.dumps(message, ensure_ascii=False))

        await socket.send(
            json.dumps(
                {
                    "type": "start-session",
                    "sessionId": session_id,
                    "mode": "ptt",
                    "language": "en",
                    "translationEnabled": False,
                }
            )
        )
        for message in await drain_messages(socket, 5, max_messages=2):
            print(json.dumps(message, ensure_ascii=False))

        with wave.open(str(audio_path), "rb") as wav_file:
            sample_rate = wav_file.getframerate()
            channels = wav_file.getnchannels()
            chunk_frames = sample_rate // 10
            started_at = int(time.time() * 1000)

            while True:
                chunk = wav_file.readframes(chunk_frames)
                if not chunk:
                    break

                await socket.send(
                    json.dumps(
                        {
                            "type": "audio-chunk",
                            "sessionId": session_id,
                            "chunk": {
                                "source": "microphone",
                                "sampleRate": sample_rate,
                                "channels": channels,
                                "timestamp": started_at,
                                "dataBase64": base64.b64encode(chunk).decode("ascii"),
                            },
                        }
                    )
                )
                started_at += 100

                for message in await drain_messages(socket, 0.1):
                    print(json.dumps(message, ensure_ascii=False))

        await socket.send(json.dumps({"type": "stop-session", "sessionId": session_id}))
        for message in await drain_messages(socket, 30):
            print(json.dumps(message, ensure_ascii=False))

    return 0


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python scripts/qwen_local_smoketest.py <wav-path>", file=sys.stderr)
        return 2

    return asyncio.run(run(Path(sys.argv[1]).resolve()))


if __name__ == "__main__":
    raise SystemExit(main())

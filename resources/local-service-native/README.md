# Native SenseVoice validation runtime

This directory is populated by the opt-in native SenseVoice setup:

```bash
# CPU build
pnpm setup:native-sensevoice

# CUDA build (requires the CUDA toolkit)
pnpm setup:native-sensevoice -- --cuda
```

The setup script pins QwenAudio/SenseVoice at commit
`b054623cca8f015b73ec471dce4f473ac47413da`, applies JustSay's small realtime
metadata patch, builds `sensevoice-server`, and downloads the Q8 SenseVoiceSmall
and FSMN-VAD GGUF files. Generated binaries and model files are intentionally
gitignored.

Enable the validation runtime by adding `native-sensevoice` to
`advanced.experimentalFlags` in JustSay's settings. Removing the flag restores
the existing Python/FunASR Managed Local Service.

The validation scope is PTT and single-source Meeting. A Meeting configured with
both system audio and microphone is rejected until native dual-source scheduling
has been benchmarked. The native service serializes ASR inference globally, so
multiple WebSocket connections do not imply parallel recognition.

Runtime tuning environment variables:

- `JUSTSAY_SENSEVOICE_GPU_LAYERS` — `1` enables whole-model CUDA offload; `0` uses CPU.
- `JUSTSAY_SENSEVOICE_THREADS` — CPU ggml thread count, default `8`.
- `JUSTSAY_SENSEVOICE_PARTIAL_MS` — partial cadence, default `400`.
- `JUSTSAY_SENSEVOICE_VAD_MAXSEG_MS` — maximum VAD segment, default `30000`.
- `JUSTSAY_SENSEVOICE_VAD_SLOT_MS` — idle VAD reset interval, default `2000`.
- `JUSTSAY_SENSEVOICE_SERVER_BINARY`, `JUSTSAY_SENSEVOICE_MODEL_PATH`, and
  `JUSTSAY_SENSEVOICE_VAD_PATH` override generated artifact locations.

The upstream SenseVoice runtime and the GGUF model repositories identify their
artifacts as Apache-2.0. llama.cpp/ggml retains its upstream license and notices.

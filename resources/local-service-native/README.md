# Native SenseVoice validation runtime

This directory is populated by the opt-in native SenseVoice setup:

```bash
# Auto-detect CUDA, otherwise build for CPU
pnpm setup:native-sensevoice

# Optional overrides
pnpm setup:native-sensevoice -- --cuda
pnpm setup:native-sensevoice -- --cpu
```

The setup script pins QwenAudio/SenseVoice at commit
`b054623cca8f015b73ec471dce4f473ac47413da`, applies JustSay's small realtime
metadata patch, builds `sensevoice-server`, and downloads the Q8 SenseVoiceSmall
and FSMN-VAD GGUF files. Generated binaries and model files are intentionally
gitignored. Automatic CUDA selection requires both `nvcc` (the CUDA toolkit) and
`nvidia-smi`; the CUDA-enabled server also falls back to CPU at runtime if no
compatible GPU is available.

Enable the validation runtime with **Settings → Recognition → Native
SenseVoice (experimental)**. Turning it off restores the existing Python/FunASR
Managed Local Service.

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

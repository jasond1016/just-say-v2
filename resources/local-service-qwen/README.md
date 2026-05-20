# JustSay Qwen Local Service

This directory contains the Qwen3-ASR sidecar used by JustSay for the `local-accurate` profile.

## Intended deployment

- **Windows managed-local** now uses the `qwen-asr` transformers backend.
- **Linux GPU** still uses the `qwen-asr[vllm]` backend by default and remains the preferred path for the best streaming behavior.
- The sidecar speaks the same JustSay WebSocket protocol as the SenseVoice service, but it uses **Qwen3-ASR-1.7B + Silero VAD** internally.

## Runtime behavior

- Health reports **runtime identity** and **runtime readiness**
- `prewarm` explicitly loads Qwen and Silero VAD and keeps them resident
- Meeting mode uses Silero VAD for utterance boundaries.
  Linux `vllm` uses native streaming state for incremental drafts, while Windows `transformers` re-decodes the accumulated utterance on each draft push.
- PTT mode skips VAD and finalizes on key-up / `stop-session`

## Backend selection

- `JUSTSAY_QWEN_BACKEND=auto` is the default.
- On Windows, `auto` resolves to `transformers`.
- On non-Windows hosts, `auto` prefers `vllm` when it is installed and falls back to `transformers`.
- You can force either backend explicitly with `JUSTSAY_QWEN_BACKEND=transformers` or `JUSTSAY_QWEN_BACKEND=vllm`.

## Windows managed-local

1. Install Python 3.10-3.12 and `uv`.
2. From the repository root, install dependencies:

   ```powershell
   uv sync --project resources/local-service-qwen
   ```

3. Start the sidecar:

   ```powershell
   $env:JUSTSAY_LOCAL_SERVICE_HOST = "127.0.0.1"
   $env:JUSTSAY_LOCAL_SERVICE_PORT = "8765"
   $env:JUSTSAY_LOCAL_SERVICE_MODEL = "Qwen/Qwen3-ASR-1.7B"
   $env:JUSTSAY_LOCAL_SERVICE_RUNTIME_FAMILY = "qwen3-asr"
   uv run --project resources/local-service-qwen python resources/local-service-qwen/service.py
   ```

4. In the Windows client:
   - choose **Local Accurate**
   - keep **Deployment mode** on **Managed locally**
   - run **Check / Load**

Notes:

- The Windows path uses the transformers backend, so draft updates are implemented by periodic full-utterance re-decode rather than native vLLM streaming.
- This is materially slower than the Linux vLLM path, especially for long utterances.

## Remote deployment

1. Install Python 3.10-3.12 and `uv` on the Linux GPU machine.
2. From the repository root, install dependencies:

   ```bash
   uv sync --project resources/local-service-qwen
   ```

3. Start the sidecar:

   ```bash
   export JUSTSAY_LOCAL_SERVICE_HOST=0.0.0.0
   export JUSTSAY_LOCAL_SERVICE_PORT=8765
   export JUSTSAY_LOCAL_SERVICE_MODEL=Qwen/Qwen3-ASR-1.7B
   export JUSTSAY_LOCAL_SERVICE_RUNTIME_FAMILY=qwen3-asr
   export JUSTSAY_QWEN_GPU_MEMORY_UTILIZATION=0.9
   export JUSTSAY_QWEN_MAX_MODEL_LEN=32768
   uv run --project resources/local-service-qwen python resources/local-service-qwen/service.py
   ```

4. Open the chosen TCP port on the host firewall.
5. In the Windows client:
   - choose **Local Accurate**
   - switch **Deployment mode** to **Remote service**
   - enter the remote machine IP / hostname and matching port
   - run **Check / Load**

## Notes

- The first successful `Check / Load` may take time because it triggers the explicit Qwen prewarm path.
- On 16 GB GPUs, `JUSTSAY_QWEN_MAX_MODEL_LEN=32768` is a safer default than the vLLM/Qwen default of 65536.
- Timestamps are intentionally out of scope for this first batch.

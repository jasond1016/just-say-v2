# JustSay Qwen Local Service

This directory contains the Qwen3-ASR sidecar used by JustSay for the `local-accurate` profile.

## Intended deployment

- **Managed local** is not the supported path on Windows.
- For Windows clients, run this sidecar on a separate Linux GPU machine and connect to it with **Settings -> Advanced -> Deployment mode -> Remote service**.
- The sidecar speaks the same JustSay WebSocket protocol as the SenseVoice service, but it uses **Qwen3-ASR-1.7B + vLLM backend + Silero VAD** internally.

## Runtime behavior

- Health reports **runtime identity** and **runtime readiness**
- `prewarm` explicitly loads Qwen and Silero VAD and keeps them resident
- Meeting mode uses Silero VAD for utterance boundaries and Qwen streaming state for incremental drafts
- PTT mode skips VAD and finalizes on key-up / `stop-session`

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
- This sidecar expects a CUDA-capable environment that can run the vLLM backend required by `qwen-asr[vllm]`.
- On 16 GB GPUs, `JUSTSAY_QWEN_MAX_MODEL_LEN=32768` is a safer default than the vLLM/Qwen default of 65536.
- Timestamps are intentionally out of scope for this first batch.

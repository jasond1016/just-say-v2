# JustSay Qwen Local Service

This directory contains the Qwen3-ASR sidecar used by JustSay for the `local-accurate` / `local-accurate-lite` profiles.

The sidecar speaks the same JustSay WebSocket protocol as the SenseVoice service, but it uses **Qwen3-ASR + Silero VAD** internally. Default weights are **Qwen3-ASR-1.7B**; set `JUSTSAY_LOCAL_SERVICE_MODEL=Qwen/Qwen3-ASR-0.6B` for the lite profile.

## Supported deployment

- The sidecar is now **vLLM-only**.
- Windows clients should use it via **Remote service** mode, including when the host is a **WSL/Docker** environment on the same machine.
- The host can be a Linux GPU machine, a WSL environment, or a containerized Linux runtime with the port published back to Windows.

## Runtime behavior

- Health reports **runtime identity** and **runtime readiness**
- `prewarm` explicitly loads Qwen and Silero VAD and keeps them resident
- `JUSTSAY_QWEN_PREWARM_POLICY=background` is the default, so the hosted service starts warming itself as soon as it is up
- Health can report `warming` while that background preload is still running
- Meeting mode uses Silero VAD for utterance boundaries and native vLLM streaming state for incremental drafts.
- PTT mode skips VAD and finalizes on key-up / `stop-session`

## Startup prewarm policy

- `JUSTSAY_QWEN_PREWARM_POLICY=background` starts the service quickly, then prewarms in the background
- `JUSTSAY_QWEN_PREWARM_POLICY=lazy` keeps the old behavior and waits for an explicit `prewarm`
- `JUSTSAY_QWEN_PREWARM_POLICY=blocking` only reports ready after the model and VAD are fully loaded

## Windows Docker Desktop + WSL2 with vLLM

This is the practical way to get the Linux `vllm` backend on a Windows machine.

Prerequisites:

- Docker Desktop is running with the **WSL2 backend**
- Docker Desktop GPU support is enabled
- `docker run --rm --gpus all nvidia/cuda:12.8.1-base-ubuntu22.04 nvidia-smi` succeeds

From the repository root:

```powershell
docker compose -f resources/local-service-qwen/docker-compose.vllm.yml up --build
```

The container publishes the sidecar on `127.0.0.1:8765` and persists Hugging Face downloads in the named Docker volume `huggingface-cache`.

In the Windows client:

- choose **Local Accurate** (1.7B) or **Local Accurate Lite** (0.6B), matching the model loaded on the host
- switch **Deployment mode** to **Remote service**
- set host to `127.0.0.1`
- set port to `8765`
- run **Check / Load**

Notes:

- This path runs the same JustSay websocket sidecar as the Linux remote deployment, but locally inside a Linux GPU container.
- `JUSTSAY_QWEN_BACKEND` is pinned to `vllm` in the compose file.
- The first startup may take a while because the container needs to build, install Python dependencies, and download the model weights.

## Hosted sidecar deployment

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
   export JUSTSAY_QWEN_PREWARM_POLICY=background
   export JUSTSAY_QWEN_GPU_MEMORY_UTILIZATION=0.55
   export JUSTSAY_QWEN_MAX_MODEL_LEN=8192
   uv run --project resources/local-service-qwen python resources/local-service-qwen/service.py
   ```

   For `local-accurate-lite`, use `JUSTSAY_LOCAL_SERVICE_MODEL=Qwen/Qwen3-ASR-0.6B` instead.

4. Open the chosen TCP port on the host firewall.

## Windows client setup

1. Start the Qwen sidecar in WSL/Docker or on another Linux host.
2. In the Windows client:
   - choose **Local Accurate** or **Local Accurate Lite**, matching the model loaded on the host
   - switch **Deployment mode** to **Remote service**
   - use `127.0.0.1` and the published port for a local WSL/Docker host, or the remote machine IP / hostname for another host
   - run **Check / Load**

## Notes

- The first successful `Check / Load` may take time because it triggers the explicit Qwen prewarm path.
- With the default `background` policy, `Check / Load` should usually return quickly once the host has already started warming in the background.
- Meeting-oriented defaults use `JUSTSAY_QWEN_MAX_MODEL_LEN=8192` and `JUSTSAY_QWEN_GPU_MEMORY_UTILIZATION=0.55` so a 16 GB card keeps headroom for other GPU work. `0.45` is too tight for 1.7B (model weights leave no KV room); raise further only if you need longer context or higher concurrency.
- If Hugging Face downloads are blocked, set `JUSTSAY_LOCAL_SERVICE_MODEL_PATH` to a local ModelScope/HF snapshot directory while keeping `JUSTSAY_LOCAL_SERVICE_MODEL` as the hub id (`Qwen/Qwen3-ASR-1.7B` or `Qwen/Qwen3-ASR-0.6B`) for client identity matching.
- Timestamps are intentionally out of scope for this first batch.

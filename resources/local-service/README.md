# JustSay Local Service

This directory contains the `uv`-managed ASR service used by JustSay V2. It can run either:

1. as the managed local sidecar launched by Electron on the same machine
2. as a standalone LAN service on another machine that the Electron client connects to remotely

## Runtime

The Electron main process launches the service with:

```powershell
uv run --project resources/local-service python resources/local-service/service.py
```

The service reads:

- `JUSTSAY_LOCAL_SERVICE_HOST`
- `JUSTSAY_LOCAL_SERVICE_PORT`
- `JUSTSAY_LOCAL_SERVICE_MODEL`
- `JUSTSAY_LOCAL_SERVICE_DEVICE`

Default model: `iic/SenseVoiceSmall`
Default device: `auto` (prefers `cuda`, falls back to `cpu`)

On Windows, this project pins `torch` and `torchaudio` to the official PyTorch CUDA 12.8 wheel index so `auto` can use NVIDIA GPUs when available.

## Deploying on another LAN machine

To host transcription on a different machine in the same LAN:

1. Install Python 3.10-3.12 and `uv` on the service machine.
2. From the repository root, install the Python dependencies:

   ```powershell
   uv sync --project resources/local-service
   ```

3. Start the service so it listens on the LAN instead of loopback:

   ```powershell
   $env:JUSTSAY_LOCAL_SERVICE_HOST = "0.0.0.0"
   $env:JUSTSAY_LOCAL_SERVICE_PORT = "8765"
   $env:JUSTSAY_LOCAL_SERVICE_MODEL = "iic/SenseVoiceSmall"
   $env:JUSTSAY_LOCAL_SERVICE_DEVICE = "auto"
   uv run --project resources/local-service python resources/local-service/service.py
   ```

4. Open the chosen TCP port in the service machine firewall.
5. In the JustSay client, open **Settings -> Advanced**, switch **Deployment mode** to **Remote service**, then enter the service machine LAN IP or hostname plus the matching port.

### Deployment notes

- Use `0.0.0.0` only for the machine hosting the service. The client should connect to the server's real LAN IP or hostname, such as `10.0.0.8`.
- The first startup may take longer because FunASR and the model weights may need to download and cache locally.
- `JUSTSAY_LOCAL_SERVICE_DEVICE=auto` prefers CUDA and falls back to CPU. On a CPU-only machine, startup and transcription will be slower.
- For unattended use, run the command through a process manager or a background service wrapper so it comes back after reboot.
- The current protocol has no authentication or TLS. Treat it as trusted-LAN-only unless you add your own network controls.

## Notes

- Meeting mode now emits incremental draft text while speech is active, then commits finalized blocks after silence-based segmentation.
- Translation remains optional and non-blocking. When translation is requested, the service warns that local cloud translation is not wired yet.

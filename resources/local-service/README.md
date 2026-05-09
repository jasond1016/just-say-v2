# JustSay Local Service

This directory contains the `uv`-managed local ASR service used by JustSay V2.

## Runtime

The Electron main process launches the service with:

```powershell
uv run --project resources/local-service service.py
```

The service reads:

- `JUSTSAY_LOCAL_SERVICE_HOST`
- `JUSTSAY_LOCAL_SERVICE_PORT`
- `JUSTSAY_LOCAL_SERVICE_MODEL`
- `JUSTSAY_LOCAL_SERVICE_DEVICE`

Default model: `iic/SenseVoiceSmall`

## Notes

- Meeting mode now emits incremental draft text while speech is active, then commits finalized blocks after silence-based segmentation.
- Translation remains optional and non-blocking. When translation is requested, the service warns that local cloud translation is not wired yet.

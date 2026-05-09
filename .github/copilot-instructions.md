# Copilot instructions

## UI debugging

- For Electron UI inspection and iteration, launch the app with `pnpm debug:ui`.
- `pnpm debug:ui` builds the app and starts Electron with Chromium remote debugging enabled.
- The default remote debugging endpoint is `http://127.0.0.1:9222`.
- When using Chrome DevTools MCP, connect with `--browser-url=http://127.0.0.1:9222`.
- The main renderer target is `file:///.../dist/renderer/index.html`.
- The capture window target is `file:///.../dist/renderer/index.html#capture`.
- Override the default port with the `JUSTSAY_REMOTE_DEBUGGING_PORT` environment variable when needed.

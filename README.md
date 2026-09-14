# Screen Recorder

A browser-based screen recorder with optional microphone and/or system audio
capture. No backend, no install — recordings download straight to your
device.

## How it works

- **Screen capture**: `getDisplayMedia` (choose a window, tab, or the whole
  screen).
- **Audio**: microphone via `getUserMedia`, and/or system/tab audio via
  `getDisplayMedia`'s audio track. If both are selected, they're mixed into
  one track with the Web Audio API.
- **Recording**: `MediaRecorder` writes to WebM (VP9/Opus where supported).
- **Saving**: on stop, the recording is assembled into a `Blob` and offered
  as a direct download — nothing is uploaded anywhere.

### Known limitation: system audio on macOS

Chrome on macOS cannot capture system audio — this is an OS-level
restriction, not a bug in this app. Microphone capture and screen capture
still work fine there; system audio capture is reliable on Chrome/Edge on
Windows and ChromeOS, and when sharing a browser tab.

## Development

```bash
npm install
npm run dev
```

Requires HTTPS or `localhost` — browsers only expose `getDisplayMedia` in a
secure context.

## Build

```bash
npm run build
```

Outputs a static site to `dist/`, deployable as-is to Vercel or any static
host.

## Deploying to Vercel

This is a static Vite app — no server code, no environment variables. In the
Vercel dashboard: **Add New → Project → Import** this repository. Vercel
auto-detects the Vite framework preset (build command `npm run build`,
output directory `dist`); no other configuration is needed. Once imported,
every push to the repo auto-deploys.

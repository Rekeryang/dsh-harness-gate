# DEEPSEEK HARNESS · Biometric Login Gate

A [DSH (DeepSeek Harness)](https://github.com) plugin in the spirit of `dsh-video-skin`: on DSH startup a xenos-HUD biometric gate appears and only hands control back to DSH after a real face scan + voice confirmation. Uses the local webcam and MediaPipe 478-point face mesh + iris landmarks (468–477), fully offline.

> **Privacy**: the face template lives only in browser memory — no `localStorage`, no disk, no network upload. It is destroyed when the page closes.

## Features

- `DEEPSEEK / 深度求索` boot animation → biometric gate.
- First run opens **Settings**: enroll your face (or iris) yourself.
- Then the **Face Gate**: live camera 1:1 matching with a 9-item Face-ID quality gate.
- Then **Voice Confirmation**: TTS prompt + speech recognition ("confirm login"), with a button fallback.
- On success the gate fades out into DSH. A 🔒 re-lock pill remains bottom-right.
- A **Skip gate** button (double-confirmed) prevents a broken camera/engine from locking you out.
- Hot-swappable camera on both Settings and Face Gate pages, with a ⟳ rescan.
- CPU delegate first, GPU fallback; works offline (wasm + model bundled).

## One-click install

In DSH: **Settings → Plugins → Add plugin**, paste one of the following, click Install, then **fully quit and relaunch DSH**:

```
github:Rekeryang/dsh-harness-gate#main
```

Or from the command line:

```sh
dsh plugin --profile web add github:Rekeryang/dsh-harness-gate#main
```

Local source development:

```sh
dsh plugin --profile web add link:<absolute path to this repo>
```

> The desktop (Electron) shell collects the index-injection snapshot once at startup, so you must **fully restart DSH** after installing — a page refresh is not enough.

## Uninstall

```sh
dsh plugin --profile web remove dsh-harness-gate
```

## First run

1. Restart DSH; when the gate appears, click **Enroll face**.
2. Allow camera access, look straight at the camera for 1–2 s (blink when asked to satisfy liveness).
3. Enrollment jumps to the **Face Gate** — click **Start scan** and match your face.
4. After a match, confirm by voice ("确认登录") or click **Confirm** to enter DSH.

> Camera requires a secure context: `localhost`, HTTPS, or the DSH desktop client. Opening the file directly via `file://` will not grant camera access.

## Layout

```
dsh-harness-gate/
├── index.js              host half: injection rows + vendor asset routes
├── lib/
│   ├── injections.js     build style/script injection rows
│   └── route.js          Range / MIME / path-escape guard
├── runtime/
│   ├── gate.css          gate UI (scoped under #dshg-root)
│   └── gate.js           browser runtime: engine/camera/detect/match/voice
├── vendor/               MediaPipe wasm + face_landmarker.task
├── scripts/              check / install / uninstall
├── cordis.patch.yml      bundle patch layer
└── package.json
```

## Notes

- This is 1:1 verification (enroll → match within a session), not 1:N identification, so no vector database is involved.
- The biometric vector is geometric (60-d) plus iris grayscale texture (48×2-d); it is robust enough for a demo gate but should not be the sole credential for high-security use.
- No external network dependency; all inference runs locally.

## License

MIT

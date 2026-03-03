# Testing - Hotfix 0.1.1

Date: 2026-03-04 (local run)
Scope: `video-frame-desktop`

## Environment

- `npm run build`: PASS
- `ffmpeg`, `ffprobe`: PASS (installed)
- `cargo`, `rustc`: BLOCKED (not installed in this environment)

## Strict Checklist

### A) Native picker can start

Status: BLOCKED (runtime)

Evidence:
- UI button exists with exact label `選擇影片（原生）` in `src/App.jsx`.
- Frontend calls backend command `pick_video_file`.
- Backend command `pick_video_file` implemented using native dialog (`rfd::FileDialog`) with mp4 filter.
- Runtime launch command failed due missing Rust toolchain:

```bash
npm run tauri:dev
# -> failed to run 'cargo metadata' ... No such file or directory (os error 2)
```

### B) Drag/drop usable/unusable prompts

Status: PARTIAL PASS (code + web build)

Evidence:
- Drag/drop flow retained (`onDrop`, `extractPathFromDrop`).
- Explicit warning for unusable full path:
  - `拖拉檔案時未取得可用完整路徑。請改用「選擇影片（原生）」選擇 mp4。`
- `npm run build` passed, confirming UI code compiles.

### C) Non-mp4 blocked

Status: PARTIAL PASS (backend validation implemented)

Evidence:
- Backend hard-blocks non-mp4 in `inspect_path`:
  - `目前僅支援 mp4 檔案`
- Native picker filter only allows `.mp4` in dialog.
- Full runtime verification blocked by missing `cargo`.

### D) Real run with 15-second video outputs frames + metadata

Status: PARTIAL / BLOCKED

What was executed:

1. Generated a real 15s sample mp4 (required fallback when no sample exists):

```bash
ffmpeg -y -f lavfi -i testsrc=size=640x360:rate=30 -t 15 test-artifacts/sample-15s.mp4
ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 test-artifacts/sample-15s.mp4
# duration=15.000000
# size=89124
```

2. Verified frame extraction behavior (`fps=2/3`) using ffmpeg directly:

```bash
ffmpeg -y -i test-artifacts/sample-15s.mp4 -vf fps=2/3 test-artifacts/manual-ffmpeg/frames/frame_%05d.jpg
ls -1 test-artifacts/manual-ffmpeg/frames | wc -l
# 10
```

Artifacts confirmed:
- `test-artifacts/sample-15s.mp4`
- `test-artifacts/manual-ffmpeg/frames/frame_00001.jpg` ... `frame_00010.jpg`

Blocked part:
- Could not execute full app/backend `process_video` path (which writes `metadata.json`) because Tauri runtime cannot start without `cargo`.

## Command Log (key)

```bash
npm run build                               # PASS
npm run tauri:dev                           # FAIL (missing cargo)
which cargo && which rustc                  # none
which ffmpeg && which ffprobe               # present
```

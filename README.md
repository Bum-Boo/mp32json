# Song Analysis Tool

Exports a time-indexable audio profile at 30 fps. The default format is compact JSON:

```json
{
  "version": 1,
  "albumId": "album-brutal-heaven",
  "fps": 30,
  "duration": 180.0,
  "channels": ["rms", "low", "mid", "high", "flux", "beat", "bloom"],
  "frames": [[12, 31, 18, 8, 4, 0, 20]],
  "beats": [0.48, 0.96, 1.44]
}
```

Each `frames[index]` maps to `Math.floor(currentTime * fps)`. Channel values are normalized internally to `0..1`, then exported as `0..255` integers.

## Usage

```powershell
node src/analyze-audio.js "song.mp3" --album-id album-brutal-heaven --output profile.json
```

Debug-readable JSON:

```powershell
node src/analyze-audio.js "song.mp3" --format readable --output profile.readable.json
```

Requirements:

- Node.js 20+
- `ffmpeg` available on `PATH`

Binary `.u8` output is intentionally not implemented yet. The frame matrix is kept as fixed-channel byte values so it can be written to `.u8` later without changing the analysis pipeline.

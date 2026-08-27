# mp32json

[English](README.md) | [한국어](docs/README.ko.md) | [日本語](docs/README.ja.md) | [中文](docs/README.zh-CN.md)

A dependency-free Node.js CLI that uses `ffmpeg` to turn audio files into compact JSON profiles for web visualizers and audio-reactive interfaces.

## Features

- Analyze one file or recursively batch-process a folder.
- Accept AAC, AIFF, FLAC, M4A, MP3, OGG, Opus, WAV, and WebM files that `ffmpeg` can decode.
- Emit 0–255 values for `rms`, `low`, `mid`, `high`, `flux`, `beat`, and `bloom` channels.
- Produce compact JSON by default or indented, object-based readable JSON.
- Record detected beat times and configurable frames per second.

This is a heuristic visual-profile generator, not a music-information-retrieval or mastering tool. Frequency bands use simple one-pole filters, features are normalized per track, and beat detection is approximate.

## Requirements

- Node.js 20 or newer
- `ffmpeg` available on `PATH`

The package is marked `private` and has no published npm package or release binary. Clone/download the repository and run it locally; `npm install` is not required because there are no JavaScript dependencies.

## Usage

```bash
node src/analyze-audio.js --help
node src/analyze-audio.js "song.mp3" --album-id my-song --output result/my-song.profile.json
```

Batch mode recursively reads supported audio from `source/` and writes JSON to `result/`:

```bash
npm run batch
```

Useful options:

```text
--fps <number>        output frame rate (default: 30)
--format <format>     compact or readable (default: compact)
--output, -o <path>  output file; single-file mode prints to stdout if omitted
--source-dir <path>  batch input directory (default: source)
--result-dir <path>  batch output directory (default: result)
```

Binary `.u8` output is not implemented. Batch output names are slugged from each filename; collisions can overwrite earlier results, so use unique base names.

## Output

```json
{"version":1,"albumId":"my-song","fps":30,"duration":180,"channels":["rms","low","mid","high","flux","beat","bloom"],"frames":[[12,31,18,8,4,0,20]],"beats":[0.48,0.96]}
```

Frame values are integers from 0 to 255. Convert them to 0–1 values in a visualizer:

```js
const index = Math.floor(currentTime * profile.fps);
const frame = profile.frames[index] ?? [];
const values = Object.fromEntries(
  profile.channels.map((channel, i) => [channel, (frame[i] ?? 0) / 255])
);
```

## Privacy, copyright, and limits

Analysis runs locally. The CLI does not upload audio, but input paths and generated profiles remain on your computer. Real files inside `source/` and `result/` are git-ignored.

Only analyze audio you own or are authorized to process. Generated data does not remove copyright or license restrictions on the source audio. Do not commit or distribute source recordings without permission. Large or long files can use substantial memory because decoded audio and output frames are held in memory; the `ffmpeg` output buffer is capped at 512 MiB.

## Status and validation

The repository is an early `0.1.0` utility with no automated test suite. Check the CLI parser with `node src/analyze-audio.js --help`, then validate real analysis with a small audio file you are permitted to use.

![Example JSON result](docs/demo-screenshots/song-analyzer-flow-01-json-result.png)

## License and attribution request

This repository currently has no separate license file. Do not assume that public source grants permission to copy, modify, or redistribute it; determine the rights you need first.

If you showcase the project or use it in an authorized derivative, a mention of `@Bum-Boo` and the [original repository](https://github.com/Bum-Boo/mp32json) would be appreciated. This is a courtesy request, not an additional license condition and not a replacement for license obligations.

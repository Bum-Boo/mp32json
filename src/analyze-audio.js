#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const VERSION = 1;
const DEFAULT_FPS = 30;
const SAMPLE_RATE = 22050;
const CHANNELS = ["rms", "low", "mid", "high", "flux", "beat", "bloom"];
const DEFAULT_SOURCE_DIR = "source";
const DEFAULT_RESULT_DIR = "result";
const AUDIO_EXTENSIONS = new Set([".aac", ".aiff", ".aif", ".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav", ".webm"]);

class OnePoleLowPass {
  constructor(cutoffHz, sampleRate) {
    const dt = 1 / sampleRate;
    const rc = 1 / (2 * Math.PI * cutoffHz);
    this.alpha = dt / (rc + dt);
    this.y = 0;
  }

  process(x) {
    this.y += this.alpha * (x - this.y);
    return this.y;
  }
}

class OnePoleHighPass {
  constructor(cutoffHz, sampleRate) {
    const dt = 1 / sampleRate;
    const rc = 1 / (2 * Math.PI * cutoffHz);
    this.alpha = rc / (rc + dt);
    this.prevX = 0;
    this.prevY = 0;
  }

  process(x) {
    const y = this.alpha * (this.prevY + x - this.prevX);
    this.prevX = x;
    this.prevY = y;
    return y;
  }
}

function parseArgs(argv) {
  const options = {
    fps: DEFAULT_FPS,
    format: "compact",
    output: null,
    albumId: null,
    batch: false,
    sourceDir: DEFAULT_SOURCE_DIR,
    resultDir: DEFAULT_RESULT_DIR,
  };
  let input = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--album-id") {
      options.albumId = requireValue(argv, ++i, arg);
    } else if (arg === "--fps") {
      options.fps = Number(requireValue(argv, ++i, arg));
    } else if (arg === "--format") {
      options.format = requireValue(argv, ++i, arg);
    } else if (arg === "--output" || arg === "-o") {
      options.output = requireValue(argv, ++i, arg);
    } else if (arg === "--batch") {
      options.batch = true;
    } else if (arg === "--source-dir") {
      options.sourceDir = requireValue(argv, ++i, arg);
    } else if (arg === "--result-dir") {
      options.resultDir = requireValue(argv, ++i, arg);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!input) {
      input = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (options.help) {
    return { input, options };
  }
  if (!input && !options.batch) {
    throw new Error("Missing input audio file.");
  }
  if (!Number.isFinite(options.fps) || options.fps <= 0) {
    throw new Error("--fps must be a positive number.");
  }
  if (!["compact", "readable"].includes(options.format)) {
    throw new Error("--format must be compact or readable. Binary .u8 is not implemented yet.");
  }

  if (input) {
    options.input = resolve(input);
    options.albumId ??= slugFromFilename(input);
  }

  options.sourceDir = resolve(options.sourceDir);
  options.resultDir = resolve(options.resultDir);
  return { input: options.input, options };
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function slugFromFilename(path) {
  const name = basename(path, extname(path)).toLowerCase();
  const slug = name
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "audio-profile";
}

function isAudioFile(path) {
  return AUDIO_EXTENSIONS.has(extname(path).toLowerCase());
}

function collectAudioFiles(directory) {
  mkdirSync(directory, { recursive: true });

  const files = [];
  const entries = readdirSync(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectAudioFiles(entryPath));
      continue;
    }

    if (entry.isFile() && isAudioFile(entryPath)) {
      files.push(entryPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
}

function createOutputPath(inputPath, resultDir, format) {
  const albumId = slugFromFilename(inputPath);
  const suffix = format === "readable" ? ".readable.json" : ".profile.json";
  return join(resultDir, `${albumId}${suffix}`);
}

function decodeAudio(inputPath) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      inputPath,
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-f",
      "f32le",
      "pipe:1",
    ],
    { encoding: "buffer", maxBuffer: 1024 * 1024 * 512 },
  );

  if (result.error) {
    throw new Error(`Failed to run ffmpeg: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.toString("utf8").trim();
    throw new Error(stderr || `ffmpeg exited with status ${result.status}`);
  }

  const sampleCount = Math.floor(result.stdout.length / 4);
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    samples[i] = result.stdout.readFloatLE(i * 4);
  }
  return samples;
}

function analyze(samples, fps) {
  const duration = samples.length / SAMPLE_RATE;
  const frameSize = SAMPLE_RATE / fps;
  const frameCount = Math.ceil(duration * fps);

  const raw = Array.from({ length: frameCount }, () => ({
    rms: 0,
    low: 0,
    mid: 0,
    high: 0,
    flux: 0,
    beat: 0,
    bloom: 0,
  }));

  const lowFilter = new OnePoleLowPass(180, SAMPLE_RATE);
  const midHighPass = new OnePoleHighPass(250, SAMPLE_RATE);
  const midLowPass = new OnePoleLowPass(2400, SAMPLE_RATE);
  const highFilter = new OnePoleHighPass(2500, SAMPLE_RATE);

  let frameIndex = 0;
  let frameEnd = Math.round(frameSize);
  let count = 0;
  let rmsSum = 0;
  let lowSum = 0;
  let midSum = 0;
  let highSum = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const x = clamp(samples[i], -1, 1);
    const low = lowFilter.process(x);
    const mid = midLowPass.process(midHighPass.process(x));
    const high = highFilter.process(x);

    rmsSum += x * x;
    lowSum += low * low;
    midSum += mid * mid;
    highSum += high * high;
    count += 1;

    if (i + 1 >= frameEnd || i + 1 === samples.length) {
      assignFrame(raw[frameIndex], count, rmsSum, lowSum, midSum, highSum);
      frameIndex += 1;
      frameEnd = Math.round((frameIndex + 1) * frameSize);
      count = 0;
      rmsSum = 0;
      lowSum = 0;
      midSum = 0;
      highSum = 0;
    }
  }

  while (frameIndex < frameCount) {
    assignFrame(raw[frameIndex], 1, 0, 0, 0, 0);
    frameIndex += 1;
  }

  for (let i = 1; i < raw.length; i += 1) {
    const prev = raw[i - 1];
    const current = raw[i];
    current.flux =
      Math.max(0, current.low - prev.low) +
      Math.max(0, current.mid - prev.mid) +
      Math.max(0, current.high - prev.high);
  }

  const normalized = normalizeFeatures(raw);
  const beats = detectBeats(normalized, fps);
  for (const beatIndex of beats.indices) {
    normalized[beatIndex].beat = 1;
  }

  for (const frame of normalized) {
    frame.bloom = clamp01(frame.rms * 0.5 + frame.low * 0.25 + frame.flux * 0.25);
  }

  return {
    duration,
    normalizedFrames: normalized,
    beats: beats.times,
  };
}

function assignFrame(frame, count, rmsSum, lowSum, midSum, highSum) {
  frame.rms = Math.sqrt(rmsSum / count);
  frame.low = Math.sqrt(lowSum / count);
  frame.mid = Math.sqrt(midSum / count);
  frame.high = Math.sqrt(highSum / count);
}

function normalizeFeatures(rawFrames) {
  const keys = ["rms", "low", "mid", "high", "flux"];
  const peaks = Object.fromEntries(keys.map((key) => [key, 0]));

  for (const frame of rawFrames) {
    for (const key of keys) {
      peaks[key] = Math.max(peaks[key], frame[key]);
    }
  }

  return rawFrames.map((frame) => {
    const normalized = {};
    for (const key of keys) {
      normalized[key] = peaks[key] > 0 ? clamp01(frame[key] / peaks[key]) : 0;
    }
    normalized.beat = 0;
    normalized.bloom = 0;
    return normalized;
  });
}

function detectBeats(frames, fps) {
  const onset = frames.map((frame) => frame.flux * 0.65 + frame.low * 0.25 + frame.rms * 0.1);
  const window = Math.max(3, Math.round(fps * 1.1));
  const minSpacing = Math.max(1, Math.round(fps * 0.24));
  const indices = [];
  let lastBeat = -Infinity;

  for (let i = 1; i < onset.length - 1; i += 1) {
    if (i - lastBeat < minSpacing) {
      continue;
    }

    const start = Math.max(0, i - window);
    let sum = 0;
    for (let j = start; j < i; j += 1) {
      sum += onset[j];
    }
    const localAverage = i > start ? sum / (i - start) : 0;
    const threshold = Math.max(0.18, localAverage * 1.35);

    if (onset[i] >= onset[i - 1] && onset[i] > onset[i + 1] && onset[i] >= threshold) {
      indices.push(i);
      lastBeat = i;
    }
  }

  return {
    indices,
    times: indices.map((index) => roundTo(index / fps, 3)),
  };
}

function toCompactProfile({ albumId, fps, duration, normalizedFrames, beats }) {
  return {
    version: VERSION,
    albumId,
    fps,
    duration: roundTo(duration, 3),
    channels: CHANNELS,
    frames: normalizedFrames.map((frame) => CHANNELS.map((channel) => quantize(frame[channel]))),
    beats,
  };
}

function toReadableProfile({ albumId, fps, duration, normalizedFrames, beats }) {
  return {
    version: VERSION,
    albumId,
    fps,
    duration: roundTo(duration, 3),
    channels: CHANNELS,
    frames: normalizedFrames.map((frame, index) => {
      const readable = {
        index,
        time: roundTo(index / fps, 3),
      };
      for (const channel of CHANNELS) {
        readable[channel] = quantize(frame[channel]);
      }
      return readable;
    }),
    beats,
  };
}

function createProfile(input, options) {
  const samples = decodeAudio(input);
  const analysis = analyze(samples, options.fps);
  const profileInput = {
    albumId: options.albumId ?? slugFromFilename(input),
    fps: options.fps,
    duration: analysis.duration,
    normalizedFrames: analysis.normalizedFrames,
    beats: analysis.beats,
  };
  const profile =
    options.format === "readable" ? toReadableProfile(profileInput) : toCompactProfile(profileInput);
  return options.format === "readable" ? `${JSON.stringify(profile, null, 2)}\n` : JSON.stringify(profile);
}

function writeProfile(input, options, outputPath) {
  const json = createProfile(input, options);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, json);
}

function runBatch(options) {
  mkdirSync(options.sourceDir, { recursive: true });
  mkdirSync(options.resultDir, { recursive: true });

  const audioFiles = collectAudioFiles(options.sourceDir);

  if (audioFiles.length === 0) {
    console.log(`No audio files found in ${relative(process.cwd(), options.sourceDir) || options.sourceDir}.`);
    console.log(`Put songs in ${DEFAULT_SOURCE_DIR}/, then run: npm run batch`);
    return;
  }

  console.log(`Found ${audioFiles.length} audio file${audioFiles.length === 1 ? "" : "s"}.`);

  let successCount = 0;
  let failureCount = 0;

  for (const inputPath of audioFiles) {
    const outputPath = createOutputPath(inputPath, options.resultDir, options.format);
    const albumId = slugFromFilename(inputPath);

    try {
      writeProfile(inputPath, { ...options, albumId }, outputPath);
      successCount += 1;
      console.log(`OK ${relative(process.cwd(), inputPath)} -> ${relative(process.cwd(), outputPath)}`);
    } catch (error) {
      failureCount += 1;
      console.error(`FAIL ${relative(process.cwd(), inputPath)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failureCount > 0) {
    throw new Error(`Batch finished with ${failureCount} failure${failureCount === 1 ? "" : "s"} and ${successCount} success${successCount === 1 ? "" : "es"}.`);
  }

  console.log(`Done. Wrote ${successCount} profile${successCount === 1 ? "" : "s"} to ${relative(process.cwd(), options.resultDir) || options.resultDir}.`);
}

function quantize(value) {
  return Math.round(clamp01(value) * 255);
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function printHelp() {
  console.log(`Usage:
  npm run analyze -- <audio-file> [options]
  npm run batch

Options:
  --album-id <id>       Album/profile id. Defaults to a slug from the filename.
  --fps <number>        Analysis frame rate. Defaults to 30.
  --format <format>     compact or readable. Defaults to compact.
  --output, -o <path>   Write JSON to a file instead of stdout.
  --batch               Analyze every audio file in source/.
  --source-dir <path>   Batch input folder. Defaults to source.
  --result-dir <path>   Batch output folder. Defaults to result.
  --help, -h            Show this help.
`);
}

function main() {
  const { input, options } = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (options.batch) {
    runBatch(options);
    return;
  }

  if (options.output) {
    const outputPath = resolve(options.output);
    writeProfile(input, options, outputPath);
  } else {
    const json = createProfile(input, options);
    process.stdout.write(json);
    if (options.format === "compact") {
      process.stdout.write("\n");
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

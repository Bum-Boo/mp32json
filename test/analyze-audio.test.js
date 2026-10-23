import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../src/analyze-audio.js", import.meta.url));
const CHANNELS = ["rms", "low", "mid", "high", "flux", "beat", "bloom"];
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const root = mkdtempSync(join(tmpdir(), "mp32json-test-"));
test.after(() => rmSync(root, { recursive: true, force: true }));

function wav(samples, { sampleRate = 22050, float = false } = {}) {
  const bytes = float ? 4 : 2;
  const data = Buffer.alloc(samples.length * bytes);
  samples.forEach((v, i) => (float ? data.writeFloatLE(v, i * 4) : data.writeInt16LE(Math.round(v * 32767), i * 2)));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(float ? 3 : 1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * bytes, 28);
  h.writeUInt16LE(bytes, 32);
  h.writeUInt16LE(bytes * 8, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const tone = (seconds, sr = 22050, hz = 220, amp = 0.5) =>
  Array.from({ length: Math.round(seconds * sr) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / sr));

function click(seconds, sr = 22050, everySec = 0.5) {
  const s = new Array(Math.round(seconds * sr)).fill(0);
  for (let t = 0; t < seconds; t += everySec) {
    for (let k = 0; k < 300; k += 1) s[Math.round(t * sr) + k] = 0.8 * Math.sin(k * 0.9);
  }
  return s;
}

function fixture(name, buf) {
  const path = join(root, name);
  writeFileSync(path, buf);
  return path;
}

function cli(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
}

function assertProfile(profile, fps) {
  assert.equal(profile.version, 1);
  assert.deepEqual(profile.channels, CHANNELS);
  assert.ok(Number.isFinite(profile.fps) && profile.fps === fps);
  assert.ok(Number.isFinite(profile.duration) && profile.duration >= 0);
  // duration is rounded to 3 decimals in the output, so allow that slack.
  assert.ok(profile.frames.length >= Math.ceil(profile.duration * fps - 1e-6));
  assert.ok(profile.frames.length <= Math.ceil((profile.duration + 0.0005) * fps) + 1e-6);
  for (const t of profile.beats) assert.ok(Number.isFinite(t) && t >= 0 && t <= profile.duration + 1 / fps);
}

function assertFrameValues(values) {
  assert.equal(values.length, 7);
  for (const v of values) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, `bad value ${v}`);
}

const profileOf = (path, args = []) => {
  const r = cli([path, ...args]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test("ordinary 24/30/60/23.976 fps: compact and readable agree and satisfy invariants", { skip: !hasFfmpeg && "ffmpeg missing" }, () => {
  const input = fixture("ordinary.wav", wav([...tone(1, 22050, 220, 0.2), ...click(2)]));
  for (const fps of [24, 30, 60, 23.976]) {
    const compact = profileOf(input, ["--fps", String(fps)]);
    const readable = profileOf(input, ["--fps", String(fps), "--format", "readable"]);
    assertProfile(compact, fps);
    assertProfile(readable, fps);
    assert.equal(compact.frames.length, Math.ceil(3 * fps));
    compact.frames.forEach(assertFrameValues);
    assert.deepEqual(readable.beats, compact.beats);
    readable.frames.forEach((f, i) => {
      assert.equal(f.index, i);
      assert.ok(Number.isFinite(f.time));
      assert.deepEqual(CHANNELS.map((c) => f[c]), compact.frames[i]);
    });
    assert.ok(compact.beats.length > 0, "clicks should yield beats");
  }
});

test("default output is compact JSON with trailing newline; readable is pretty", { skip: !hasFfmpeg && "ffmpeg missing" }, () => {
  const input = fixture("fmt.wav", wav(tone(0.5)));
  const c = cli([input]);
  assert.ok(c.stdout.endsWith("}\n") && !c.stdout.includes("\n  "));
  assert.ok(cli([input, "--format", "readable"]).stdout.includes('\n  "frames"'));
});

test("silence yields all-zero channels and no beats", { skip: !hasFfmpeg && "ffmpeg missing" }, () => {
  const p = profileOf(fixture("silence.wav", wav(new Array(22050).fill(0))));
  assertProfile(p, 30);
  assert.equal(p.frames.length, 30);
  assert.ok(p.frames.every((f) => f.every((v) => v === 0)));
  assert.deepEqual(p.beats, []);
});

test("very short clips (1 sample, 10 samples) produce valid profiles", { skip: !hasFfmpeg && "ffmpeg missing" }, () => {
  for (const n of [1, 10]) {
    const p = profileOf(fixture(`short${n}.wav`, wav(new Array(n).fill(0.5))));
    assertProfile(p, 30);
    assert.equal(p.frames.length, 1);
    assertFrameValues(p.frames[0]);
  }
});

test("tone is steady and loud; impulse produces a beat near its position", { skip: !hasFfmpeg && "ffmpeg missing" }, () => {
  const t = profileOf(fixture("tone.wav", wav(tone(1))));
  assert.ok(t.frames.slice(2).every((f) => f[0] >= 250));
  const s = new Array(22050 * 2).fill(0);
  for (let k = 0; k < 200; k += 1) s[22050 + k] = 0.9 * Math.sin(k);
  const imp = profileOf(fixture("impulse.wav", wav(s)));
  assert.ok(imp.beats.some((b) => Math.abs(b - 1) < 0.1), `beats: ${imp.beats}`);
});

test("Unicode file names: slug fallback and --output path", { skip: !hasFfmpeg && "ffmpeg missing" }, () => {
  const input = fixture("음악 ☆ 테스트.wav", wav(tone(0.3)));
  assert.equal(profileOf(input).albumId, "audio-profile");
  const out = join(root, "출력 폴더", "프로필.json");
  const r = cli([input, "--fps", "24", "-o", out, "--album-id", "곡"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "");
  const p = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(p.albumId, "곡");
  assertProfile(p, 24);
});

test("malformed, empty, truncated and missing inputs fail without output", { skip: !hasFfmpeg && "ffmpeg missing" }, () => {
  const good = wav(tone(0.5));
  const cases = {
    garbage: fixture("garbage.wav", Buffer.from("this is not audio at all".repeat(20))),
    empty: fixture("empty.wav", Buffer.alloc(0)),
    headerOnly: fixture("header.wav", good.subarray(0, 44)),
    missing: join(root, "does-not-exist.wav"),
  };
  for (const [name, input] of Object.entries(cases)) {
    const out = join(root, `out-${name}.json`);
    const r = cli([input, "-o", out]);
    assert.equal(r.status, 1, name);
    assert.ok(r.stderr.length > 0, name);
    assert.equal(existsSync(out), false, `${name}: partial output`);
    const so = cli([input]);
    assert.equal(so.status, 1, name);
    assert.equal(so.stdout, "", `${name}: stdout must stay empty`);
  }
  // truncated body is decodable: must still be a consistent profile
  const p = profileOf(fixture("trunc.wav", good.subarray(0, 44 + 1001)));
  assertProfile(p, 30);
});

test("audio-less input (video only) is an error, not an empty profile", { skip: !hasFfmpeg && "ffmpeg missing" }, () => {
  const mp4 = join(root, "video-only.mp4");
  const mk = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:d=0.5:s=64x64:r=10", "-an", mp4]);
  if (mk.status !== 0) return; // encoder unavailable
  const out = join(root, "video.json");
  const r = cli([mp4, "-o", out]);
  assert.equal(r.status, 1);
  assert.equal(existsSync(out), false);
});

test("--fps: invalid, fractional and out-of-range values", { skip: !hasFfmpeg && "ffmpeg missing" }, () => {
  const input = fixture("fps.wav", wav(tone(0.5)));
  for (const bad of ["0", "-0", "-1", "abc", "30abc", "NaN", "Infinity", "1e9", "22051", "44100", "30000", "1,5", " "]) {
    const out = join(root, "fpsbad.json");
    const r = cli([input, "--fps", bad, "-o", out]);
    assert.equal(r.status, 1, `fps ${JSON.stringify(bad)} should fail`);
    assert.match(r.stderr, /--fps/);
    assert.equal(r.stdout, "");
    assert.equal(existsSync(out), false);
  }
  assert.equal(cli([input, "--fps"]).status, 1);
  for (const ok of ["0.05", "0.1", "1e1", "0x10", "12.5", "23.976", "29.97", "22050", "15"]) {
    const p = profileOf(input, ["--fps", ok]);
    assertProfile(p, Number(ok));
    p.frames.forEach(assertFrameValues);
  }
});

test("fps equal to the decoding rate gives one real frame per sample, no fabricated zero tail", { skip: !hasFfmpeg && "ffmpeg missing" }, () => {
  const p = profileOf(fixture("maxfps.wav", wav(tone(0.2))), ["--fps", "22050"]);
  assert.equal(p.frames.length, Math.round(0.2 * 22050));
  assert.ok(p.frames.at(-1)[0] > 0 || p.frames.at(-2)[0] > 0);
});

test("non-finite float PCM is treated as silence, never full scale", { skip: !hasFfmpeg && "ffmpeg missing" }, () => {
  const allBad = fixture("nan-only.wav", wav(new Array(22050).fill(NaN), { float: true }));
  const p = profileOf(allBad);
  assertProfile(p, 30);
  assert.ok(p.frames.every((f) => f.every((v) => v === 0)), "NaN-only audio must be silent");

  const mixed = tone(1).map((v, i) => (i % 500 === 0 ? (i % 1000 === 0 ? NaN : Infinity) : v));
  const m = profileOf(fixture("nan-mixed.wav", wav(mixed, { float: true })));
  assertProfile(m, 30);
  m.frames.forEach(assertFrameValues);
});

test("missing ffmpeg: clear error, exit 1, no output", () => {
  const input = fixture("noffmpeg.wav", wav(tone(0.2)));
  const empty = join(root, "empty-path");
  mkdirSync(empty, { recursive: true });
  const out = join(root, "noffmpeg.json");
  const r = cli([input, "-o", out], { PATH: empty });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ffmpeg/i);
  assert.equal(existsSync(out), false);
});

test("failing ffmpeg (non-zero exit) leaves no output", { skip: process.platform === "win32" }, () => {
  const bin = join(root, "fake-bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "ffmpeg"), "#!/bin/sh\necho 'boom' >&2\nexit 3\n", { mode: 0o755 });
  const out = join(root, "fake.json");
  const r = cli([fixture("fake.wav", wav(tone(0.2))), "-o", out], { PATH: bin });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /boom/);
  assert.equal(existsSync(out), false);
});

test("batch: a malformed file fails without writing its profile; good files still written", { skip: !hasFfmpeg && "ffmpeg missing" }, () => {
  const src = join(root, "batch-src");
  const res = join(root, "batch-res");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "good.wav"), wav(tone(0.3)));
  writeFileSync(join(src, "bad.wav"), "not audio");
  const r = cli(["--batch", "--source-dir", src, "--result-dir", res]);
  assert.equal(r.status, 1);
  assert.deepEqual(readdirSync(res), ["good.profile.json"]);
});

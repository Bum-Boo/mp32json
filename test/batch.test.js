import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { planBatchOutputs } from "../src/batch-plan.js";

const cli = fileURLToPath(new URL("../src/analyze-audio.js", import.meta.url));
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "mp32json-batch-"));
  const sourceDir = join(root, "source");
  const resultDir = join(root, "result");
  mkdirSync(sourceDir);
  mkdirSync(resultDir);
  t.after(() => {
    assert.equal(dirname(root), tmpdir());
    rmSync(root, { recursive: true, force: true });
  });
  return { sourceDir, resultDir };
}

function runBatch(sourceDir, resultDir, format = "compact") {
  return spawnSync(process.execPath, [cli, "--batch", "--source-dir", sourceDir, "--result-dir", resultDir, "--format", format, "--fps", "24"], { encoding: "utf8", timeout: 20_000 });
}

function writeWav(path) {
  const samples = 2205;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(22050, 24);
  wav.writeUInt32LE(44100, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    wav.writeInt16LE(Math.round(Math.sin(index * 0.1) * 5000), 44 + index * 2);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, wav);
}

test("unique names preserve flat output paths, formats, and album IDs", () => {
  for (const format of ["compact", "readable"]) {
    const suffix = format === "readable" ? ".readable.json" : ".profile.json";
    const inputs = [join("source", "nested", "Alpha Song.wav"), join("source", "Beta.mp3")];
    assert.deepEqual(planBatchOutputs(inputs, "result", format), [
      { inputPath: inputs[0], outputPath: join("result", `alpha-song${suffix}`), albumId: "alpha-song" },
      { inputPath: inputs[1], outputPath: join("result", `beta${suffix}`), albumId: "beta" },
    ]);
  }
  assert.deepEqual(planBatchOutputs([], "result", "compact"), []);
});

for (const [name, filenames] of [
  ["recursive basenames", [join("a", "song.wav"), join("b", "song.wav")]],
  ["different extensions", ["song.wav", "song.mp3"]],
  ["normalized punctuation and case", ["A Song.wav", "a-song.wav"]],
  ["non-Latin fallback names", ["노래.wav", "음악.wav"]],
]) {
  test(`collisions from ${name} are rejected for both formats`, () => {
    for (const format of ["compact", "readable"]) {
      assert.throws(() => planBatchOutputs(filenames, "result", format), (error) => {
        assert.match(error.message, /no profiles were written/);
        for (const filename of filenames) assert.ok(error.message.includes(filename));
        return true;
      });
    }
  });
}

test("CLI preflight rejects recursive collisions before any decoding or partial overwrite", (t) => {
  const { sourceDir, resultDir } = fixture(t);
  // Invalid bytes prove the collision check happens before ffmpeg can run.
  writeFileSync(join(sourceDir, "a-unique.wav"), "not audio");
  for (const subdir of ["a", "b"]) {
    mkdirSync(join(sourceDir, subdir));
    writeFileSync(join(sourceDir, subdir, "same.wav"), "not audio");
  }
  for (const format of ["compact", "readable"]) {
    const suffix = format === "readable" ? ".readable.json" : ".profile.json";
    const existingPath = join(resultDir, `same${suffix}`);
    writeFileSync(existingPath, "previous result");
    const result = runBatch(sourceDir, resultDir, format);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Batch output collisions detected; no profiles were written/);
    assert.ok(result.stderr.includes(join(sourceDir, "a", "same.wav")));
    assert.ok(result.stderr.includes(join(sourceDir, "b", "same.wav")));
    assert.equal(readFileSync(existingPath, "utf8"), "previous result");
    assert.ok(!readdirSync(resultDir).includes(`a-unique${suffix}`));
    assert.doesNotMatch(result.stdout, /OK |Done\./);
  }
});

test("CLI analyzes two unique recursive inputs and replaces previous results as before", { skip: hasFfmpeg ? false : "ffmpeg is required for real analysis" }, (t) => {
  const { sourceDir, resultDir } = fixture(t);
  writeWav(join(sourceDir, "nested", "Alpha Song.WAV"));
  writeWav(join(sourceDir, "Beta.wav"));
  writeFileSync(join(sourceDir, "ignored.txt"), "not audio");
  for (const format of ["compact", "readable"]) {
    const suffix = format === "readable" ? ".readable.json" : ".profile.json";
    writeFileSync(join(resultDir, `alpha-song${suffix}`), "previous result");
    const result = runBatch(sourceDir, resultDir, format);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Wrote 2 profiles/);
    for (const albumId of ["alpha-song", "beta"]) {
      const profile = JSON.parse(readFileSync(join(resultDir, `${albumId}${suffix}`), "utf8"));
      assert.equal(profile.albumId, albumId);
      assert.equal(profile.fps, 24);
      assert.equal(profile.duration, 0.1);
      assert.equal(profile.frames.length, 3);
      assert.equal(profile.channels.length, 7);
      assert.equal(Array.isArray(profile.frames[0]), format === "compact");
    }
  }
});

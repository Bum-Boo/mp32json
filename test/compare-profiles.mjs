// Usage: node test/compare-profiles.mjs <path/to/analyze-audio.js>
// Prints sha256 of ordinary 24/30/60/23.976 fps profiles (compact + readable) of a
// deterministic synthetic WAV, for before/after comparison of two versions of the CLI.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = process.argv[2];
const sr = 44100;
const n = sr * 3;
const b = Buffer.alloc(44 + n * 2);
b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i += 1) {
  const t = i / sr;
  let v = 0.3 * Math.sin(2 * Math.PI * 220 * t) * (t > 1 ? 1 : 0.2);
  if (i % (sr / 2) < 400) v += 0.6 * Math.sin(i * 0.9);
  b.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
}
const dir = mkdtempSync(join(tmpdir(), "cmp-"));
const wav = join(dir, "base.wav");
writeFileSync(wav, b);
for (const fps of ["24", "30", "60", "23.976"]) {
  for (const format of ["compact", "readable"]) {
    const r = spawnSync(process.execPath, [cli, wav, "--fps", fps, "--format", format], { encoding: "buffer" });
    if (r.status !== 0) throw new Error(r.stderr.toString());
    console.log(createHash("sha256").update(r.stdout).digest("hex"), `fps=${fps}`, format);
  }
}
rmSync(dir, { recursive: true, force: true });

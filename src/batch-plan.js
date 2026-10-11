import { basename, extname, join } from "node:path";

export function slugFromFilename(path) {
  const name = basename(path, extname(path)).toLowerCase();
  const slug = name
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "audio-profile";
}

export function createOutputPath(inputPath, resultDir, format) {
  const albumId = slugFromFilename(inputPath);
  const suffix = format === "readable" ? ".readable.json" : ".profile.json";
  return join(resultDir, `${albumId}${suffix}`);
}

// Plan the whole batch before decoding or writing any profile. Different input
// folders, extensions, or spellings can all collapse to the same output slug.
export function planBatchOutputs(audioFiles, resultDir, format) {
  const destinations = new Map();
  const jobs = audioFiles.map((inputPath) => {
    const outputPath = createOutputPath(inputPath, resultDir, format);
    const inputs = destinations.get(outputPath) ?? [];
    inputs.push(inputPath);
    destinations.set(outputPath, inputs);
    return { inputPath, outputPath, albumId: slugFromFilename(inputPath) };
  });

  const collisions = [...destinations].filter(([, inputs]) => inputs.length > 1);
  if (collisions.length > 0) {
    const details = collisions
      .map(([outputPath, inputs]) => `${outputPath}: ${inputs.join(", ")}`)
      .join("\n");
    throw new Error(
      `Batch output collisions detected; no profiles were written.\n${details}\nUse input filenames with unique slugs.`,
    );
  }
  return jobs;
}

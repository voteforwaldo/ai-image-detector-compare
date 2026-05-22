import fs from "fs/promises";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { explainExifTags } from "./exiftool-explain.mjs";

const EXIF_TIMEOUT_MS = Number(process.env.EXIFTOOL_TIMEOUT_MS) || 20_000;
const ON_VERCEL = process.env.VERCEL === "1";

let exiftoolSingleton = null;

function extensionFrom(filename, mimeType) {
  const fromName = path.extname(filename || "");
  if (fromName) return fromName;
  const map = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "image/tiff": ".tiff",
  };
  return map[mimeType] || ".bin";
}

const SKIP_ALL_FIELDS = new Set([
  "SourceFile",
  "Directory",
  "FilePermissions",
  "FileInodeChangeDate",
  "FileAccessDate",
  "FileModifyDate",
  "FileCreateDate",
]);

function formatTagValue(value) {
  if (value == null || value === "") return null;
  if (Array.isArray(value)) return value.filter((v) => v != null && v !== "").map(String).join(", ");
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function allFieldsFromTags(tags) {
  return Object.entries(tags)
    .filter(([key, value]) => !SKIP_ALL_FIELDS.has(key) && formatTagValue(value))
    .sort(([a], [b]) => a.localeCompare(b, "bg"))
    .map(([label, value]) => ({ label, value: formatTagValue(value) }));
}

function buildResult(tags, explained) {
  return {
    provider: "exiftool",
    ok: true,
    summary: explained.summary,
    highlights: explained.highlights,
    facts: explained.facts,
    tagCount: explained.tagCount,
    hasAiMarkers: explained.hasAiMarkers,
    allFields: allFieldsFromTags(tags),
    tags: pickTags(tags),
  };
}

function exifFailure(message) {
  return {
    provider: "exiftool",
    ok: false,
    error: message,
    highlights: [],
    allFields: [],
    tagCount: 0,
    hasAiMarkers: false,
  };
}

const INTERESTING_TAGS = [
  "FileType",
  "MIMEType",
  "FileSize",
  "ImageWidth",
  "ImageHeight",
  "Megapixels",
  "Make",
  "Model",
  "LensModel",
  "Lens",
  "Software",
  "CreatorTool",
  "ProcessingSoftware",
  "HistorySoftwareAgent",
  "DateTimeOriginal",
  "CreateDate",
  "ModifyDate",
  "GPSPosition",
  "GPSLatitude",
  "GPSLongitude",
  "Artist",
  "Creator",
  "Copyright",
  "ImageDescription",
  "Title",
  "ClaimGenerator",
  "DigitalSourceType",
  "ContentIdentifier",
  "C2PA",
  "JUMBF",
  "PNG:Parameters",
  "Parameters",
  "ProfileDescription",
  "ColorSpace",
];

function pickTags(tags) {
  const out = {};
  for (const key of INTERESTING_TAGS) {
    if (tags[key] != null && tags[key] !== "") out[key] = tags[key];
  }
  for (const [key, value] of Object.entries(tags)) {
    if (out[key] != null) continue;
    if (/c2pa|jumbf|claim|credential|ai|generat|synth|trained/i.test(key)) {
      if (value != null && value !== "") out[key] = value;
    }
  }
  return out;
}

async function getLocalExiftool() {
  if (exiftoolSingleton) return exiftoolSingleton;
  const { exiftool } = await import("exiftool-vendored");
  exiftoolSingleton = exiftool;
  return exiftoolSingleton;
}

async function readWithTimeout(et, filePath) {
  return Promise.race([
    et.read(filePath),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("ExifTool timeout")), EXIF_TIMEOUT_MS);
    }),
  ]);
}

/** Vercel/Lambda: dedicated instance, always closed — avoids crashing the whole function. */
async function readOnServerless(tmpPath) {
  const { ExifTool } = await import("exiftool-vendored");
  const et = new ExifTool({
    maxProcs: 1,
    maxTasksPerProcess: 1,
    taskTimeoutMillis: EXIF_TIMEOUT_MS,
  });
  try {
    const tags = await readWithTimeout(et, tmpPath);
    return buildResult(tags, explainExifTags(tags));
  } finally {
    await et.end().catch(() => {});
  }
}

async function readLocally(tmpPath) {
  const et = await getLocalExiftool();
  const tags = await readWithTimeout(et, tmpPath);
  return buildResult(tags, explainExifTags(tags));
}

export async function analyzeWithExiftool(buffer, filename, mimeType) {
  const ext = extensionFrom(filename, mimeType);
  const tmpPath = path.join(os.tmpdir(), `exif-${randomUUID()}${ext}`);

  try {
    await fs.writeFile(tmpPath, buffer);
    return ON_VERCEL ? await readOnServerless(tmpPath) : await readLocally(tmpPath);
  } catch (err) {
    const msg = err?.message || String(err);
    console.error("ExifTool error:", msg);
    if (/perl|exiftool|enoent|not found|timeout/i.test(msg)) {
      return exifFailure(
        ON_VERCEL
          ? "ExifTool не успя в cloud средата (липсва Perl binary или време). AI or Not и Gemini продължават."
          : "ExifTool не е наличен. Локално: npm install && Node 20+."
      );
    }
    return exifFailure(`ExifTool: ${msg.slice(0, 280)}`);
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
}

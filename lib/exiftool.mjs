import fs from "fs/promises";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { explainExifTags } from "./exiftool-explain.mjs";

let exiftoolSingleton = null;

async function getExiftool() {
  if (exiftoolSingleton) return exiftoolSingleton;
  const { exiftool } = await import("exiftool-vendored");
  exiftoolSingleton = exiftool;
  return exiftool;
}

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

export async function analyzeWithExiftool(buffer, filename, mimeType) {
  const ext = extensionFrom(filename, mimeType);
  const tmpPath = path.join(os.tmpdir(), `exif-${randomUUID()}${ext}`);

  try {
    await fs.writeFile(tmpPath, buffer);
    const et = await getExiftool();
    const tags = await et.read(tmpPath);
    const explained = explainExifTags(tags);
    const selectedTags = pickTags(tags);

    const allFields = allFieldsFromTags(tags);

    return {
      provider: "exiftool",
      ok: true,
      summary: explained.summary,
      highlights: explained.highlights,
      facts: explained.facts,
      tagCount: explained.tagCount,
      hasAiMarkers: explained.hasAiMarkers,
      allFields,
      tags: selectedTags,
    };
  } catch (err) {
    const msg = err?.message || String(err);
    if (/perl|exiftool|enoent|not found/i.test(msg)) {
      throw new Error(
        "ExifTool не е наличен на сървъра. Локално: npm install. На Vercel: redeploy след npm install."
      );
    }
    throw new Error(`ExifTool: ${msg.slice(0, 280)}`);
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
}

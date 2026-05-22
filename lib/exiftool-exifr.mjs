import { explainExifTags } from "./exiftool-explain.mjs";

function formatTagValue(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.filter((v) => v != null && v !== "").map(String).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function flattenTags(obj, prefix = "") {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    const label = prefix ? `${prefix}:${key}` : key;
    if (
      value &&
      typeof value === "object" &&
      !(value instanceof Date) &&
      !Array.isArray(value)
    ) {
      Object.assign(out, flattenTags(value, label));
    } else {
      const formatted = formatTagValue(value);
      if (formatted != null) out[label] = formatted;
    }
  }
  return out;
}

function enrichTags(tags, buffer, filename, mimeType) {
  const ext = (filename || "").split(".").pop()?.toUpperCase();
  return {
    FileType: ext || undefined,
    MIMEType: mimeType || undefined,
    FileSize: buffer?.length,
    ...tags,
  };
}

function allFieldsFromTags(tags) {
  return Object.entries(tags)
    .filter(([, value]) => formatTagValue(value))
    .sort(([a], [b]) => a.localeCompare(b, "bg"))
    .map(([label, value]) => ({ label, value: formatTagValue(value) }));
}

function buildResult(tags, explained) {
  return {
    provider: "exiftool",
    method: "exifr",
    ok: true,
    summary: explained.summary,
    highlights: explained.highlights,
    facts: explained.facts,
    tagCount: explained.tagCount,
    hasAiMarkers: explained.hasAiMarkers,
    allFields: allFieldsFromTags(tags),
    tags,
  };
}

export async function analyzeWithExifr(buffer, filename, mimeType) {
  const mod = await import("exifr");
  const exifr = mod.default ?? mod;
  const raw = await exifr.parse(buffer, {
    xmp: true,
    icc: true,
    iptc: true,
    jfif: true,
    tiff: true,
    mergeOutput: true,
  });

  const tags = enrichTags(flattenTags(raw || {}), buffer, filename, mimeType);
  const explained = explainExifTags(tags);
  return buildResult(tags, explained);
}

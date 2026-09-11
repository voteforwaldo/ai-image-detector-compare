import {
  buildAnalyzePayload,
  getApiKeys,
  MAX_UPLOAD_BYTES,
  missingKeyMessage,
} from "../lib/api-helpers.mjs";
import { sendJson, withJson } from "../lib/api-util.mjs";
import { isAuthenticated, authDeniedResponse } from "../lib/site-auth.mjs";

export const maxDuration = 300;

function parseMultipart(buffer, contentType) {
  const boundaryMatch = /boundary=(.+)$/i.exec(contentType || "");
  if (!boundaryMatch) throw new Error("Очаквани са multipart form данни");
  const boundary = boundaryMatch[1].replace(/"/g, "");
  const parts = buffer.toString("binary").split(`--${boundary}`);

  let fileBuffer = null;
  let filename = "upload.jpg";
  let mimeType = "image/jpeg";
  let aiornotKey = "";
  let geminiKey = "";

  for (const part of parts) {
    if (!part || part === "--\r\n" || part === "--") continue;
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const headers = part.slice(0, headerEnd);
    const body = part.slice(headerEnd + 4).replace(/\r\n$/, "");
    const nameMatch = /name="([^"]+)"/i.exec(headers);
    const filenameMatch = /filename="([^"]+)"/i.exec(headers);
    const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headers);
    const name = nameMatch?.[1];

    if (name === "image" && filenameMatch) {
      fileBuffer = Buffer.from(body, "binary");
      filename = filenameMatch[1];
      if (typeMatch) mimeType = typeMatch[1].trim();
    } else if (name === "aiornot_key") {
      aiornotKey = Buffer.from(body, "binary").toString("utf8").trim();
    } else if (name === "gemini_key") {
      geminiKey = Buffer.from(body, "binary").toString("utf8").trim();
    }
  }

  if (!fileBuffer?.length) throw new Error("В заявката няма файл с изображение");
  return { fileBuffer, filename, mimeType, aiornotKey, geminiKey };
}

async function readRawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_UPLOAD_BYTES) {
      const err = new Error("Файлът е твърде голям (макс. 4 МБ). Намалете изображението.");
      err.code = "payload_too_large";
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export default withJson(async (req, res) => {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Методът не е позволен" });
    return;
  }

  if (!isAuthenticated(req.headers.cookie)) {
    const denied = authDeniedResponse();
    sendJson(res, denied.status, denied.body);
    return;
  }

  let body;
  try {
    body = await readRawBody(req);
  } catch (err) {
    const status = err?.code === "payload_too_large" ? 413 : 400;
    sendJson(res, status, {
      error: err?.message || "Невалидна заявка",
      code: err?.code || "bad_request",
    });
    return;
  }

  let fileBuffer;
  let filename;
  let mimeType;
  let aiornotKey;
  let geminiKey;
  try {
    ({ fileBuffer, filename, mimeType, aiornotKey, geminiKey } = parseMultipart(
      body,
      req.headers["content-type"]
    ));
  } catch (err) {
    sendJson(res, 400, { error: err?.message || "Невалидна заявка", code: "bad_request" });
    return;
  }

  const trimKey = (v) => String(v || "").trim().replace(/^["']|["']$/g, "");
  const envKeys = getApiKeys();
  const keys = {
    aiornotKey: trimKey(aiornotKey || envKeys.aiornotKey),
    geminiKey: trimKey(geminiKey || envKeys.geminiKey),
  };

  const keyError = missingKeyMessage(keys);
  if (keyError) {
    sendJson(res, 400, { error: keyError, code: "missing_keys" });
    return;
  }

  const { analyzeImage } = await import("../lib/analyze.mjs");
  const result = await analyzeImage(fileBuffer, filename, mimeType, keys);
  sendJson(res, 200, buildAnalyzePayload(result));
});

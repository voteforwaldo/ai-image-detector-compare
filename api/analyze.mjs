import { sendJson, withJson } from "../lib/api-util.mjs";

export const config = {
  api: {
    bodyParser: false,
  },
};

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
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export default withJson(async (req, res) => {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Методът не е позволен" });
    return;
  }

  const { isAuthenticated, authDeniedResponse } = await import("../lib/site-auth.mjs");

  if (!isAuthenticated(req.headers.cookie)) {
    const denied = authDeniedResponse();
    sendJson(res, denied.status, denied.body);
    return;
  }

  const body = await readRawBody(req);
  const { fileBuffer, filename, mimeType, aiornotKey, geminiKey } = parseMultipart(
    body,
    req.headers["content-type"]
  );

  const trimKey = (v) => String(v || "").trim().replace(/^["']|["']$/g, "");
  const keys = {
    aiornotKey: trimKey(aiornotKey || process.env.AIORNOT_API_KEY),
    geminiKey: trimKey(geminiKey || process.env.GEMINI_API_KEY),
  };

  if (!keys.aiornotKey || !keys.geminiKey) {
    sendJson(res, 400, {
      error:
        "Липсват API ключове. Задайте AIORNOT_API_KEY и GEMINI_API_KEY в Vercel.",
      code: "missing_keys",
    });
    return;
  }

  const { analyzeImage } = await import("../lib/analyze.mjs");
  const result = await analyzeImage(fileBuffer, filename, mimeType, keys);
  const payload = {
    aiornot: result.aiornot,
    gemini: result.gemini
      ? {
          ...result.gemini,
          rawText: undefined,
        }
      : result.gemini,
    exiftool: result.exiftool,
  };
  if (payload.aiornot?.ok) {
    payload.aiornot = { ...payload.aiornot, raw: undefined };
  }
  sendJson(res, 200, payload);
});

import {
  buildAnalyzePayload,
  getApiKeys,
  MAX_UPLOAD_BYTES,
  missingKeyMessage,
} from "../lib/api-helpers.mjs";
import { isAuthenticated, authDeniedResponse } from "../lib/site-auth.mjs";

export const maxDuration = 300;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request) {
  const cookie = request.headers.get("cookie") || "";
  if (!isAuthenticated(cookie)) {
    const denied = authDeniedResponse();
    return json(denied.body, denied.status);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_UPLOAD_BYTES) {
    return json(
      { error: "Файлът е твърде голям (макс. 4 МБ).", code: "payload_too_large" },
      413
    );
  }

  try {
    const form = await request.formData();
    const image = form.get("image");
    if (!image || typeof image === "string") {
      return json({ error: "В заявката няма файл с изображение" }, 400);
    }
    if (image.size > MAX_UPLOAD_BYTES) {
      return json(
        { error: "Файлът е твърде голям (макс. 4 МБ).", code: "payload_too_large" },
        413
      );
    }

    const fileBuffer = Buffer.from(await image.arrayBuffer());
    const filename = image.name || "upload.jpg";
    const mimeType = image.type || "image/jpeg";
    const trimKey = (v) => String(v || "").trim().replace(/^["']|["']$/g, "");
    const envKeys = getApiKeys();
    const keys = {
      aiornotKey: trimKey(form.get("aiornot_key") || envKeys.aiornotKey),
      geminiKey: trimKey(form.get("gemini_key") || envKeys.geminiKey),
    };

    const keyError = missingKeyMessage(keys);
    if (keyError) {
      return json({ error: keyError, code: "missing_keys" }, 400);
    }

    const { analyzeImage } = await import("../lib/analyze.mjs");
    const result = await analyzeImage(fileBuffer, filename, mimeType, keys);
    return json(buildAnalyzePayload(result));
  } catch (err) {
    console.error("analyze error:", err);
    return json({ error: err?.message || "Анализът не успя", code: "server_error" }, 500);
  }
}

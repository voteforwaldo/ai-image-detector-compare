import {
  jsonResponse,
  methodNotAllowed,
  optionsResponse,
  getApiKeys,
  missingKeyMessage,
  buildAnalyzePayload,
  MAX_UPLOAD_BYTES,
} from "../lib/api-helpers.mjs";
import { isAuthenticated, authDeniedResponse } from "../lib/site-auth.mjs";
import { analyzeImage } from "../lib/analyze.mjs";

export const maxDuration = 300;

export default async function handler(request) {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return methodNotAllowed();

  if (!isAuthenticated(request.headers.get("cookie") || "")) {
    const denied = authDeniedResponse();
    return jsonResponse(denied.body, denied.status);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_UPLOAD_BYTES) {
    return jsonResponse(
      {
        error: "Файлът е твърде голям (макс. 4 МБ). Намалете изображението.",
        code: "payload_too_large",
      },
      413
    );
  }

  try {
    const form = await request.formData();
    const image = form.get("image");
    if (!image || typeof image === "string") {
      return jsonResponse({ error: "В заявката няма файл с изображение" }, 400);
    }

    if (image.size > MAX_UPLOAD_BYTES) {
      return jsonResponse(
        {
          error: "Файлът е твърде голям (макс. 4 МБ).",
          code: "payload_too_large",
        },
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
      return jsonResponse({ error: keyError, code: "missing_keys" }, 400);
    }

    const result = await analyzeImage(fileBuffer, filename, mimeType, keys);
    return jsonResponse(buildAnalyzePayload(result));
  } catch (err) {
    console.error("analyze error:", err);
    return jsonResponse(
      { error: err?.message || "Анализът не успя", code: "server_error" },
      500
    );
  }
}

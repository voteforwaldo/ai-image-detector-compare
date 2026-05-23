const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

export function optionsResponse() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function methodNotAllowed() {
  return jsonResponse({ error: "Методът не е позволен" }, 405);
}

export function getApiKeys() {
  const trimKey = (v) => String(v || "").trim().replace(/^["']|["']$/g, "");
  return {
    aiornotKey: trimKey(process.env.AIORNOT_API_KEY),
    geminiKey: trimKey(process.env.GEMINI_API_KEY),
  };
}

export function missingKeyMessage(keys) {
  const missing = [];
  if (!keys.aiornotKey) missing.push("AIORNOT_API_KEY");
  if (!keys.geminiKey) missing.push("GEMINI_API_KEY");
  if (!missing.length) return null;
  return `Липсват API ключове. Задайте ${missing.join(" и ")} в Vercel Environment Variables.`;
}

export function buildAnalyzePayload(result) {
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
  return payload;
}

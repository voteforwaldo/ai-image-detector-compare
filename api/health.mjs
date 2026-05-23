import { jsonResponse, methodNotAllowed, optionsResponse } from "../lib/api-helpers.mjs";

export default async function handler(request) {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "GET") return methodNotAllowed();
  return jsonResponse({ ok: true, service: "ai-image-detector" });
}

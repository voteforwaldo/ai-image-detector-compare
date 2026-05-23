import { jsonResponse, methodNotAllowed, optionsResponse } from "../lib/api-helpers.mjs";
import { isAuthRequired, isAuthenticated } from "../lib/site-auth.mjs";

export default async function handler(request) {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "GET") return methodNotAllowed();

  return jsonResponse({
    required: isAuthRequired(),
    authenticated: isAuthenticated(request.headers.get("cookie") || ""),
  });
}

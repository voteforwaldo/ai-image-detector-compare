import { jsonResponse, methodNotAllowed, optionsResponse } from "../lib/api-helpers.mjs";
import {
  isAuthRequired,
  verifyPassword,
  buildSessionCookie,
} from "../lib/site-auth.mjs";

export default async function handler(request) {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return methodNotAllowed();

  if (!isAuthRequired()) {
    return jsonResponse({ ok: true, required: false });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Невалиден JSON в заявката" }, 400);
  }

  if (!verifyPassword(body.password)) {
    return jsonResponse({ error: "Грешна парола" }, 401);
  }

  return jsonResponse({ ok: true, required: true }, 200, {
    "Set-Cookie": buildSessionCookie(),
  });
}

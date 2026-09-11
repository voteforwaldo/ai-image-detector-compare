import {
  isAuthRequired,
  verifyPassword,
  buildSessionCookie,
} from "../lib/site-auth.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request) {
  if (!isAuthRequired()) {
    return json({ ok: true, required: false });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: "Невалиден JSON в заявката" }, 400);
  }

  if (!verifyPassword(body.password)) {
    return json({ error: "Грешна парола" }, 401);
  }

  return json({ ok: true, required: true }, 200, {
    "Set-Cookie": buildSessionCookie(),
  });
}

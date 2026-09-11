import { isAuthRequired, isAuthenticated } from "../lib/site-auth.mjs";

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

export function GET(request) {
  const cookie = request.headers.get("cookie") || "";
  return json({
    required: isAuthRequired(),
    authenticated: isAuthenticated(cookie),
  });
}

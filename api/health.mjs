const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export function GET() {
  return new Response(
    JSON.stringify({ ok: true, service: "ai-image-detector", entry: "api-web-v4" }),
    {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
    }
  );
}

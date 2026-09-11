import { handleRequest } from "./lib/http-router.mjs";

export const maxDuration = 300;

/** Vercel Node entry: default export (not server.listen). Local: use npm start / dev-server.mjs. */
export default async function handler(req, res) {
  try {
    await handleRequest(req, res);
  } catch (err) {
    console.error("Unhandled request error:", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Вътрешна грешка на сървъра", code: "server_error" }));
    }
  }
}

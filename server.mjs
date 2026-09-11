import http from "http";
import { handleRequest } from "./lib/http-router.mjs";

export const maxDuration = 300;

const PORT = Number(process.env.PORT || 3000);

const server = http.createServer((req, res) => {
  Promise.resolve(handleRequest(req, res)).catch((err) => {
    console.error("Unhandled request error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Вътрешна грешка на сървъра", code: "server_error" }));
    }
  });
});

server.listen(PORT);

console.log(`ai-image-detector server listening on ${PORT}`);

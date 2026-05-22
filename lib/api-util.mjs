const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }

  if (typeof res.status === "function" && typeof res.json === "function") {
    res.status(status).json(body);
    return;
  }

  res.statusCode = status;
  if (typeof res.end === "function") {
    res.end(payload);
  } else if (typeof res.send === "function") {
    res.send(payload);
  }
}

export async function readJsonBody(req, maxBytes = 64 * 1024) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new Error("Заявката е твърде голяма");
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

export function withJson(handler) {
  return async (req, res) => {
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      res.setHeader(key, value);
    }

    if (req.method === "OPTIONS") {
      if (typeof res.status === "function") {
        res.status(204).end();
      } else {
        res.statusCode = 204;
        res.end();
      }
      return;
    }

    try {
      await handler(req, res);
    } catch (err) {
      console.error("API error:", err);
      if (!res.headersSent) {
        sendJson(res, 500, {
          error: err?.message || "Вътрешна грешка на сървъра",
          code: "server_error",
        });
      }
    }
  };
}

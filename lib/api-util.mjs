export function sendJson(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(status).json(body);
}

export function withJson(handler) {
  return async (req, res) => {
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.status(204).end();
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

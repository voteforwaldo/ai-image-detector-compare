import { readJsonBody, sendJson, withJson } from "../lib/api-util.mjs";

export default withJson(async (req, res) => {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Методът не е позволен" });
    return;
  }

  const { isAuthRequired, verifyPassword, buildSessionCookie } = await import(
    "../lib/site-auth.mjs"
  );

  if (!isAuthRequired()) {
    sendJson(res, 200, { ok: true, required: false });
    return;
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "Невалиден JSON в заявката" });
    return;
  }

  if (!verifyPassword(body.password)) {
    sendJson(res, 401, { error: "Грешна парола" });
    return;
  }

  res.setHeader("Set-Cookie", buildSessionCookie());
  sendJson(res, 200, { ok: true, required: true });
});

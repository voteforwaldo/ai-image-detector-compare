import { sendJson, withJson } from "../lib/api-util.mjs";

export default withJson(async (req, res) => {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Методът не е позволен" });
    return;
  }

  const { isAuthRequired, isAuthenticated } = await import("../lib/site-auth.mjs");

  sendJson(res, 200, {
    required: isAuthRequired(),
    authenticated: isAuthenticated(req.headers.cookie),
  });
});

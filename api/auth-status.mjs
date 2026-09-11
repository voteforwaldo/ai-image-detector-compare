import { sendJson, withJson } from "../lib/api-util.mjs";
import { isAuthRequired, isAuthenticated } from "../lib/site-auth.mjs";

export default withJson(async (req, res) => {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Методът не е позволен" });
    return;
  }

  sendJson(res, 200, {
    required: isAuthRequired(),
    authenticated: isAuthenticated(req.headers.cookie),
  });
});

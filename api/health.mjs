import { sendJson, withJson } from "../lib/api-util.mjs";

export default withJson(async (req, res) => {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Методът не е позволен" });
    return;
  }
  sendJson(res, 200, { ok: true, service: "ai-image-detector" });
});

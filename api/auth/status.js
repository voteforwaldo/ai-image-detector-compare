import { isAuthRequired, isAuthenticated } from "../../lib/site-auth.mjs";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Методът не е позволен" });
    return;
  }

  res.status(200).json({
    required: isAuthRequired(),
    authenticated: isAuthenticated(req.headers.cookie),
  });
}

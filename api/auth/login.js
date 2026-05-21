import {
  isAuthRequired,
  verifyPassword,
  buildSessionCookie,
} from "../../lib/site-auth.mjs";

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Методът не е позволен" });
    return;
  }

  if (!isAuthRequired()) {
    res.status(200).json({ ok: true, required: false });
    return;
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};

  if (!verifyPassword(body.password)) {
    res.status(401).json({ error: "Грешна парола" });
    return;
  }

  res.setHeader("Set-Cookie", buildSessionCookie());
  res.status(200).json({ ok: true, required: true });
}

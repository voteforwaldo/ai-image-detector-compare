import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildAnalyzePayload,
  getApiKeys,
  MAX_UPLOAD_BYTES,
  missingKeyMessage,
} from "./api-helpers.mjs";
import {
  isAuthRequired,
  isAuthenticated,
  verifyPassword,
  buildSessionCookie,
  authDeniedResponse,
} from "./site-auth.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "..", "public");
const ON_VERCEL = process.env.VERCEL === "1";
const MAX_BYTES = ON_VERCEL ? MAX_UPLOAD_BYTES : 50 * 1024 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
};

function requestPath(req) {
  try {
    return new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname;
  } catch {
    return (req.url || "/").split("?")[0];
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        const mb = Math.round(MAX_BYTES / (1024 * 1024));
        const err = new Error(`Файлът е твърде голям (макс. ${mb} МБ)`);
        err.code = "payload_too_large";
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = /boundary=(.+)$/i.exec(contentType || "");
  if (!boundaryMatch) throw new Error("Очаквани са multipart form данни");
  const boundary = boundaryMatch[1].replace(/"/g, "");
  const parts = buffer.toString("binary").split(`--${boundary}`);

  let fileBuffer = null;
  let filename = "upload.jpg";
  let mimeType = "image/jpeg";
  let aiornotKey = "";
  let geminiKey = "";

  for (const part of parts) {
    if (!part || part === "--\r\n" || part === "--") continue;
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const headers = part.slice(0, headerEnd);
    const body = part.slice(headerEnd + 4).replace(/\r\n$/, "");

    const nameMatch = /name="([^"]+)"/i.exec(headers);
    const filenameMatch = /filename="([^"]+)"/i.exec(headers);
    const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headers);
    const name = nameMatch?.[1];

    if (name === "image" && filenameMatch) {
      fileBuffer = Buffer.from(body, "binary");
      filename = filenameMatch[1];
      if (typeMatch) mimeType = typeMatch[1].trim();
    } else if (name === "aiornot_key") {
      aiornotKey = Buffer.from(body, "binary").toString("utf8").trim();
    } else if (name === "gemini_key") {
      geminiKey = Buffer.from(body, "binary").toString("utf8").trim();
    }
  }

  if (!fileBuffer?.length) throw new Error("В заявката няма файл с изображение");
  return { fileBuffer, filename, mimeType, aiornotKey, geminiKey };
}

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...extraHeaders });
  res.end(JSON.stringify(body));
}

async function handleAuthStatus(req, res) {
  json(res, 200, {
    required: isAuthRequired(),
    authenticated: isAuthenticated(req.headers.cookie),
  });
}

async function handleAuthLogin(req, res) {
  try {
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    if (!isAuthRequired()) {
      json(res, 200, { ok: true, required: false });
      return;
    }
    if (!verifyPassword(body.password)) {
      json(res, 401, { error: "Грешна парола" });
      return;
    }
    json(res, 200, { ok: true, required: true }, { "Set-Cookie": buildSessionCookie() });
  } catch {
    json(res, 400, { error: "Невалидни данни" });
  }
}

async function handleAnalyze(req, res) {
  if (!isAuthenticated(req.headers.cookie)) {
    const denied = authDeniedResponse();
    json(res, denied.status, denied.body);
    return;
  }

  try {
    const body = await readBody(req);
    const { fileBuffer, filename, mimeType, aiornotKey, geminiKey } = parseMultipart(
      body,
      req.headers["content-type"]
    );

    const trimKey = (v) => String(v || "").trim().replace(/^["']|["']$/g, "");
    const envKeys = getApiKeys();
    const keys = {
      aiornotKey: trimKey(aiornotKey || envKeys.aiornotKey),
      geminiKey: trimKey(geminiKey || envKeys.geminiKey),
    };

    const keyError = missingKeyMessage(keys);
    if (keyError) {
      json(res, 400, { error: keyError, code: "missing_keys" });
      return;
    }

    const { analyzeImage } = await import("./analyze.mjs");
    const result = await analyzeImage(fileBuffer, filename, mimeType, keys);
    json(res, 200, buildAnalyzePayload(result));
  } catch (err) {
    const status = err?.code === "payload_too_large" ? 413 : 500;
    json(res, status, {
      error: err?.message || "Анализът не успя",
      code: err?.code || "server_error",
    });
  }
}

function serveStatic(req, res) {
  let urlPath = requestPath(req);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.normalize(path.join(PUBLIC, urlPath));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403);
    res.end("Забранено");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Не е намерено");
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

export async function handleRequest(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const pathname = requestPath(req);

    if (req.method === "GET" && (pathname === "/api/auth-status" || pathname === "/api/auth/status")) {
      await handleAuthStatus(req, res);
      return;
    }

    if (req.method === "POST" && (pathname === "/api/auth-login" || pathname === "/api/auth/login")) {
      await handleAuthLogin(req, res);
      return;
    }

    if (req.method === "GET" && pathname === "/api/health") {
      json(res, 200, { ok: true, service: "ai-image-detector" });
      return;
    }

    if (req.method === "POST" && pathname === "/api/analyze") {
      await handleAnalyze(req, res);
      return;
    }

    if (req.method === "GET") {
      serveStatic(req, res);
      return;
    }

    json(res, 405, { error: "Методът не е позволен" });
  } catch (err) {
    console.error("Request handler error:", err);
    if (!res.headersSent) {
      json(res, 500, {
        error: err?.message || "Вътрешна грешка на сървъра",
        code: "server_error",
      });
    }
  }
}

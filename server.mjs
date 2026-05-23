import http from "http";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import { analyzeImage } from "./lib/analyze.mjs";
import {
  isAuthRequired,
  isAuthenticated,
  verifyPassword,
  buildSessionCookie,
  authDeniedResponse,
} from "./lib/site-auth.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "public");
export const maxDuration = 300;

const ON_VERCEL = process.env.VERCEL === "1";
const PORT = Number(String(process.env.PORT || 3000).trim()) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const MAX_BYTES = ON_VERCEL ? 4 * 1024 * 1024 : 50 * 1024 * 1024;

function requestPath(req) {
  try {
    return new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname;
  } catch {
    return (req.url || "/").split("?")[0];
  }
}

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

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  let content = fs.readFileSync(envPath, "utf8");
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);

  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    process.env[k] = v;
  }
}

function getApiKeys() {
  return {
    aiornotKey: (process.env.AIORNOT_API_KEY || "").trim(),
    geminiKey: (process.env.GEMINI_API_KEY || "").trim(),
  };
}

function missingKeyMessage(keys) {
  const missing = [];
  if (!keys.aiornotKey) missing.push("AIORNOT_API_KEY");
  if (!keys.geminiKey) missing.push("GEMINI_API_KEY");
  if (!missing.length) return null;
  return `Липсва: ${missing.join(", ")}. Добавете в .env (без интервали около =), запазете файла и рестартирайте start-local.bat. Или въведете в Настройки.`;
}

function logKeyStatus() {
  const { aiornotKey, geminiKey } = getApiKeys();
  console.log(
    `API ключове от .env: AI or Not ${aiornotKey ? "OK" : "ЛИПСВА"}, Gemini ${geminiKey ? "OK" : "ЛИПСВА"}`
  );
  const msg = missingKeyMessage({ aiornotKey, geminiKey });
  if (msg) console.log(`  → ${msg}`);
}

process.on("uncaughtException", (err) => {
  console.error("Неочаквана грешка:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("Необработено отхвърляне:", err);
});

loadEnvFile();
logKeyStatus();
if (isAuthRequired()) {
  console.log("Защита с парола: активна (SITE_PASSWORD)");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        const mb = Math.round(MAX_BYTES / (1024 * 1024));
        reject(new Error(`Файлът е твърде голям (макс. ${mb} МБ)`));
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

async function handleAuthStatus(req, res) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      required: isAuthRequired(),
      authenticated: isAuthenticated(req.headers.cookie),
    })
  );
}

async function handleAuthLogin(req, res) {
  try {
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    if (!isAuthRequired()) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, required: false }));
      return;
    }
    if (!verifyPassword(body.password)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Грешна парола" }));
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": buildSessionCookie(),
    });
    res.end(JSON.stringify({ ok: true, required: true }));
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Невалидни данни" }));
  }
}

async function handleAnalyze(req, res) {
  if (!isAuthenticated(req.headers.cookie)) {
    const denied = authDeniedResponse();
    res.writeHead(denied.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(denied.body));
    return;
  }

  try {
    const body = await readBody(req);
    const { fileBuffer, filename, mimeType, aiornotKey, geminiKey } = parseMultipart(
      body,
      req.headers["content-type"]
    );

    const envKeys = getApiKeys();
    const keys = {
      aiornotKey: (aiornotKey || envKeys.aiornotKey).trim(),
      geminiKey: (geminiKey || envKeys.geminiKey).trim(),
    };

    const keyError = missingKeyMessage(keys);
    if (keyError) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: keyError }));
      return;
    }

    const result = await analyzeImage(fileBuffer, filename, mimeType, keys);
    const payload = {
      aiornot: result.aiornot,
      gemini: result.gemini
        ? {
            ...result.gemini,
            rawText: undefined,
          }
        : result.gemini,
      exiftool: result.exiftool,
    };
    if (payload.aiornot?.ok) {
      payload.aiornot = { ...payload.aiornot, raw: undefined };
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message || "Анализът не успя" }));
  }
}

function serveStatic(req, res) {
  let urlPath = req.url?.split("?")[0] || "/";
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

const server = http.createServer(async (req, res) => {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const path = requestPath(req);

    if (req.method === "GET" && (path === "/api/auth-status" || path === "/api/auth/status")) {
      await handleAuthStatus(req, res);
      return;
    }

    if (req.method === "POST" && (path === "/api/auth-login" || path === "/api/auth/login")) {
      await handleAuthLogin(req, res);
      return;
    }

    if (req.method === "GET" && path === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "ai-image-detector" }));
      return;
    }

    if (req.method === "POST" && path === "/api/analyze") {
      await handleAnalyze(req, res);
      return;
    }

    if (req.method === "GET") {
      serveStatic(req, res);
      return;
    }

    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Методът не е позволен" }));
  } catch (err) {
    console.error("Request handler error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: err?.message || "Вътрешна грешка на сървъра",
          code: "server_error",
        })
      );
    }
  }
});

function openBrowser(url) {
  if (ON_VERCEL || process.env.OPEN_BROWSER === "0") return;
  const onFail = () => console.log(`Отворете в браузъра: ${url}`);

  if (process.platform === "win32") {
    exec(`cmd /c start "" "${url}"`, { shell: true }, (err) => {
      if (err) onFail();
    });
  } else if (process.platform === "darwin") {
    exec(`open "${url}"`, (err) => {
      if (err) onFail();
    });
  } else {
    exec(`xdg-open "${url}"`, (err) => {
      if (err) onFail();
    });
  }
}

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`ГРЕШКА: Порт ${PORT} вече се използва. Спрете друг сървър или сменете PORT в .env`);
  } else {
    console.error("ГРЕШКА при стартиране:", err.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`Сървърът работи: ${url}`);
  console.log(`Също: http://localhost:${PORT}`);
  console.log("Оставете този прозорец отворен. Ctrl+C за спиране.");
  openBrowser(url);
});

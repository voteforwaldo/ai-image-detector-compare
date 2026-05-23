import http from "http";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import { handleRequest } from "./lib/http-router.mjs";
import { isAuthRequired } from "./lib/site-auth.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(String(process.env.PORT || 3000).trim()) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

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

function logKeyStatus() {
  const aiornotKey = (process.env.AIORNOT_API_KEY || "").trim();
  const geminiKey = (process.env.GEMINI_API_KEY || "").trim();
  console.log(
    `API ключове от .env: AI or Not ${aiornotKey ? "OK" : "ЛИПСВА"}, Gemini ${geminiKey ? "OK" : "ЛИПСВА"}`
  );
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

const server = http.createServer(handleRequest);

function openBrowser(url) {
  if (process.env.OPEN_BROWSER === "0") return;
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

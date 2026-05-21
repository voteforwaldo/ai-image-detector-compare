import { analyzeImage } from "../lib/analyze.mjs";

export const config = {
  api: {
    bodyParser: false,
  },
};

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

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Методът не е позволен" });
    return;
  }

  try {
    const body = await readRawBody(req);
    const { fileBuffer, filename, mimeType, aiornotKey, geminiKey } = parseMultipart(
      body,
      req.headers["content-type"]
    );

    const keys = {
      aiornotKey: aiornotKey || process.env.AIORNOT_API_KEY,
      geminiKey: geminiKey || process.env.GEMINI_API_KEY,
    };

    if (!keys.aiornotKey || !keys.geminiKey) {
      res.status(400).json({
        error: "Липсват API ключове. Задайте AIORNOT_API_KEY и GEMINI_API_KEY в Vercel или ги изпратете във формата.",
      });
      return;
    }

    const result = await analyzeImage(fileBuffer, filename, mimeType, keys);
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Анализът не успя" });
  }
}

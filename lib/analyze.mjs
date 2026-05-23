const AIORNOT_URL = "https://api.aiornot.com/v2/image/sync?only=ai_generated";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";

function geminiAnalyzeUrl() {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
}

function geminiAnalyzeGenerationConfig() {
  if (GEMINI_MODEL.includes("3.5")) {
    return { maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: "minimal" } };
  }
  return {
    temperature: 0.2,
    maxOutputTokens: 8192,
    thinkingConfig: { thinkingBudget: 0 },
  };
}

const GEMINI_FALLBACK_MODELS = ["gemini-3.5-flash", "gemini-2.5-flash"];

const GEMINI_PROMPT = `Прикачвам ти тази снимка. Анализирай дали е генерирана, манипулирана или редактирана с изкуствен интелект (визуален forensic анализ).

Направи кратък, директен forensic-style анализ само на реално присъстващите елементи в изображението. Не споменавай категории или обекти, които липсват на снимката.

Провери за визуални аномалии и несъответствия, включително когато са приложими:

анатомия на хора или животни
пръсти, ръце, очи, зъби, коса, кожа
текст, надписи и символи
сенки, отражения и осветление
перспектива и дълбочина
деформации на предмети или структури
повтарящи се или неестествени текстури
странни контури, артефакти или симетрии
несъответствия във фона
следи от генеративни модели, inpainting или AI редакция
прекомерна гладкост, plastic look или synthetic detail patterns

Ако даден елемент липсва в изображението, не го анализирай и не го споменавай.

Не измисляй детайли, които не се виждат ясно на снимката.

В самия край на отговора добави САМО един JSON обект (без markdown огради), с точно този формат:
{"verdict":"ai|human|uncertain","confidence_percent":0-100,"summary":"кратко резюме на български (до 2 изречения)","focus_regions":[{"label":"кратко име","note":"какво е подозрително","x":0.0,"y":0.0,"w":0.0,"h":0.0,"severity":"warn|info"}]}
focus_regions: от 0 до 4 елемента; x,y,w,h са нормализирани 0–1 (ляво-горе на цялото изображение). Само зони, които реално виждаш. Ако няма зони за внимание — празен масив.`;

export async function analyzeWithAiornot(buffer, filename, mimeType, apiKey) {
  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
  form.append("image", blob, filename || "upload.jpg");

  const res = await fetch(AIORNOT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`AI or Not API ${res.status}: ${text.slice(0, 400)}`);
  }

  const data = JSON.parse(text);
  const ai = data?.report?.ai_generated;
  if (!ai) {
    throw new Error("Неочакван формат на отговора от AI or Not");
  }

  const aiConf = Math.round((ai.ai?.confidence ?? 0) * 100);
  const humanConf = Math.round((ai.human?.confidence ?? 0) * 100);
  const generators = ai.generator
    ? Object.entries(ai.generator)
        .map(([name, g]) => ({
          name: formatGeneratorName(name),
          confidence: Math.round((g.confidence ?? 0) * 100),
          detected: Boolean(g.is_detected),
        }))
        .filter((g) => g.confidence > 1)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 5)
    : [];

  return {
    provider: "aiornot",
    verdict: ai.verdict === "ai" ? "ai" : ai.verdict === "human" ? "human" : "uncertain",
    aiPercent: aiConf,
    humanPercent: humanConf,
    summary:
      ai.verdict === "ai"
        ? `Открито като генерирано от ИИ (${aiConf}% сигурност).`
        : `Открито като човешко (${humanConf}% сигурност).`,
    generators,
    raw: data,
  };
}

async function callGeminiAnalyze(apiKey, model, buffer, mimeType) {
  const base64 = Buffer.from(buffer).toString("base64");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const generationConfig = model.includes("3.5")
    ? { maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: "minimal" } }
    : {
        temperature: 0.2,
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingBudget: 0 },
      };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: GEMINI_PROMPT },
            {
              inline_data: {
                mime_type: mimeType || "image/jpeg",
                data: base64,
              },
            },
          ],
        },
      ],
      generationConfig,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini API ${res.status}: ${text.slice(0, 400)}`);
  }

  const data = JSON.parse(text);
  const reply =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("")?.trim() || "";
  const parsed = parseGeminiResponse(reply);

  const conf = parsed.confidence_percent;
  const aiPercent =
    parsed.verdict === "ai" ? conf : parsed.verdict === "human" ? 100 - conf : 50;
  const humanPercent =
    parsed.verdict === "human" ? conf : parsed.verdict === "ai" ? 100 - conf : 50;

  return {
    provider: "gemini",
    verdict: parsed.verdict,
    aiPercent,
    humanPercent,
    confidencePercent: conf,
    summary: parsed.summary,
    focusRegions: parsed.focus_regions || [],
    rawText: reply,
    geminiModel: model,
  };
}

export async function analyzeWithGemini(buffer, mimeType, apiKey) {
  const models = [
    process.env.GEMINI_MODEL,
    ...GEMINI_FALLBACK_MODELS,
  ].filter(Boolean);
  const unique = [...new Set(models)];

  let lastErr;
  for (const model of unique) {
    try {
      return await callGeminiAnalyze(apiKey, model, buffer, mimeType);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Gemini API не отговори");
}

function settleExiftool(value) {
  if (value?.ok === false) return value;
  return { ok: true, ...value };
}

async function loadExiftoolAnalyzer() {
  if (process.env.VERCEL === "1") {
    return import("./exiftool-vercel.mjs");
  }
  return import("./exiftool.mjs");
}

export async function analyzeImage(buffer, filename, mimeType, keys) {
  const { aiornotKey, geminiKey } = keys;
  const { analyzeWithExiftool } = await loadExiftoolAnalyzer();

  const [aiornotSettled, geminiSettled, exifSettled] = await Promise.allSettled([
    analyzeWithAiornot(buffer, filename, mimeType, aiornotKey),
    analyzeWithGemini(buffer, mimeType, geminiKey),
    analyzeWithExiftool(buffer, filename, mimeType),
  ]);

  const exiftoolResult =
    exifSettled.status === "fulfilled"
      ? exifSettled.value
      : {
          ok: false,
          error: exifSettled.reason?.message || String(exifSettled.reason),
        };

  return {
    aiornot:
      aiornotSettled.status === "fulfilled"
        ? { ok: true, ...aiornotSettled.value }
        : { ok: false, error: aiornotSettled.reason?.message || String(aiornotSettled.reason) },
    gemini:
      geminiSettled.status === "fulfilled"
        ? { ok: true, ...geminiSettled.value }
        : { ok: false, error: geminiSettled.reason?.message || String(geminiSettled.reason) },
    exiftool: settleExiftool(exiftoolResult),
  };
}

function formatGeneratorName(key) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractTrailingJson(text) {
  const matches = [...text.matchAll(/\{[\s\S]*?\}/g)];
  for (let i = matches.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(matches[i][0]);
      if (obj && (obj.verdict != null || obj.focus_regions != null || obj.summary != null)) {
        return { obj, start: matches[i].index };
      }
    } catch {
      /* try older block */
    }
  }
  return null;
}

function parseGeminiResponse(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      verdict: "uncertain",
      confidence_percent: 50,
      summary: "Празен отговор от Gemini.",
      focus_regions: [],
    };
  }

  try {
    const direct = JSON.parse(trimmed);
    return normalizeGeminiParsed(direct, trimmed);
  } catch {
    /* prose + optional JSON */
  }

  const trailing = extractTrailingJson(trimmed);
  if (trailing) {
    const prose = trimmed.slice(0, trailing.start).trim();
    const normalized = normalizeGeminiParsed(trailing.obj, prose || trimmed);
    if (prose && (!normalized.summary || normalized.summary === trimmed)) {
      normalized.summary = prose;
    }
    return normalized;
  }

  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return normalizeGeminiParsed(JSON.parse(jsonMatch[0]), trimmed);
    } catch {
      /* fall through */
    }
  }

  const { verdict, confidence_percent } = inferVerdictFromForensicText(trimmed);
  return {
    verdict,
    confidence_percent,
    summary: trimmed,
    focus_regions: [],
  };
}

function inferVerdictFromForensicText(text) {
  const lower = text.toLowerCase();

  const aiSignals = [
    /вероятно\s+(е\s+)?(генериран|създаден|направен).{0,20}(ии|ai|изкуствен)/i,
    /(изглежда|изглеждат)\s+.{0,30}(генериран|изкуствен|ии|ai)/i,
    /(признаци|индикации|сигнали).{0,40}(ии|ai|изкуствен)/i,
    /(генериран|генерирана|синтетичн).{0,25}(изображение|снимка|фото)/i,
    /редактиран.{0,20}(ии|ai|изкуствен)/i,
    /ai[\s-]*(генериран|anomal|артефакт)/i,
    /изкуствен\s+интелект/i,
    /пластмасов.{0,15}кож/i,
    /неестествен/i,
    /аномали/i,
  ];

  const humanSignals = [
    /вероятно\s+(е\s+)?(реалн|автентичн|истинск)/i,
    /(не\s+изглежда|не\s+изглеждат).{0,30}(генериран|изкуствен|ии|ai)/i,
    /(няма|липсват).{0,40}(признаци|индикации|сигнали).{0,30}(ии|ai|изкуствен)/i,
    /(естествена|реална)\s+снимка/i,
    /автентичн/i,
    /човешк.{0,20}(снимка|фото|произход)/i,
    /не\s+е\s+генериран/i,
  ];

  let aiScore = 0;
  let humanScore = 0;

  for (const re of aiSignals) {
    if (re.test(lower)) aiScore += 1;
  }
  for (const re of humanSignals) {
    if (re.test(lower)) humanScore += 1;
  }

  if (
    /\b(да|вероятно|най-вероятно)\b.{0,60}(генериран|изкуствен|ии|ai)/i.test(lower) &&
    !/не\s+(е|изглежда).{0,20}(генериран|изкуствен)/i.test(lower)
  ) {
    aiScore += 2;
  }
  if (/\b(не|няма)\b.{0,40}(генериран|изкуствен|ии|ai)/i.test(lower)) {
    humanScore += 2;
  }

  let verdict = "uncertain";
  let confidence_percent = 55;

  if (aiScore > humanScore && aiScore > 0) {
    verdict = "ai";
    confidence_percent = Math.min(92, 55 + aiScore * 8);
  } else if (humanScore > aiScore && humanScore > 0) {
    verdict = "human";
    confidence_percent = Math.min(92, 55 + humanScore * 8);
  }

  return { verdict, confidence_percent };
}

function normalizeFocusRegions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 4)
    .map((r) => {
      const x = Number(r.x);
      const y = Number(r.y);
      const w = Number(r.w);
      const h = Number(r.h);
      if ([x, y, w, h].some((n) => Number.isNaN(n))) return null;
      return {
        label: String(r.label || "").trim().slice(0, 48) || "Зона",
        note: String(r.note || r.label || "").trim().slice(0, 220),
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
        w: Math.max(0.05, Math.min(1, w)),
        h: Math.max(0.05, Math.min(1, h)),
        severity: r.severity === "info" ? "info" : "warn",
      };
    })
    .filter(Boolean);
}

function normalizeGeminiParsed(obj, fallbackText) {
  let verdict = String(obj.verdict || "uncertain").toLowerCase();
  if (!["ai", "human", "uncertain"].includes(verdict)) verdict = "uncertain";

  let confidence = Number(obj.confidence_percent ?? obj.confidence ?? 50);
  if (Number.isNaN(confidence)) confidence = 50;
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  let summary =
    String(obj.summary || obj.explanation || obj.analysis || "").trim() || "";
  if (!summary && fallbackText) {
    summary = fallbackText.replace(/\{[\s\S]*\}\s*$/, "").trim();
  }
  if (!summary) summary = "Няма предоставено резюме.";

  return {
    verdict,
    confidence_percent: confidence,
    summary,
    focus_regions: normalizeFocusRegions(obj.focus_regions),
  };
}

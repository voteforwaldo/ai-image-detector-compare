import {
  assertBudget,
  estimateInputTokens,
  isModelAllowed,
  recordSpend,
} from "./gemini-budget.mjs";

const AIORNOT_URL = "https://api.aiornot.com/v2/image/sync?only=ai_generated";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";
const RAW_GEMINI_MODEL = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
const GEMINI_MODEL = isModelAllowed(RAW_GEMINI_MODEL) ? RAW_GEMINI_MODEL : DEFAULT_GEMINI_MODEL;
const GEMINI_MAX_OUTPUT = 512;

function geminiAnalyzeUrl() {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
}

function geminiAnalyzeGenerationConfig(model = GEMINI_MODEL) {
  if (model.includes("3.5") || model.includes("3.1") || model.includes("3-pro")) {
    return {
      temperature: 1.0,
      maxOutputTokens: GEMINI_MAX_OUTPUT,
      thinkingConfig: { thinkingLevel: "minimal" },
    };
  }
  if (model.includes("2.5-pro") || model.includes("2.5-flash")) {
    return {
      temperature: 0.1,
      maxOutputTokens: GEMINI_MAX_OUTPUT,
      thinkingConfig: { thinkingBudget: 0 },
    };
  }
  return {
    temperature: 0.1,
    maxOutputTokens: GEMINI_MAX_OUTPUT,
  };
}

const GEMINI_FALLBACK_MODELS = ["gemini-2.5-flash-lite"];

const GEMINI_PROMPT = `ИИ ли е тази снимка?

Роля: forensic анализатор на изображения. Оценяваш дали снимката е AI-генерирана, AI-редактирана/inpainted, или естествена (камера/скан).

## СТЪПКА 0 — Google Gemini „ромб“ / sparkle watermark (ПЪРВО!)
Google слага **видим воден знак** на AI изображения — малък **ромб / четириопен star / sparkle (✦)**:
- **Позиция:** почти винаги **долен-десен ъгъл** (bottom-right), ~32–64 px от ръба
- **Вид:** полупрозрачен бял или тъмен **ромб/звезда с 4 върха**, понякога с лек glow; размер ~48×48 или 96×96 px
- **Alias:** Gemini sparkle, Nano Banana watermark, Google AI badge
- **Задължително:** увеличи mentally **долния десен ъгъл** — watermark-ът се пропускa лесно

**Първо прегледай цялото изображение пиксел по пиксел в ъглите — особено долен-десен ъгъл за малък рomb/sparkle/лого.**

**Ако видиш рomb/sparkle/✦ ИЛИ друго Google/Gemini branding (лого, „Made with Google AI“, UI):**
→ verdict MUST be "ai", confidence_percent ≥ 96
→ platform_logo: "gemini"; google_sparkle: true ако е рomb/sparkle; focus_region на долния десен ъгъл
→ **ЗАБРАНЕНО:** „липсват watermarks/артефакти“, verdict "human"
→ Google watermark = **AI маркер**, не реална камера

## Критични правила
1. Висок фотореализъм ≠ реална снимка. Много AI изображения изглеждат перфектно.
2. **Четлив/перфектен текст ≠ реална снимка.** Модели като GPT-4o, Ideogram, Flux и Gemini 2+ често генерират безупречен текст. Четливостта сама по себе си НЕ е доказателство за „human“.
3. Не заключвай "human" само защото качеството, текстът или осветлението са добри.
4. При съмнение → "uncertain", не "human".
5. JSON verdict ТРЯБВА да съвпада с forensic анализа по-горе. Не противоречи на собствения си текст.
6. Анализирай САМО видими елементи в изображението. Не измисляй липсващи обекти.
7. **Задължително** прегледай цялата снимка за водни знаци — **видими** (лого, текст, overlay) и **digital** (C2PA badges, provenance UI, SynthID контекст, embedded marks). Без тази стъпка не давай verdict.
9. **Никога** не твърди „липсват watermarks/AI артефакти“ без да си проверил **долния десен ъгъл** за Google рomb/sparkle (✦).
10. Google рomb/sparkle или Gemini branding **отменя** verdict "human" — винаги "ai".

## Стъпки (минавай ги мислено в този ред)

### A. Водни знаци — видими на изображението (висок приоритет)
Сканирай **всички ъгли**, особено **долен-десен** за Google **ромб/sparkle (✦)**:
- Google Gemini sparkle: полупрозрачен рomb/4-point star, bottom-right (~48×48 px)
- лога и brand marks (Gemini, OpenAI, Midjourney sail, Adobe, Getty, Shutterstock, Canva и др.)
- текстови watermarks: „AI generated“, „Made with…“, „Sample“, „Preview“, „Getty Images“, „Shutterstock“, „Adobe Stock“
- полупрозрачни или повтарящи се overlay marks, diagonal text, corner badges
- QR/barcode overlays от AI платформи
- UI елементи на генератор (prompt box, regenerate, download, share)
→ Видим watermark/logo/UI на AI инструмент: verdict MUST be "ai", confidence ≥ 92; добави focus_region на зоната.

### B. Digital watermarks — задължителна проверка (влияе на оценката)
**Digital watermarks** са маркери за AI/generative произход — видими в кадъра или свързани с platform provenance. Прегледай **методично**:

1. **C2PA / Content Credentials** — икони „CR“, „Content Credentials“, info panel, „About this image“, synthetic/AI label, „TrainedAlgorithmicMedia“, „Composite with AI“
2. **Platform / generator UI** — „Created with Google AI“, Imagen/Gemini export frame, ChatGPT/DALL·E share screen, „Verify“ / „AI generated“ badge от OpenAI, Adobe Content Authenticity
3. **SynthID (Google)** — imperceptible в pixels; **не пиши „открит SynthID“** без Google UI; при Gemini/Imagen/Google AI кадър → summary: „вероятен SynthID“, verdict "ai" ≥ 90
4. **Digimarc / faint embedded patterns** — едва видими повтарящи се мотиви в небо, стена, равна повърхност (само ако ги виждаш)
5. **Corner/signature stamps** — generator signatures, repeated semi-transparent text, disclosure labels за invisible watermark

**Как влияе на verdict/confidence:**
| Находка | verdict | confidence |
|---------|---------|------------|
| Видим C2PA/Content Credentials badge или synthetic label | ai | 90–98 |
| Provenance UI (Google AI, OpenAI verify, platform export frame) | ai | 88–96 |
| Вероятен SynthID контекст (Google AI UI) | ai | 85–92 |
| Слаб digital mark + друг AI сигнал | ai или uncertain | 65–84 |
| Няма digital/visible marks, само photorealism | uncertain | 45–60 |

→ Digital watermark е **силен сигнал като видим watermark** — включи го в forensic текста и summary.
→ В summary **изрично** спомени digital watermarks: какво си намерил, или „не са открити видими digital marks“.

### C. Източник и UI на AI приложения
Търси: chat прозорци, prompt полета, „Generated by…“, mobile/desktop UI.
Инструменти: Gemini/Google AI, ChatGPT/OpenAI, DALL·E, Midjourney, Adobe Firefly, Stable Diffusion, Leonardo, Ideogram, Bing/Copilot, Canva AI, Sora, Flux, Runway, PixVerse и др.
→ verdict MUST be "ai", confidence ≥ 90.

### D. Текст и символи (съдържание в сцената)
- **Четлив текст не означава реална снимка** — оценявай typography, spacing, font consistency.
- AI сигнали: размазани/грешни букви, nonsense, смесени азбуки, дублирани символи, melting/interleaved букви.
- Перфектно render-нат текст **в комбинация** с друг AI сигнал → lean "ai", не "human".

### E. Анатомия (ако има хора/животни)
Пръсти (брой, дължина, съединения), ръце, очи (зеници, симетрия), зъби, уши, коса (граници, flyaways), кожа (poreless/plastic look), jewelry/accessories.
→ Един силен anatomical glitch + друг сигнал → lean "ai".

### F. Физика и пространство
Сенки vs. светлинни източници, отражения в стъкло/очи, перспектива, vanishing points, contact shadows, depth consistency.
→ Несъответствия → AI или heavy edit.

### G. Текстури и фон
Повтарящи се patterns, tileable фон, melting edges, halo около обекти, over-smooth skin/sky/fabric, inconsistent grain/noise между зони, blur seams от inpainting.
→ Множество → lean "ai".

### H. Тип на файла (визуално)
Screenshot, social media frame, meme template с AI art, collage, obvious upscale/smooth filter — не променя verdict сам по себе си, но повишава вниманието.

### I. SynthID — допълнителни правила (Google)
SynthID (Google DeepMind) е **невидим watermark в пикселите** — не може да се види с просто око. Типично присъства в изходи от Google AI: Gemini, Imagen, Veo; понякога и при партньори (напр. OpenAI images с dual-layer C2PA+SynthID).

Правила:
- **Не твърди „открит SynthID“** само от визуален преглед — watermark-ът е imperceptible; потвърждението изисква Google SynthID detector.
- Ако изображението е **явно от Google AI** (Gemini logo/UI, Imagen, Google AI chat, „Created with Google AI“) → verdict MUST be "ai", confidence ≥ 90; в summary спомени: „вероятен SynthID watermark (Google) — невидим, не потвърден визуално“.
- Ако в screenshot/UI се виждат **C2PA Content Credentials** с Google/Imagen/Gemini/synthetic/trainedAlgorithmic → твърд AI сигнал.
- **Липса на видими SynthID/C2PA следи не означава „human“** — metadata може да е изчистена; photorealistic AI без UI остава uncertain, не human.
- SynthID покрива предимно Google (и select partners) — други генератори (Midjourney, SD) нямат SynthID, но пак са AI.

## Verdict матрица
| verdict | Кога |
|---------|------|
| ai | ≥1 твърд сигнал (видим watermark, **digital watermark/C2PA/provenance badge**, лого/UI, Google AI) ИЛИ ≥3 AI индикатора от D–G |
| uncertain | 1–2 слаби сигнали; photorealism + перфектен текст БЕЗ watermark; или AI edit върху реална база |
| human | Нулеви видими watermark/digital badge сигнали; camera imperfections; **не** използвай четлив текст или последователна физика като единствен аргумент |

## confidence_percent (калибрация)
- 92–100: видим watermark, **digital watermark/C2PA badge**, лого/UI, или Google AI screenshot
- 80–91: множество ясни generative артефакти
- 65–79: вероятно AI, но не категорично
- 45–64: uncertain / смесени сигнали
- 70–85 за "human": само ако няма никакви AI индикатори и физиката е последователна

## Формат на отговора
1) Първо напиши 2–5 изречения на български: конкретни наблюдения (какво виждаш и защо). **Задължително** включи резултата от проверката за видими и digital watermarks.
2) На последния ред — САМО един JSON обект, без markdown, без code fences:

{"verdict":"ai|human|uncertain","confidence_percent":0-100,"platform_logo":"google|gemini|openai|midjourney|other|none","google_sparkle":true|false,"summary":"1–2 изречения на български","focus_regions":[{"label":"кратко","note":"какво е подозрително","x":0.0,"y":0.0,"w":0.0,"h":0.0,"severity":"warn|info"}]}

platform_logo: "gemini" при Google/Gemini branding. google_sparkle: true ако видиш рomb/sparkle/✦ watermark (обикновено долу-дясно).

focus_regions: 0–4 зони с реални координати; x,y = top-left, w,h = размер; всички 0–1 спрямо цялото изображение. severity "warn" за AI сигнали, "info" за неутрални зони. Празен [] ако няма.`;

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
  const inputEst = estimateInputTokens(GEMINI_PROMPT) + 300;
  assertBudget(model, inputEst, GEMINI_MAX_OUTPUT);

  const base64 = Buffer.from(buffer).toString("base64");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const generationConfig = geminiAnalyzeGenerationConfig(model);

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
  const usage = data?.usageMetadata || {};
  recordSpend(
    model,
    usage.promptTokenCount || inputEst,
    usage.candidatesTokenCount || Math.max(1, Math.ceil(reply.length / 4)),
  );
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
    platformLogo: parsed.platform_logo || "none",
    googleSparkle: Boolean(parsed.google_sparkle),
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
  const { analyzeSynthID } = await import("./synthid-detect.mjs");

  const [aiornotSettled, geminiSettled, exifSettled, synthidSettled] =
    await Promise.allSettled([
      analyzeWithAiornot(buffer, filename, mimeType, aiornotKey),
      analyzeWithGemini(buffer, mimeType, geminiKey),
      analyzeWithExiftool(buffer, filename, mimeType),
      analyzeSynthID(buffer),
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
    synthid:
      synthidSettled.status === "fulfilled"
        ? synthidSettled.value
        : {
            ok: false,
            error: synthidSettled.reason?.message || String(synthidSettled.reason),
            detected: false,
            bannerText: "SynthID — грешка",
          },
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

export function parseGeminiResponse(text) {
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

function extractForensicProse(fullText) {
  if (!fullText) return "";
  return fullText.replace(/\{[\s\S]*\}\s*$/, "").trim();
}

function scorePatterns(text, patterns) {
  let score = 0;
  for (const re of patterns) {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    const globalRe = new RegExp(re.source, flags);
    for (const match of text.matchAll(globalRe)) {
      const start = match.index ?? 0;
      const before = text.slice(Math.max(0, start - 72), start);
      if (/\b(не|няма|липсва|no|not)\b[^.]{0,40}$/i.test(before)) continue;
      score += 1;
    }
  }
  return score;
}

function inferVerdictFromForensicText(text) {
  if (!text?.trim()) {
    return { verdict: "uncertain", confidence_percent: 50 };
  }

  const lower = text.toLowerCase();

  const aiSignals = [
    /вероятно\s+(е\s+)?(генериран|създаден|направен).{0,20}(ии|ai|изкуствен)/i,
    /(изглежда|изглеждат)\s+.{0,30}(генериран|изкуствен|ии|ai)/i,
    /(открит|открити|установен|имаме)\s+.{0,30}(ии|ai|изкуствен|generative)/i,
    /(генериран|генерирана|синтетичн).{0,25}(изображение|снимка|фото)/i,
    /редактиран.{0,20}(ии|ai|изкуствен|inpaint)/i,
    /ai[\s-]*(генериран|anomal|артефакт)/i,
    /изкуствен\s+интелект/i,
    /пластмасов|plastic\s*look|poreless/i,
    /(размазан|грешен|нечетим|nonsense).{0,25}(текст|надпис|букв)/i,
    /(screenshot|екран|прозорец|chat|ui).{0,40}(ai|ии|генериран|gemini|chatgpt)/i,
    /(лого|watermark|воден\s*знак|badge|бутон|digimarc).{0,40}(ai|ии|генериран|google|stock)/i,
    /(видим|открит|установен).{0,25}(watermark|воден\s*знак)/i,
    /content\s*credentials|c2pa\s*badge|provenance\s*badge|cr:ai/i,
    /(ai|ии|google\s*ai).{0,30}(лого|watermark|интерфейс|прозорец|ui)/i,
    /synthid|synth\s*id|imagen|content\s*credentials|trainedalgorithmic/i,
    /inpaint|generative|melting|halo\s*около|over[\s-]?smooth/i,
    /твърд\s+сигнал/i,
    /вероятен\s+synthid/i,
    /digital\s*watermark/i,
    /(открит|установен|видим).{0,30}(digital\s*watermark|c2pa|content\s*credentials)/i,
  ];

  const humanSignals = [
    /вероятно\s+(е\s+)?(реалн|автентичн|истинск)/i,
    /оценен[ао]?\s+като\s+(автентичн|естествена|реална)/i,
    /(не\s+изглежда|не\s+изглеждат).{0,30}(генериран|изкуствен|ии|ai)/i,
    /(няма|липсват).{0,40}(признаци|индикации|сигнали).{0,30}(ии|ai|изкуствен)/i,
    /(естествена|реална|автентична)\s+снимка/i,
    /автентичн/i,
    /човешк.{0,20}(снимка|фото|произход)/i,
    /не\s+е\s+генериран/i,
  ];

  let aiScore = scorePatterns(lower, aiSignals);
  let humanScore = scorePatterns(lower, humanSignals);

  // Brand names only count as AI signal when not negated and in positive context
  if (
    /\b(gemini|midjourney|dall[\s·.-]?e|chatgpt|firefly|stable\s*diffusion)\b/i.test(lower) &&
    !/\b(няма|липсва|не\s+се\s+вижда|without)\b[^.]{0,50}(gemini|midjourney|dall|chatgpt)/i.test(lower)
  ) {
    if (/(лого|ui|watermark|интерфейс|прозорец|генериран|screenshot)/i.test(lower)) {
      aiScore += 2;
    }
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

function summaryAlignsWithVerdict(verdict, summary) {
  const inferred = inferVerdictFromForensicText(summary);
  if (inferred.verdict === "uncertain") return true;
  return inferred.verdict === verdict;
}

function pickSummaryForVerdict(verdict, confidence, jsonSummary, forensicProse) {
  if (jsonSummary && summaryAlignsWithVerdict(verdict, jsonSummary)) {
    return jsonSummary;
  }
  if (forensicProse && summaryAlignsWithVerdict(verdict, forensicProse)) {
    return forensicProse.slice(0, 600);
  }
  if (verdict === "ai") {
    return `Forensic анализ: вероятно AI-генерирано или AI-редактирано (${confidence}% сигурност).`;
  }
  if (verdict === "human") {
    return `Forensic анализ: вероятно естествена снимка (${confidence}% сигурност).`;
  }
  return `Forensic анализ: неясно — смесени или недостатъчни сигнали (${confidence}%).`;
}

function detectGoogleSparkleWatermark(text, obj = {}) {
  if (obj.google_sparkle === true || obj.google_sparkle === "true") return true;
  if (!text?.trim()) return false;
  const lower = text.toLowerCase();
  const positivePatterns = [
    /(ромб|sparkle|✦|four[\s-]?point|четириопен|4[\s-]?point).{0,40}(watermark|воден|google|gemini|долен|дясн|bottom[\s-]?right|ъгъл)/i,
    /(долен|долу|bottom).{0,25}(десен|дясн|right).{0,40}(ромб|sparkle|✦|gemini|google)/i,
    /(google|gemini).{0,30}(ромб|sparkle|✦|spark)/i,
    /google_sparkle["']?\s*:\s*true/i,
  ];
  return positivePatterns.some((re) => re.test(lower));
}

function detectGoogleAiBranding(text, obj = {}) {
  if (detectGoogleSparkleWatermark(text, obj)) return true;
  if (!text?.trim()) return false;
  const lower = text.toLowerCase();
  const positivePatterns = [
    /(вижд|видим|открит|открито|установен|присъств|наличен|има).{0,40}(google|gemini).{0,30}(лого|logo|branding|badge|watermark|ui)/i,
    /(лого|logo|badge|watermark).{0,30}(google|gemini|google\s*ai)/i,
    /(google|gemini).{0,25}(лого|logo).{0,25}(на|на\s+изображението|в\s+кадъра|в\s+ъгъла)/i,
    /made with google|created with google/i,
    /platform_logo["']?\s*:\s*["']?(google|gemini)/i,
  ];
  for (const re of positivePatterns) {
    if (re.test(lower)) return true;
  }
  return false;
}

function claimsNoAiWatermarks(text) {
  return /(липсват|няма|не\s+са\s+открити|не\s+открих|without).{0,55}(воден|watermark|артефакт|лого|ai\s*марк|generative)/i.test(
    text || ""
  );
}

function applyPlatformLogoOverride(parsed, forensicProse, rawObj = {}) {
  const platform = String(parsed.platform_logo || rawObj.platform_logo || rawObj.visible_platform_logo || "")
    .toLowerCase()
    .trim();
  const googlePlatforms = new Set(["google", "gemini", "google ai", "google_ai"]);
  const fullText = [forensicProse, parsed.summary].filter(Boolean).join("\n");

  const hasGooglePlatform =
    googlePlatforms.has(platform) ||
    detectGoogleAiBranding(fullText, rawObj) ||
    detectGoogleSparkleWatermark(fullText, rawObj);

  if (!hasGooglePlatform) return parsed;

  let summary = parsed.summary;
  const sparkle = detectGoogleSparkleWatermark(fullText, rawObj);
  if (claimsNoAiWatermarks(summary) || parsed.verdict === "human") {
    summary = sparkle
      ? `Открит Google Gemini рomb/sparkle watermark (✦) — AI-генерирано изображение. ${(summary || "").trim()}`
      : `Открито Google/Gemini branding — AI-генерирано изображение. ${(summary || "").trim()}`;
  }

  return {
    ...parsed,
    verdict: "ai",
    confidence_percent: Math.max(parsed.confidence_percent, sparkle ? 96 : 95),
    summary: summary.slice(0, 600),
  };
}

function reconcileGeminiVerdict(parsed, forensicProse) {
  const jsonVerdict = parsed.verdict;
  const jsonConf = parsed.confidence_percent;
  const jsonSummary = parsed.summary || "";
  const platformLogo = parsed.platform_logo;

  const summaryInfer = inferVerdictFromForensicText(jsonSummary);
  const proseInfer = forensicProse ? inferVerdictFromForensicText(forensicProse) : null;

  let verdict = jsonVerdict;
  let confidence = jsonConf;

  const pack = (v, c, summary) =>
    applyPlatformLogoOverride(
      { verdict: v, confidence_percent: c, summary, platform_logo: platformLogo },
      forensicProse,
      parsed
    );

  if (summaryInfer.verdict !== "uncertain" && summaryInfer.verdict === jsonVerdict) {
    return pack(
      verdict,
      confidence,
      pickSummaryForVerdict(verdict, confidence, jsonSummary, forensicProse)
    );
  }

  if (summaryInfer.verdict !== "uncertain" && summaryInfer.verdict !== jsonVerdict) {
    verdict = summaryInfer.verdict;
    confidence = Math.max(summaryInfer.confidence_percent, 100 - jsonConf);
    return pack(verdict, confidence, pickSummaryForVerdict(verdict, confidence, jsonSummary, forensicProse));
  }

  if (
    proseInfer &&
    proseInfer.verdict !== "uncertain" &&
    proseInfer.verdict !== jsonVerdict &&
    proseInfer.confidence_percent >= 70 &&
    summaryInfer.verdict === "uncertain"
  ) {
    verdict = proseInfer.verdict;
    confidence = proseInfer.confidence_percent;
    return pack(verdict, confidence, pickSummaryForVerdict(verdict, confidence, jsonSummary, forensicProse));
  }

  return pack(
    verdict,
    confidence,
    pickSummaryForVerdict(verdict, confidence, jsonSummary, forensicProse)
  );
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
  const forensicProse = extractForensicProse(fallbackText || "");
  if (!summary && forensicProse) {
    summary = forensicProse;
  }
  if (!summary) summary = "Няма предоставено резюме.";

  const platformLogo = obj.platform_logo || obj.visible_platform_logo;
  const rawObj = {
    platform_logo: platformLogo,
    google_sparkle: obj.google_sparkle,
  };

  const base = {
    verdict,
    confidence_percent: confidence,
    summary,
    focus_regions: normalizeFocusRegions(obj.focus_regions),
    platform_logo: platformLogo,
    google_sparkle: obj.google_sparkle,
  };

  const reconciled = reconcileGeminiVerdict({ ...base, ...rawObj }, forensicProse);

  return {
    verdict: reconciled.verdict,
    confidence_percent: reconciled.confidence_percent,
    summary: reconciled.summary,
    focus_regions: base.focus_regions,
    platform_logo: platformLogo || "none",
    google_sparkle: Boolean(rawObj.google_sparkle),
  };
}

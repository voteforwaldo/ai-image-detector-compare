const GEMINI_SPARKLE_REGION = {
  label: "Google sparkle / лого",
  note: "Долен десен ъгъл — типично място за Gemini watermark (✦) или лого.",
  x: 0.82,
  y: 0.82,
  w: 0.14,
  h: 0.14,
  severity: "warn",
};

const KEYWORD_REGIONS = [
  {
    re: /ромб|sparkle|✦|четириопен|google\s*sparkle|долен.*десен|bottom[\s-]?right.*(watermark|лого|sparkle|ромб)/i,
    ...GEMINI_SPARKLE_REGION,
  },
  {
    re: /digital\s*watermark|c2pa|content\s*credentials|synthid|provenance\s*badge|cr:ai/i,
    label: "Digital watermark",
    note: "Проверете за C2PA, Content Credentials или provenance UI.",
    x: 0.02,
    y: 0.02,
    w: 0.96,
    h: 0.96,
    severity: "warn",
  },
  {
    re: /watermark|воден\s*знак|лого|logo|stock|getty|shutterstock|digimarc|badge/i,
    label: "Watermark / лого",
    note: "Проверете ъглите и ръбовете за видим watermark или лого.",
    x: 0.02,
    y: 0.02,
    w: 0.96,
    h: 0.96,
    severity: "warn",
  },
  {
    re: /лого|watermark|воден\s*знак|ui|прозорец|chat|gemini|chatgpt|google\s*ai|made with google/i,
    label: "AI UI / лого",
    note: "Проверете за лого, watermark или UI на AI инструмент.",
    x: 0.02,
    y: 0.02,
    w: 0.96,
    h: 0.96,
    severity: "warn",
  },
  { re: /пръст|ръц|длан|анатом/i, label: "Ръце", note: "Проверете анатомията на ръцете и пръстите.", x: 0.32, y: 0.52, w: 0.36, h: 0.28 },
  { re: /очи|лиц|зъб|коса|кожа/i, label: "Лице", note: "Прегледайте лице, очи и детайли на кожата.", x: 0.28, y: 0.08, w: 0.44, h: 0.38 },
  { re: /текст|надпис|букв|символ/i, label: "Текст", note: "Проверете надписи и четимост на текст.", x: 0.08, y: 0.04, w: 0.84, h: 0.22 },
  { re: /фон|заден план/i, label: "Фон", note: "Потърсете несъответствия във фона.", x: 0.05, y: 0.05, w: 0.9, h: 0.9, severity: "info" },
  { re: /сенк|осветл|отраж/i, label: "Осветление", note: "Сравнете сенки, светлина и отражения.", x: 0.15, y: 0.45, w: 0.7, h: 0.45 },
  { re: /текстур|артефакт|контур|симетр/i, label: "Текстури", note: "Обърнете внимание на повтарящи се или неестествени текстури.", x: 0.12, y: 0.12, w: 0.76, h: 0.76 },
  { re: /перспектив|деформац|структур/i, label: "Перспектива", note: "Проверете геометрия и перспектива.", x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
];

export function clamp01(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export function normalizeRegion(r, index) {
  const w = clamp01(r.w ?? 0.12);
  const h = clamp01(r.h ?? 0.12);
  let x = clamp01(r.x ?? 0);
  let y = clamp01(r.y ?? 0);
  if (x + w > 1) x = Math.max(0, 1 - w);
  if (y + h > 1) y = Math.max(0, 1 - h);

  return {
    id: index + 1,
    label: String(r.label || `Зона ${index + 1}`).slice(0, 40),
    note: String(r.note || r.label || "").slice(0, 200),
    x,
    y,
    w: Math.max(0.06, w),
    h: Math.max(0.06, h),
    severity: r.severity === "info" ? "info" : "warn",
  };
}

function regionKey(r) {
  return `${r.label}|${Math.round(r.x * 100)}|${Math.round(r.y * 100)}`;
}

function mergeRegions(...lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    for (const r of list) {
      const norm = normalizeRegion(r, out.length);
      const key = regionKey(norm);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(norm);
      if (out.length >= 4) return out;
    }
  }
  return out;
}

export function inferFocusFromSummary(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const found = [];

  for (const item of KEYWORD_REGIONS) {
    if (item.re.test(lower)) {
      found.push({
        label: item.label,
        note: item.note,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        severity: item.severity || "warn",
      });
    }
    if (found.length >= 4) break;
  }

  return found;
}

/** Ensure logo/sparkle corner is always offered for visual check. */
function ensureLogoCornerCheck(regions, gemini) {
  const hasCorner = regions.some(
    (r) =>
      /sparkle|ромб|лого|watermark|gemini/i.test(`${r.label} ${r.note}`) &&
      r.x >= 0.65 &&
      r.y >= 0.65
  );
  if (hasCorner) return regions;

  const sparkleFromModel = gemini?.googleSparkle === true;
  const googleAi =
    sparkleFromModel ||
    /gemini|google\s*ai|imagen/i.test(String(gemini?.platformLogo || "")) ||
    gemini?.verdict === "ai";

  if (sparkleFromModel || googleAi || regions.length < 4) {
    return mergeRegions([GEMINI_SPARKLE_REGION], regions);
  }
  return regions;
}

export function resolveFocusRegions(gemini) {
  if (!gemini?.ok) return [];

  let regions = [];
  const fromApi = gemini.focusRegions;
  if (Array.isArray(fromApi) && fromApi.length) {
    regions = fromApi.map((r, i) => normalizeRegion(r, i));
  } else {
    regions = inferFocusFromSummary(gemini.summary || "");
  }

  regions = ensureLogoCornerCheck(regions, gemini);
  return regions.map((r, i) => ({ ...r, id: i + 1 }));
}

const KEYWORD_REGIONS = [
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

  return found.map(normalizeRegion);
}

export function resolveFocusRegions(gemini) {
  if (!gemini?.ok) return [];
  const fromApi = gemini.focusRegions;
  if (Array.isArray(fromApi) && fromApi.length) {
    return fromApi.map(normalizeRegion);
  }
  return inferFocusFromSummary(gemini.summary || gemini.rawText || "");
}

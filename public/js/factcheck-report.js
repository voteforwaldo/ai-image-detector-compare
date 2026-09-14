const VERDICT_LABELS = {
  ai: "ИИ",
  human: "Човек",
  uncertain: "Неясно",
  error: "Грешка",
  meta: "Метаданни",
};

function verdictLabel(v) {
  return VERDICT_LABELS[v] || VERDICT_LABELS.uncertain;
}

function cardSnapshot(data) {
  if (!data?.ok) return { label: "Грешка", pct: null, verdict: "error" };
  const v = data.verdict || "uncertain";
  const pct =
    data.confidencePercent != null
      ? data.confidencePercent
      : Math.max(data.aiPercent ?? 0, data.humanPercent ?? 0);
  return { label: verdictLabel(v), pct, verdict: v };
}

function compareAiVerdicts(a, b) {
  if (a.verdict === "error" || b.verdict === "error") {
    return { type: "partial", text: "Един от детекторите не отговори" };
  }
  if (a.verdict === b.verdict) {
    return { type: "agree", text: "AI or Not и Gemini съвпадат" };
  }
  if (a.verdict === "uncertain" || b.verdict === "uncertain") {
    return { type: "partial", text: "Частично съвпадение между детекторите" };
  }
  return { type: "disagree", text: "Различни вердикти между детекторите" };
}

function overallHeadline(aiMatch, aiornot, gemini) {
  const a = cardSnapshot(aiornot);
  const g = cardSnapshot(gemini);

  if (aiMatch.type === "disagree") {
    return "Нужна е ръчна проверка — детекторите не съвпадат";
  }

  if (a.verdict === "ai" || g.verdict === "ai") {
    if (aiMatch.type === "agree") {
      return "Вероятно изображение, генерирано или обработено с ИИ";
    }
    return "Има сигнал за ИИ — препоръчва се ръчен преглед";
  }

  if (a.verdict === "human" && g.verdict === "human") {
    return "Няма силни сигнали за ИИ в автоматичната проверка";
  }

  return "Неясно — препоръчва се допълнителна проверка";
}

export const SYNTHID_EXPLAINER_PARAGRAPHS = [
  "SynthID е невидим цифров печат на Google. Само официалният детектор на Google (synthid.withgoogle.com) е меродавен.",
  "Локалният спектрален екран тук е неофициален скрининг. При разлика с официалния сайт — вярвайте на Google, не на локалния резултат.",
];

function buildBullets({ aiornot, gemini, exiftool, focusRegions, aiMatch }) {
  const bullets = [];
  const a = cardSnapshot(aiornot);
  const g = cardSnapshot(gemini);

  if (aiMatch.type === "disagree") {
    bullets.push(
      "Сравнете визуално снимката: AI or Not и Gemini дават различен вердикт — не публикувайте заключение само от един източник."
    );
  } else if (aiMatch.type === "agree" && (a.verdict === "ai" || g.verdict === "ai")) {
    bullets.push(
      "Двата ИИ детектора сочат еднакъв резултат — потърсете оригинал, дата и контекст на публикацията."
    );
  }

  if (a.verdict === "uncertain" || g.verdict === "uncertain") {
    bullets.push("Вердиктът е неясен — направете ръчен преглед на детайли (лице, ръце, текст, фон).");
  }

  if (exiftool?.ok && exiftool.hasAiMarkers) {
    bullets.push("В метаданните има ИИ/provenance маркери — проверете ги в раздела Метаданни.");
  }

  if (focusRegions?.length) {
    bullets.push(
      `На снимката са маркирани ${focusRegions.length} зони за внимание — посочете ги при обсъждане с екипа.`
    );
  }

  if (!aiornot?.ok && bullets.length < 5) {
    bullets.push("AI or Not API не отговори — опитайте отново или проверете ключа в Настройки.");
  }

  if (!gemini?.ok && bullets.length < 5) {
    bullets.push("Gemini анализът не успя — опитайте повторен анализ.");
  }

  if (bullets.length < 3) {
    bullets.push(
      "Съпоставете резултата с други източници (обратно търсене, оригинална публикация, свидетели)."
    );
  }

  return bullets.slice(0, 5);
}

/**
 * @returns Unified factcheck report model for UI, copy, and print.
 */
export function buildFactcheckReport({ aiornot, gemini, exiftool, synthid, fileName, at, focusRegions }) {
  const a = cardSnapshot(aiornot);
  const g = cardSnapshot(gemini);
  const aiMatch = compareAiVerdicts(a, g);

  const rows = [
    {
      source: "AI or Not",
      verdict: a.label,
      detail: a.pct != null ? `${a.pct}% сигурност` : "—",
      tone: a.verdict,
    },
    {
      source: "Google Gemini",
      verdict: g.label,
      detail: g.pct != null ? `${g.pct}% сигурност` : "—",
      tone: g.verdict,
    },
  ];

  if (exiftool) {
    const method = exiftool.method === "exiftool-vendored" ? "ExifTool" : "exifr";
    if (exiftool.ok) {
      rows.push({
        source: `Метаданни (${method})`,
        verdict: exiftool.hasAiMarkers ? "ИИ маркери" : "Без ИИ маркери",
        detail: `${exiftool.allFields?.length ?? exiftool.tagCount ?? 0} полета`,
        tone: exiftool.hasAiMarkers ? "ai" : "human",
        noRating: true,
      });
    } else {
      rows.push({
        source: "Метаданни",
        verdict: "Грешка",
        detail: exiftool.error || "—",
        tone: "error",
        noRating: true,
      });
    }
  }

  if (synthid?.ok) {
    rows.push({
      source: "SynthID (локален екран)",
      verdict: synthid.detected ? "Възможен сигнал" : "Няма потвърден",
      detail: synthid.detected
        ? "Неофициално — потвърдете на synthid.withgoogle.com"
        : "Официалната проверка: synthid.withgoogle.com",
      tone: synthid.detected ? "synthid-detected" : "uncertain",
      noRating: true,
    });
  }

  return {
    headline: overallHeadline(aiMatch, aiornot, gemini),
    meta: `${fileName || "—"} · ${at || ""}`,
    badge: aiMatch,
    rows,
    conclusion: aiMatch.text,
    bullets: buildBullets({ aiornot, gemini, exiftool, focusRegions, aiMatch }),
    aiMatch,
    synthidDetected: Boolean(synthid?.ok && synthid.detected),
  };
}

export function reportToPlainText(report) {
  if (!report) return "";
  const lines = [
    report.headline,
    report.meta,
    report.badge?.text || "",
    "",
    "Източници:",
    ...report.rows.map((r) => `- ${r.source}: ${r.verdict}${r.detail ? ` (${r.detail})` : ""}`),
    "",
    "Заключение:",
    report.conclusion,
    "",
    "Какво да направите:",
    ...report.bullets.map((b) => `- ${b}`),
  ];
  if (report.synthidDetected) {
    lines.push("", ...SYNTHID_EXPLAINER_PARAGRAPHS);
  }
  return lines.filter((l) => l != null).join("\n");
}

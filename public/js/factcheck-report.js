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

  const pct = Math.max(data.aiPercent ?? 0, data.humanPercent ?? 0);

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



function exifSignal(exiftool) {
  if (!exiftool?.ok) return { level: "error", short: "—", verdict: "error" };
  if (!exiftool.hasAiMarkers) {
    return { level: "ok", short: "Без ИИ маркери", verdict: "ok", hideInSummary: true };
  }
  const aiWarns = (exiftool.highlights || []).filter((h) => h.aiMarker).length;
  return {
    level: "warn",
    short: aiWarns > 1 ? `${aiWarns} ИИ сигнала` : "ИИ в метаданни",
    verdict: "warn",
  };
}



function overallHeadline(aiMatch, gemini, exif) {

  const g = cardSnapshot(gemini);

  const ex = exifSignal(exif);



  if (aiMatch.type === "disagree") {

    return "Нужна е ръчна проверка — детекторите не съвпадат";

  }

  if (g.verdict === "ai" && ex.level === "warn" && exif?.hasAiMarkers) {
    return "Силни сигнали за ИИ — детектор + метаданни";
  }

  if (g.verdict === "ai" || (aiMatch.type === "agree" && g.verdict === "ai")) {

    return "Вероятно изображение, генерирано или обработено с ИИ";

  }

  if (g.verdict === "human" && ex.level === "ok") {

    return "Няма силни сигнали за ИИ в автоматичната проверка";

  }

  if (g.verdict === "uncertain") {

    return "Неясно — препоръчва се допълнителна проверка";

  }

  return "Прегледайте отчета и маркираните зони";

}



function buildBullets({ aiornot, gemini, exiftool, focusRegions, aiMatch }) {

  const bullets = [];

  const g = cardSnapshot(gemini);

  const ex = exifSignal(exiftool);



  if (aiMatch.type === "disagree") {

    bullets.push(

      "Сравнете визуално снимката: AI or Not и Gemini дават различен вердикт — не публикувайте заключение само от един източник."

    );

  } else if (aiMatch.type === "agree" && g.verdict === "ai") {

    bullets.push("Двата ИИ детектора сочат еднакъв резултат — потърсете оригинал, дата и контекст на публикацията.");

  }



  if (g.verdict === "uncertain") {

    bullets.push("Вердиктът е неясен — направете ръчен преглед на детайли (лице, ръце, текст, фон).");

  }



  if (focusRegions?.length) {

    bullets.push(

      `На снимката са маркирани ${focusRegions.length} зони за внимание — посочете ги при обсъждане с екипа.`

    );

  }



  for (const h of exiftool?.highlights || []) {
    if (h.aiMarker && bullets.length < 5) {
      bullets.push(h.text);
    }
  }



  if (ex.level === "neutral" && bullets.length < 5) {

    bullets.push(

      "Метаданните са изчистени или оскъдни — не разчитайте само на EXIF; проверете източника на файла."

    );

  }



  if (!aiornot?.ok && bullets.length < 5) {

    bullets.push("AI or Not API не отговори — опитайте отново или проверете ключа в Настройки.");

  }



  if (!gemini?.ok && bullets.length < 5) {

    bullets.push("Gemini анализът не успя — опитайте повторен анализ.");

  }



  if (bullets.length < 3) {

    bullets.push("Съпоставете резултата с други източници (обратно търсене, оригинална публикация, свидетели).");

  }



  return bullets.slice(0, 5);

}



/**

 * @returns Unified factcheck report model for UI, copy, and print.

 */

export function buildFactcheckReport({ aiornot, gemini, exiftool, fileName, at, focusRegions }) {

  const a = cardSnapshot(aiornot);

  const g = cardSnapshot(gemini);

  const ex = exifSignal(exiftool);

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

    ...(exiftool?.ok && exiftool.hasAiMarkers
      ? [
          {
            source: "ExifTool",
            verdict: ex.short,
            detail: (exiftool.summary || "").slice(0, 80),
            tone: ex.verdict,
          },
        ]
      : exiftool?.ok
        ? []
        : [
            {
              source: "ExifTool",
              verdict: ex.short,
              detail: exiftool?.error || "Грешка",
              tone: "error",
            },
          ]),
  ];



  let conclusion = aiMatch.text;

  if (exiftool?.hasAiMarkers) {
    conclusion += ". Метаданните съдържат сигнали за ИИ (софтуер, C2PA или генеративни параметри).";
  } else if (exiftool?.ok && aiMatch.type === "agree" && g.verdict === "human") {
    conclusion += ". Метаданните не показват ИИ маркери в проверените полета.";
  }



  return {

    headline: overallHeadline(aiMatch, gemini, exiftool),

    meta: `${fileName || "—"} · ${at || ""}`,

    badge: aiMatch,

    rows,

    conclusion,

    bullets: buildBullets({ aiornot, gemini, exiftool, focusRegions, aiMatch }),

    aiMatch,

  };

}



export function reportToPlainText(report) {

  if (!report) return "";

  let text = `ФАКТЧЕК ОТЧЕТ — factcheck.bg\n`;

  text += `${report.headline}\n`;

  text += `${report.meta}\n\n`;

  text += `Общо: ${report.conclusion}\n\n`;

  for (const r of report.rows) {

    text += `${r.source}: ${r.verdict} (${r.detail})\n`;

  }

  text += `\nКакво да проверите:\n`;

  for (const b of report.bullets) {

    text += `• ${b}\n`;

  }

  return text;

}


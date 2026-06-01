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



function overallHeadline(aiMatch, gemini) {
  const g = cardSnapshot(gemini);

  if (aiMatch.type === "disagree") {
    return "Нужна е ръчна проверка — детекторите не съвпадат";
  }

  if (g.verdict === "ai" || (aiMatch.type === "agree" && g.verdict === "ai")) {
    return "Вероятно изображение, генерирано или обработено с ИИ";
  }

  if (g.verdict === "human" && aiMatch.type === "agree") {
    return "Няма силни сигнали за ИИ в автоматичната проверка";
  }

  if (g.verdict === "uncertain") {
    return "Неясно — препоръчва се допълнителна проверка";
  }

  return "Прегледайте отчета и маркираните зони";
}



function buildBullets({ aiornot, gemini, synthid, focusRegions, aiMatch }) {
  const bullets = [];
  const g = cardSnapshot(gemini);

  if (synthid?.ok && synthid.detected) {
    bullets.push(
      `Спектралният Synth ID детектор откри Google watermark. ${synthid.summary || ""}`.trim()
    );
  }

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

function detectorPhrase(name, snap, data) {
  if (!data?.ok) return `${name} не отговори`;
  const pct = snap.pct != null ? ` (${snap.pct}%)` : "";
  return `${name} — ${snap.label}${pct}`;
}

/**
 * 2–4 изречения на български за копиране в редакция / PDF.
 */
export function buildEditorialVerdict({ aiornot, gemini, exiftool, synthid, fileName, at }) {
  const a = cardSnapshot(aiornot);
  const g = cardSnapshot(gemini);
  const aiMatch = compareAiVerdicts(a, g);
  const sentences = [];

  const label = fileName ? `„${fileName}"` : "каченото изображение";
  const stamp = at ? ` на ${at}` : "";
  sentences.push(`Проверка на ${label}${stamp} с инструментите на factcheck.bg.`);

  if (a.verdict === "error" || g.verdict === "error") {
    sentences.push(
      `Част от автоматичните детектори не върнаха резултат (${detectorPhrase("AI or Not", a, aiornot)}; ${detectorPhrase("Gemini", g, gemini)}).`
    );
  } else if (aiMatch.type === "disagree") {
    sentences.push(
      `Детекторите не съвпадат: ${detectorPhrase("AI or Not", a, aiornot)}, а ${detectorPhrase("Google Gemini", g, gemini)} — необходим е ръчен преглед преди публикация.`
    );
  } else if (aiMatch.type === "agree" && g.verdict === "ai") {
    sentences.push(
      `И двата основни детектора оценяват изображението като ИИ: ${detectorPhrase("AI or Not", a, aiornot)} и ${detectorPhrase("Google Gemini", g, gemini)}.`
    );
  } else if (aiMatch.type === "agree" && g.verdict === "human") {
    sentences.push(
      `И двата детектора не откриват силен ИИ сигнал: ${detectorPhrase("AI or Not", a, aiornot)} и ${detectorPhrase("Google Gemini", g, gemini)}.`
    );
  } else {
    sentences.push(
      `${detectorPhrase("AI or Not", a, aiornot)}. ${detectorPhrase("Google Gemini", g, gemini)}.`
    );
  }

  if (synthid?.ok && synthid.detected) {
    sentences.push(
      "Спектралният анализ откри Synth ID — технически индикатор за невидим Google watermark в пикселите."
    );
  }

  if (exiftool?.ok) {
    if (exiftool.hasC2paProvenance) {
      sentences.push(
        "В метаданните има C2PA / Content Credentials — силен цифров сигнал за алгоритмичен или синтетичен произход."
      );
    } else if (exiftool.hasAiMarkers) {
      sentences.push(
        "Метаданните (ExifTool) съдържат маркери, свързани с ИИ, provenance или digital watermark."
      );
    } else if ((exiftool.allFields?.length ?? exiftool.tagCount ?? 0) < 8) {
      sentences.push(
        "Вградените метаданни са оскъдни или липсват — често след споделяне онлайн; това не доказва произхода."
      );
    }
  }

  const needsCaution =
    aiMatch.type === "disagree" ||
    g.verdict === "uncertain" ||
    a.verdict === "uncertain" ||
    (synthid?.ok && synthid.detected);

  if (aiMatch.type !== "disagree") {
    if (g.verdict === "ai" || (synthid?.ok && synthid.detected)) {
      sentences.push(
        "Препоръка: потвърдете с оригиналния източник и контекста преди да публикувате категорично заключение."
      );
    } else if (needsCaution) {
      sentences.push(
        "Препоръка: допълнителен ръчен преглед и съпоставка с оригиналната публикация."
      );
    } else {
      sentences.push(
        "Препоръка: при съмнение съпоставете с други източници — автоматичната проверка не е окончателна."
      );
    }
  }

  const trimmed = sentences.slice(0, 4);
  return {
    text: trimmed.join(" "),
    sentences: trimmed,
  };
}

export function editorialToPlainText({ editorial, fileName, at }) {
  let text = "ТЕКСТ ЗА РЕДАКЦИЯ — factcheck.bg\n";
  if (fileName || at) {
    text += [fileName, at].filter(Boolean).join(" · ") + "\n\n";
  }
  text += `${editorial.text}\n\n`;
  text += "—\nАнализ: factcheck.bg · ИИ инструмент\n";
  return text;
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

  if (synthid?.ok && synthid.detected) {
    rows.push({
      source: "Synth ID",
      verdict: "Открит",
      detail: "",
      tone: "synthid-detected",
      noRating: true,
    });
  }

  const conclusion = aiMatch.text;
  const editorial = buildEditorialVerdict({ aiornot, gemini, exiftool, synthid, fileName, at });

  return {
    headline: overallHeadline(aiMatch, gemini),
    meta: `${fileName || "—"} · ${at || ""}`,
    badge: aiMatch,
    rows,
    conclusion,
    bullets: buildBullets({ aiornot, gemini, synthid, focusRegions, aiMatch }),
    aiMatch,
    editorial,
  };
}



export function reportToPlainText(report) {

  if (!report) return "";

  let text = `ФАКТЧЕК ОТЧЕТ — factcheck.bg\n`;

  text += `${report.headline}\n`;

  text += `${report.meta}\n\n`;

  text += `Общо: ${report.conclusion}\n\n`;

  for (const r of report.rows) {
    if (r.noRating) {
      text += `${r.source}: ${r.verdict}\n`;
    } else {
      text += `${r.source}: ${r.verdict} (${r.detail})\n`;
    }
  }

  text += `\nКакво да проверите:\n`;

  for (const b of report.bullets) {

    text += `• ${b}\n`;

  }

  return text;

}


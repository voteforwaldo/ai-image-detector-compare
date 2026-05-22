const AI_SOFTWARE_RE =
  /midjourney|dall[\s-]?e|stable\s*diffusion|adobe\s*firefly|openai|leonardo|ideogram|runway|canva|imagen|gemini|sora|chatgpt|comfyui|automatic1111|fooocus|generative|nightcafe|bing\s*image|flux\.?1|playground\s*ai|picsart|lensa|remini|prisma|wombo|dream\s*studio|starryai|craiyon|pixlr\s*ai/i;

const EDITOR_RE =
  /photoshop|lightroom|gimp|snapseed|vsco|capture\s*one|affinity|pixelmator|paint\.net|figma|inkscape/i;

function tagValue(tags, ...names) {
  for (const name of names) {
    const v = tags[name];
    if (v == null || v === "") continue;
    if (Array.isArray(v)) return v.filter(Boolean).join(", ");
    return String(v);
  }
  return null;
}

function tagCount(tags) {
  return Object.keys(tags).filter((k) => tags[k] != null && tags[k] !== "").length;
}

function formatDate(v) {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}:\d{2}:\d{2}/.test(s)) {
    const [d, t] = s.split(" ");
    return `${d.replace(/:/g, "-")}${t ? ` ${t}` : ""}`;
  }
  return s;
}

function pushHighlight(list, tone, text, aiMarker = false) {
  list.push({ tone, text, aiMarker: Boolean(aiMarker) });
}

export function exifHasAiMarkers(highlights) {
  return (highlights || []).some((h) => h.aiMarker);
}

/**
 * Turn ExifTool tag object into short Bulgarian explanations for journalists.
 */
export function explainExifTags(tags) {
  const highlights = [];
  const facts = [];

  const fileType = tagValue(tags, "FileType", "MIMEType");
  const width = tagValue(tags, "ImageWidth", "ExifImageWidth", "SourceImageWidth");
  const height = tagValue(tags, "ImageHeight", "ExifImageHeight", "SourceImageHeight");
  const size = tagValue(tags, "FileSize");
  const megapixels = tagValue(tags, "Megapixels");

  if (fileType) facts.push({ label: "Формат", value: fileType });
  if (width && height) facts.push({ label: "Размери", value: `${width} × ${height} px` });
  if (megapixels) facts.push({ label: "Мегапиксели", value: megapixels });
  if (size) {
    const n = Number(size);
    facts.push({
      label: "Размер на файла",
      value: Number.isFinite(n) ? `${(n / 1024).toFixed(1)} КБ` : size,
    });
  }

  const make = tagValue(tags, "Make");
  const model = tagValue(tags, "Model", "CameraModelName");
  const lens = tagValue(tags, "LensModel", "Lens");
  if (make || model) {
    const cam = [make, model].filter(Boolean).join(" ");
    facts.push({ label: "Камера / устройство", value: cam });
    pushHighlight(
      highlights,
      "info",
      `В метаданните има информация за устройство: ${cam}. Това подкрепя идеята за снимка от реална камера или телефон, но не гарантира автентичност.`
    );
  }
  if (lens) {
    facts.push({ label: "Обектив", value: lens });
    pushHighlight(highlights, "info", `Записан е обектив: ${lens}.`);
  }

  const software = tagValue(
    tags,
    "Software",
    "CreatorTool",
    "ProcessingSoftware",
    "HistorySoftwareAgent",
    "DerivedFrom",
    "PNG:Parameters"
  );
  if (software) {
    facts.push({ label: "Софтуер", value: software.slice(0, 200) });
    if (AI_SOFTWARE_RE.test(software)) {
      pushHighlight(
        highlights,
        "warn",
        `В метаданните се вижда софтуер, свързан с ИИ или генерация: „${software.slice(0, 120)}“. Това е силен индикатор за обработка с изкуствен интелект.`,
        true
      );
    } else if (EDITOR_RE.test(software)) {
      pushHighlight(
        highlights,
        "warn",
        `Файлът е обработван с редактор („${software.slice(0, 80)}“). Редакцията не означава автоматично ИИ, но метаданните показват намеса след заснемане.`
      );
    } else {
      pushHighlight(
        highlights,
        "neutral",
        `Записан е софтуер при създаване или запис: „${software.slice(0, 80)}“. Проверете дали съвпада с очаквания източник.`
      );
    }
  }

  const claimGen = tagValue(
    tags,
    "ClaimGenerator",
    "Claim_Generator",
    "Creator",
    "DigitalSourceType",
    "ContentIdentifier",
    "Manifest"
  );
  const c2pa = tagValue(tags, "C2PA", "JUMBF", "ContentCredentials", "Actions");
  if (claimGen || c2pa) {
    const cred = [claimGen, c2pa].filter(Boolean).join(" · ");
    facts.push({ label: "Съдържателни идентификатори (C2PA)", value: cred.slice(0, 240) });
    if (/trainedalgorithmic|algorithmic|composite|synthetic|ai/i.test(cred)) {
      pushHighlight(
        highlights,
        "warn",
        "Открити са цифрови идентификатори (C2PA / Content Credentials), които маркират изображението като създадено или променено с алгоритъм — важен сигнал за ИИ.",
        true
      );
    } else {
      pushHighlight(
        highlights,
        "info",
        "Има вградени цифрови идентификатори (C2PA). Прегледайте ги за произход и редакции."
      );
    }
  }

  const pngParams = tagValue(tags, "PNG:Parameters", "Parameters");
  if (pngParams && /steps|sampler|cfg|seed|model/i.test(pngParams)) {
    facts.push({ label: "PNG параметри", value: pngParams.slice(0, 200) });
    pushHighlight(
      highlights,
      "warn",
      "В PNG метаданните има типични параметри на генеративен модел (стъпки, seed, CFG и др.) — силен признак за ИИ изображение.",
      true
    );
  }

  const created = formatDate(
    tagValue(tags, "DateTimeOriginal", "CreateDate", "MediaCreateDate", "CreationDate")
  );
  const modified = formatDate(tagValue(tags, "ModifyDate", "FileModifyDate", "MetadataDate"));
  if (created) facts.push({ label: "Дата на заснемане", value: created });
  if (modified) facts.push({ label: "Последна промяна", value: modified });
  if (created && modified && created !== modified) {
    pushHighlight(
      highlights,
      "neutral",
      `Датата на заснемане (${created}) е различна от датата на последна промяна (${modified}) — файлът е редактиран след създаване.`
    );
  } else if (created) {
    pushHighlight(highlights, "info", `Дата на заснемане/създаване в EXIF: ${created}.`);
  }

  const gps = tagValue(tags, "GPSPosition", "GPSLatitude", "Location");
  if (gps) {
    facts.push({ label: "GPS", value: gps });
    pushHighlight(
      highlights,
      "neutral",
      "Снимката съдържа GPS координати — може да разкрие място на заснемане (ако не са премахнати умишлено)."
    );
  }

  const author = tagValue(tags, "Artist", "Creator", "By-line", "Credit", "Copyright");
  if (author) {
    facts.push({ label: "Автор / кредити", value: author.slice(0, 160) });
    pushHighlight(highlights, "info", `В метаданните има автор или кредит: „${author.slice(0, 80)}“.`);
  }

  const description = tagValue(tags, "ImageDescription", "Description", "Caption-Abstract", "Title");
  if (description) {
    facts.push({ label: "Описание", value: description.slice(0, 200) });
  }

  const count = tagCount(tags);
  let summary;

  if (count < 8) {
    summary =
      "Почти няма метаданни във файла — често след споделяне в мрежи, екранна снимка или умишлено изчистване. Липсата на EXIF не доказва нищо сама по себе си.";
    pushHighlight(
      highlights,
      "neutral",
      "Файлът има много малко или никакви вградени метаданни (EXIF/XMP). Това затруднява проверката на произхода само по метаданни."
    );
  } else if (exifHasAiMarkers(highlights)) {
    summary =
      "Метаданните съдържат сигнали, свързани с ИИ, редактор или цифрови идентификатори — прегледайте обясненията по-долу.";
  } else if (make || model) {
    summary =
      "Открити са типични метаданни от камера/устройство без явни ИИ маркери в софтуера. Това не изключва по-късна ИИ обработка.";
  } else {
    summary = `Открити са ${count} полета с метаданни. Няма очевидни ИИ маркери в софтуера, но прегледайте детайлите.`;
  }

  if (!highlights.length) {
    pushHighlight(
      highlights,
      "info",
      "Метаданните са налични, но без необичайни софтуерни или C2PA маркери в проверените полета."
    );
  }

  return {
    summary,
    highlights,
    facts,
    tagCount: count,
    hasAiMarkers: exifHasAiMarkers(highlights),
  };
}

import { buildFactcheckReport, reportToPlainText } from "./factcheck-report.js";
import { resolveFocusRegions } from "./focus-regions.js";

const STORAGE_KEYS = "aidetector_keys";
const THEME_KEY = "aidetector-theme";

const $ = (sel) => document.querySelector(sel);

const authGate = $("#auth-gate");
const appRoot = $("#app-root");
const authForm = $("#auth-form");
const authPassword = $("#auth-password");
const authError = $("#auth-error");

const dropzone = $("#dropzone");
const fileInput = $("#file-input");
const previewWrap = $("#preview-wrap");
const previewImg = $("#preview-img");
const dropzoneEmpty = $("#dropzone-empty");
const terminal = $("#terminal");
const resultsPanel = $("#results-panel");
const layout = $("#main-layout");
const btnUpload = $("#btn-upload");
const btnClear = $("#btn-clear");
const btnAnalyze = $("#btn-analyze");
const btnMobileUpload = $("#btn-mobile-upload");
const settingsDialog = $("#settings-dialog");
const settingsForm = $("#settings-form");

const fcReport = $("#fc-report");
const techLog = $("#tech-log");
const fcReportTitle = $("#fc-report-title");
const fcReportMeta = $("#fc-report-meta");
const fcReportBadge = $("#fc-report-badge");
const fcReportRows = $("#fc-report-rows");
const fcReportConclusion = $("#fc-report-conclusion");
const fcReportBullets = $("#fc-report-bullets");
const focusOverlay = $("#focus-overlay");
const focusLegend = $("#focus-legend");
const loadingPanel = $("#loading-panel");
const analyzeError = $("#analyze-error");
const analyzeErrorMsg = $("#analyze-error-msg");
const btnRetryAnalyze = $("#btn-retry-analyze");
const resultsGrid = $("#results-grid");
const exifPanel = $("#exif-panel");
const exifSummary = $("#exif-summary");
const exifHighlights = $("#exif-highlights");
const exifAllHeading = $("#exif-all-heading");
const exifAllFields = $("#exif-all-fields");
const exifError = $("#exif-error");
const exportActions = $("#export-actions");
const btnCopyReport = $("#btn-copy-report");
const btnPrintReport = $("#btn-print-report");
const printReport = $("#print-report");
const mobileBar = $("#mobile-bar");
const toast = $("#toast");

const VERDICT_LABELS = {
  ai: "ИИ",
  human: "Човек",
  uncertain: "Неясно",
};

let selectedFile = null;
let keys = { aiornot: "", gemini: "" };
let lastResult = null;
let lastReport = null;
let previewObjectUrl = null;

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function updateStep(step) {
  for (let i = 1; i <= 3; i++) {
    const el = $(`#step-item-${i}`);
    if (!el) continue;
    el.classList.remove("is-active", "is-done");
    if (i < step) el.classList.add("is-done");
    else if (i === step) el.classList.add("is-active");
  }
}

function fetchOpts(extra = {}) {
  return { credentials: "include", ...extra };
}

async function safeJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.replace(/\s+/g, " ").slice(0, 120);
    if (preview.includes("SERVICE_UNAVAILABLE") || preview.includes("deployment is currently unavailable")) {
      throw new Error(
        "Сървърът временно не отговори. Изчакайте минута, намалете файла (до 4 МБ) и опитайте отново."
      );
    }
    throw new Error(
      preview.startsWith("<")
        ? "Сървърът върна грешка (HTML). Проверете Vercel deployment."
        : `Невалиден отговор от сървъра: ${preview}`
    );
  }
}

function apiBase() {
  const meta = document.querySelector('meta[name="api-base"]');
  if (meta?.content) return meta.content.replace(/\/$/, "");
  return "";
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add("hidden"), 2800);
}

function showApp() {
  authGate.classList.add("hidden");
  appRoot.classList.remove("hidden");
}

function showAuthGate() {
  authGate.classList.remove("hidden");
  appRoot.classList.add("hidden");
}

function showAuthGateError(message) {
  showAuthGate();
  if (message) {
    authError.textContent = message;
    authError.classList.remove("hidden");
  }
}

async function initAuth() {
  try {
    const res = await fetch(`${apiBase()}/api/auth-status`, fetchOpts());
    let data;
    try {
      data = await safeJson(res);
    } catch {
      data = null;
    }

    if (!res.ok || !data) {
      showAuthGateError(
        "Сървърът не отговори при проверка на паролата. Опитайте отново след минута."
      );
      return;
    }

    if (!data.required) {
      showApp();
      return;
    }

    if (data.authenticated) {
      showApp();
      return;
    }

    showAuthGate();
  } catch {
    showAuthGateError(
      "Няма връзка с API. Ако сайтът е на Vercel, проверете deployment и SITE_PASSWORD."
    );
  }
}

authForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.classList.add("hidden");
  authError.textContent = "";

  try {
    const res = await fetch(`${apiBase()}/api/auth-login`, fetchOpts({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: authPassword.value }),
    }));
    const data = await safeJson(res);
    if (!res.ok) {
      authError.textContent = data.error || "Грешна парола";
      authError.classList.remove("hidden");
      return;
    }
    authPassword.value = "";
    showApp();
  } catch {
    authError.textContent = "Неуспешен вход. Опитайте отново.";
    authError.classList.remove("hidden");
  }
});

function loadKeys() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEYS);
    if (raw) keys = JSON.parse(raw);
  } catch {
    /* ignore */
  }
  $("#input-aiornot").value = keys.aiornot || "";
  $("#input-gemini").value = keys.gemini || "";
}

function saveKeys() {
  if ($("#remember-keys").checked) {
    sessionStorage.setItem(
      STORAGE_KEYS,
      JSON.stringify({ aiornot: keys.aiornot, gemini: keys.gemini })
    );
  } else {
    sessionStorage.removeItem(STORAGE_KEYS);
  }
}

function log(message, type = "info") {
  const time = new Date().toTimeString().slice(0, 8);
  const line = document.createElement("div");
  line.className = `terminal-line${type === "muted" ? " muted" : ""}${type === "error" ? " error" : ""}`;
  line.textContent = `[${time}] ${message}`;
  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;
}

function clearTerminal() {
  terminal.innerHTML = "";
}

function verdictLabel(verdict) {
  return VERDICT_LABELS[verdict] || VERDICT_LABELS.uncertain;
}

function cardSnapshot(data) {
  if (!data?.ok) {
    return { label: "Грешка", pct: null, verdict: "error" };
  }
  const v = data.verdict || "uncertain";
  const pct = Math.max(data.aiPercent ?? 0, data.humanPercent ?? 0);
  return { label: verdictLabel(v), pct, verdict: v };
}

function renderFactcheckReport(report) {
  if (!report) return;
  lastReport = report;
  fcReportTitle.textContent = report.headline;
  fcReportMeta.textContent = report.meta;
  fcReportBadge.textContent = report.badge.text;
  fcReportBadge.className = `fc-report-badge ${report.badge.type}`;
  fcReportConclusion.textContent = report.conclusion;

  fcReportRows.innerHTML = report.rows
    .map(
      (r) => `
    <tr>
      <td>${escHtml(r.source)}</td>
      <td><span class="fc-verdict ${escHtml(r.tone)}">${escHtml(r.verdict)}</span></td>
      <td>${escHtml(r.detail)}</td>
    </tr>`
    )
    .join("");

  fcReportBullets.innerHTML = report.bullets.map((b) => `<li>${escHtml(b)}</li>`).join("");
  fcReport.classList.remove("hidden");
}

function renderFocusOverlay(regions) {
  focusOverlay.innerHTML = "";
  focusLegend.innerHTML = "";

  if (!regions?.length) {
    focusOverlay.classList.add("hidden");
    focusLegend.classList.add("hidden");
    focusOverlay.setAttribute("aria-hidden", "true");
    return;
  }

  focusOverlay.classList.remove("hidden");
  focusLegend.classList.remove("hidden");
  focusOverlay.setAttribute("aria-hidden", "false");

  for (const r of regions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `focus-marker ${r.severity}`;
    btn.style.left = `${r.x * 100}%`;
    btn.style.top = `${r.y * 100}%`;
    btn.style.width = `${r.w * 100}%`;
    btn.style.height = `${r.h * 100}%`;
    btn.title = r.note;
    btn.setAttribute("aria-label", `${r.label}: ${r.note}`);
    btn.innerHTML = `<span class="focus-marker-num">${r.id}</span>`;
    focusOverlay.appendChild(btn);

    const li = document.createElement("li");
    li.innerHTML = `<span class="focus-legend-num">${r.id}</span> <strong>${escHtml(r.label)}</strong> — ${escHtml(r.note)}`;
    focusLegend.appendChild(li);
  }
}

function showAnalyzeError(message) {
  analyzeErrorMsg.textContent = message;
  analyzeError.classList.remove("hidden");
}

function hideAnalyzeError() {
  analyzeError.classList.add("hidden");
  analyzeErrorMsg.textContent = "";
}

function showLoading() {
  updateStep(2);
  hideAnalyzeError();
  fcReport.classList.add("hidden");
  resultsGrid.classList.add("hidden");
  exifPanel.classList.add("hidden");
  exportActions.classList.add("hidden");
  loadingPanel.classList.remove("hidden");
  renderFocusOverlay([]);
}

function fetchErrorMessage(err) {
  const msg = err?.message || "";
  if (msg === "Failed to fetch" || err?.name === "TypeError") {
    return (
      "Няма връзка със сървъра. Стартирайте start-local.bat и оставете прозореца отворен. " +
      "Отворете http://127.0.0.1:3000 (не само localhost, ако връзката отказва)."
    );
  }
  if (err?.name === "AbortError") {
    return "Анализът отне твърде много време (над 5 мин). Опитайте с по-малък файл.";
  }
  return msg || "Анализът не успя";
}

async function checkServerHealth() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${apiBase()}/api/health`, fetchOpts({ signal: ctrl.signal }));
    if (!res.ok) throw new Error("health");
  } catch (err) {
    throw new Error(fetchErrorMessage(err));
  } finally {
    clearTimeout(t);
  }
}

function hideLoading(finished = true) {
  loadingPanel.classList.add("hidden");
  if (finished) {
    resultsGrid.classList.remove("hidden");
    exifPanel.classList.remove("hidden");
    exportActions.classList.remove("hidden");
    updateStep(3);
  }
}

function imageFromClipboard(event) {
  const items = event.clipboardData?.items;
  if (!items?.length) return null;

  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }

  for (const item of items) {
    if (item.kind === "string" && item.type === "text/html") {
      const html = event.clipboardData.getData("text/html");
      const srcMatch = /<img[^>]+src=["']([^"']+)["']/i.exec(html || "");
      if (srcMatch?.[1]?.startsWith("data:image/")) {
        return dataUrlToFile(srcMatch[1]);
      }
    }
  }

  return null;
}

function dataUrlToFile(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  if (!base64) return null;
  const mime = /data:([^;]+)/.exec(header)?.[1] || "image/png";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ext = mime.split("/")[1]?.replace("jpeg", "jpg") || "png";
  return new File([bytes], `clipboard-${Date.now()}.${ext}`, { type: mime });
}

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

function setFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    log("Моля, изберете файл с изображение.", "error");
    showToast("Само файлове с изображения");
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    log("Файлът е над 4 МБ. Намалете изображението преди качване.", "error");
    showToast("Максимум 4 МБ");
    return;
  }
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  selectedFile = file;
  previewObjectUrl = URL.createObjectURL(file);
  previewImg.src = previewObjectUrl;
  previewWrap.classList.remove("hidden");
  dropzoneEmpty.classList.add("hidden");
  mobileBar.classList.remove("hidden");
  log(`Заредено: ${file.name} (${(file.size / 1024).toFixed(1)} КБ)`);
  runAnalysis();
}

function resetUpload() {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
  }
  selectedFile = null;
  lastResult = null;
  lastReport = null;
  previewImg.removeAttribute("src");
  previewWrap.classList.add("hidden");
  dropzoneEmpty.classList.remove("hidden");
  resultsPanel.classList.add("hidden");
  layout.classList.remove("has-results");
  fcReport.classList.add("hidden");
  hideAnalyzeError();
  mobileBar.classList.add("hidden");
  fileInput.value = "";
  renderFocusOverlay([]);
  updateStep(1);
  clearTerminal();
  log("Готов за ново качване.", "muted");
}

function updateCard(prefix, data) {
  const verdictEl = $(`#${prefix}-verdict`);
  const confEl = $(`#${prefix}-confidence`);
  const aiPct = $(`#${prefix}-ai-pct`);
  const humanPct = $(`#${prefix}-human-pct`);
  const aiBar = $(`#${prefix}-ai-bar`);
  const humanBar = $(`#${prefix}-human-bar`);
  const summaryEl = $(`#${prefix}-summary`);
  const errorEl = $(`#${prefix}-error`);

  errorEl.classList.add("hidden");
  errorEl.textContent = "";

  if (!data.ok) {
    verdictEl.textContent = "Грешка";
    verdictEl.className = "verdict-badge uncertain";
    confEl.textContent = "";
    summaryEl.textContent = "";
    errorEl.textContent = data.error || "Заявката не успя";
    errorEl.classList.remove("hidden");
    return null;
  }

  const v = data.verdict || "uncertain";
  verdictEl.textContent = verdictLabel(v);
  verdictEl.className = `verdict-badge ${v}`;

  const ai = data.aiPercent ?? 0;
  const human = data.humanPercent ?? 0;
  const mainConf = Math.max(ai, human);

  confEl.textContent = `${mainConf}% сигурност`;
  aiPct.textContent = `${ai}%`;
  humanPct.textContent = `${human}%`;
  aiBar.style.width = `${ai}%`;
  humanBar.style.width = `${human}%`;
  summaryEl.textContent = data.summary || "";
  return data;
}

function updateExiftool(data) {
  exifSummary.textContent = "";
  exifHighlights.innerHTML = "";
  exifAllFields.innerHTML = "";
  if (exifAllHeading) exifAllHeading.classList.add("hidden");
  exifError.classList.add("hidden");
  exifError.textContent = "";

  if (!data?.ok) {
    exifSummary.textContent = "Метаданните не можаха да се прочетат.";
    exifError.textContent = data?.error || "ExifTool заявката не успя";
    exifError.classList.remove("hidden");
    return;
  }

  exifSummary.textContent = data.summary || "Няма резюме.";

  exifHighlights.classList.remove("hidden");
  const aiHighlights = (data.highlights || []).filter((h) => h.aiMarker);
  if (aiHighlights.length) {
    for (const h of aiHighlights) {
      const li = document.createElement("li");
      li.className = "exif-warn";
      li.textContent = h.text;
      exifHighlights.appendChild(li);
    }
  } else {
    exifHighlights.classList.add("hidden");
  }

  const fields = data.allFields || [];
  if (exifAllHeading) {
    exifAllHeading.textContent = `Всички полета от ExifTool (${fields.length})`;
    exifAllHeading.classList.remove("hidden");
  }
  if (fields.length) {
    for (const f of fields) {
      const dt = document.createElement("dt");
      dt.textContent = f.label;
      const dd = document.createElement("dd");
      dd.textContent = f.value;
      exifAllFields.appendChild(dt);
      exifAllFields.appendChild(dd);
    }
  } else {
    const empty = document.createElement("p");
    empty.className = "exif-empty";
    empty.textContent = "ExifTool не върна полета с метаданни за този файл.";
    exifAllFields.appendChild(empty);
  }
}

function updateAiornotGenerators(generators) {
  const breakdown = $("#aon-breakdown");
  const list = $("#aon-generators");
  list.innerHTML = "";

  if (!generators?.length) {
    breakdown.classList.add("hidden");
    return;
  }

  breakdown.classList.remove("hidden");
  for (const g of generators) {
    const li = document.createElement("li");
    li.innerHTML = `<span>${g.name}</span><span>${g.confidence}%</span>`;
    list.appendChild(li);
  }
}

function buildReportText() {
  if (!lastReport) return "";
  let text = reportToPlainText(lastReport);
  if (!lastResult) return text;

  const { aiornot, gemini, exiftool } = lastResult;
  text += `\n--- Подробности ---\n`;
  if (aiornot?.ok) text += `AI or Not: ${aiornot.summary || ""}\n`;
  if (gemini?.ok) text += `Gemini: ${gemini.summary || ""}\n`;
  if (exiftool?.ok) text += `ExifTool: ${exiftool.summary || ""}\n`;
  return text;
}

function buildPrintHtml() {
  if (!lastResult || !lastReport) return "";
  const { aiornot, gemini, exiftool, previewSrc } = lastResult;

  const tableRows = lastReport.rows
    .map(
      (r) =>
        `<tr><td>${escHtml(r.source)}</td><td>${escHtml(r.verdict)}</td><td>${escHtml(r.detail)}</td></tr>`
    )
    .join("");

  const bullets = lastReport.bullets.map((b) => `<li>${escHtml(b)}</li>`).join("");

  return `
    <h1>Фактчек отчет — factcheck.bg</h1>
    <p class="meta">${escHtml(lastReport.meta)}</p>
    <h2>${escHtml(lastReport.headline)}</h2>
    <p><strong>${escHtml(lastReport.badge.text)}</strong></p>
    ${previewSrc ? `<img src="${previewSrc}" alt="Анализирано изображение" />` : ""}
    <table class="fc-report-table">
      <thead><tr><th>Източник</th><th>Резултат</th><th>Детайл</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <h3>Общо заключение</h3>
    <p>${escHtml(lastReport.conclusion)}</p>
    <h3>Какво да проверите</h3>
    <ul>${bullets}</ul>
    <h3>Подробности</h3>
    <p><strong>AI or Not:</strong></p>
    <pre>${escHtml(aiornot?.ok ? aiornot.summary : aiornot?.error || "—")}</pre>
    <p><strong>Gemini:</strong></p>
    <pre>${escHtml(gemini?.ok ? gemini.summary : gemini?.error || "—")}</pre>
    <p><strong>ExifTool:</strong></p>
    <pre>${escHtml(exiftool?.ok ? exiftool.summary : exiftool?.error || "—")}</pre>
  `;
}

async function copyReport() {
  const text = buildReportText();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast("Отчетът е копиран");
  } catch {
    showToast("Копирането не успя");
  }
}

function printReportPdf() {
  if (!lastResult) return;
  printReport.innerHTML = buildPrintHtml();
  printReport.classList.remove("hidden");
  window.print();
  setTimeout(() => {
    printReport.classList.add("hidden");
    printReport.innerHTML = "";
  }, 500);
}

async function runAnalysis() {
  if (!selectedFile) return;

  loadKeys();
  clearTerminal();
  log("Анализира се с AI or Not, Gemini и ExifTool...");
  resultsPanel.classList.remove("hidden");
  layout.classList.add("has-results");
  updateStep(2);
  showLoading();
  if (techLog) techLog.open = false;

  const form = new FormData();
  form.append("image", selectedFile);
  if (keys.aiornot) form.append("aiornot_key", keys.aiornot);
  if (keys.gemini) form.append("gemini_key", keys.gemini);

  try {
    await checkServerHealth();

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 300000);

    const res = await fetch(`${apiBase()}/api/analyze`, fetchOpts({
      method: "POST",
      body: form,
      signal: ctrl.signal,
    }));
    clearTimeout(timeout);

    const data = await safeJson(res);
    if (res.status === 401 && data.code === "auth_required") {
      showAuthGate();
      log("Нужен е вход с парола.", "error");
      hideLoading(false);
      updateStep(2);
      return;
    }

    if (!res.ok) {
      if (res.status === 413 || data?.code === "payload_too_large") {
        throw new Error(
          data?.error ||
            "Файлът е твърде голям за сървъра (обикновено до ~4 МБ на Vercel). Намалете изображението."
        );
      }
      if (res.status === 503) {
        throw new Error(
          "Сървърът временно не отговори (SERVICE_UNAVAILABLE). Изчакайте минута и опитайте с по-малко изображение, или проверете последния Vercel deploy."
        );
      }
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    hideLoading();

    const focusRegions = resolveFocusRegions(data.gemini);
    const at = new Date().toLocaleString("bg-BG");

    lastResult = {
      aiornot: data.aiornot,
      gemini: data.gemini,
      exiftool: data.exiftool,
      focusRegions,
      fileName: selectedFile.name,
      at,
      previewSrc: previewImg.src,
    };

    updateCard("aon", data.aiornot);
    updateCard("gem", data.gemini);
    updateExiftool(data.exiftool);
    renderFocusOverlay(focusRegions);
    renderFactcheckReport(
      buildFactcheckReport({
        aiornot: data.aiornot,
        gemini: data.gemini,
        exiftool: data.exiftool,
        fileName: selectedFile.name,
        at,
        focusRegions,
      })
    );

    fcReport.scrollIntoView({ behavior: "smooth", block: "nearest" });

    if (data.aiornot?.ok) {
      updateAiornotGenerators(data.aiornot.generators);
      log(`AI or Not: ${verdictLabel(data.aiornot.verdict)} (${data.aiornot.aiPercent}% ИИ)`);
    } else {
      log(`AI or Not — грешка: ${data.aiornot?.error}`, "error");
    }

    if (data.gemini?.ok) {
      log(
        `Gemini: ${verdictLabel(data.gemini.verdict)} (${data.gemini.confidencePercent ?? data.gemini.aiPercent}%)`
      );
    } else {
      log(`Gemini — грешка: ${data.gemini?.error}`, "error");
    }

    if (data.exiftool?.ok) {
      const exifNote = data.exiftool.hasAiMarkers
        ? "ИИ маркери в метаданни"
        : `${data.exiftool.allFields?.length ?? data.exiftool.tagCount ?? 0} полета`;
      log(`ExifTool: ${exifNote}`);
    } else {
      log(`ExifTool — грешка: ${data.exiftool?.error}`, "error");
    }

    log("Готово.");
  } catch (err) {
    hideLoading(false);
    updateStep(2);
    const friendly = fetchErrorMessage(err);
    showAnalyzeError(friendly);
    log(friendly, "error");
    if (techLog) techLog.open = true;
    showToast("Анализът не успя");
  }
}

btnRetryAnalyze?.addEventListener("click", () => runAnalysis());

dropzone.addEventListener("click", (e) => {
  if (e.target.closest("button")) return;
  if (!dropzoneEmpty.classList.contains("hidden")) fileInput.click();
});

btnUpload.addEventListener("click", (e) => {
  e.stopPropagation();
  fileInput.click();
});

btnMobileUpload.addEventListener("click", () => {
  resetUpload();
  fileInput.click();
});

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) setFile(fileInput.files[0]);
});

btnClear.addEventListener("click", (e) => {
  e.stopPropagation();
  resetUpload();
});

btnAnalyze.addEventListener("click", (e) => {
  e.stopPropagation();
  runAnalysis();
});

btnCopyReport.addEventListener("click", copyReport);
btnPrintReport.addEventListener("click", printReportPdf);

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});

dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));

dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file) setFile(file);
});

document.addEventListener("paste", (e) => {
  if (e.target.closest("input, textarea, dialog")) return;
  if (authGate.classList.contains("hidden") === false) return;
  if (appRoot.classList.contains("hidden")) return;

  const file = imageFromClipboard(e);
  if (!file) return;

  e.preventDefault();
  log("Поставено от клипборда (Ctrl+V).");
  setFile(file);
});

$("#btn-settings").addEventListener("click", () => {
  loadKeys();
  settingsDialog.showModal();
});

$("#btn-settings-cancel").addEventListener("click", () => settingsDialog.close());

settingsForm.addEventListener("submit", (e) => {
  e.preventDefault();
  keys.aiornot = $("#input-aiornot").value.trim();
  keys.gemini = $("#input-gemini").value.trim();
  saveKeys();
  settingsDialog.close();
  showToast("Ключовете са запазени");
});

function getTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* ignore */
  }
  const btn = $("#btn-theme");
  if (btn) {
    btn.setAttribute("aria-label", next === "dark" ? "Светла тема" : "Тъмна тема");
    btn.title = next === "dark" ? "Светла тема" : "Тъмна тема";
  }
}

function initTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") {
      applyTheme(saved);
      return;
    }
  } catch {
    /* ignore */
  }
  if (document.documentElement.getAttribute("data-theme") !== "dark") {
    applyTheme("light");
  }
}

function toggleTheme() {
  applyTheme(getTheme() === "dark" ? "light" : "dark");
}

$("#btn-theme")?.addEventListener("click", toggleTheme);
$("#btn-theme-auth")?.addEventListener("click", toggleTheme);

function boot() {
  try {
    initTheme();
    updateStep(1);
    initAuth().then(() => loadKeys());
  } catch (err) {
    console.error("Стартиране:", err);
    showApp();
  }
}

boot();

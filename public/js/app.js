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

const summaryBanner = $("#summary-banner");
const summaryAon = $("#summary-aon");
const summaryGem = $("#summary-gem");
const summaryMatch = $("#summary-match");
const loadingPanel = $("#loading-panel");
const resultsGrid = $("#results-grid");
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
let previewObjectUrl = null;

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
    throw new Error(
      preview.startsWith("<")
        ? "Сървърът върна грешка (HTML). Проверете Vercel deployment и API маршрутите."
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

async function initAuth() {
  try {
    const res = await fetch(`${apiBase()}/api/auth-status`, fetchOpts());
    const data = await safeJson(res);
    if (!data.required || data.authenticated) {
      showApp();
      return;
    }
    showAuthGate();
  } catch {
    showApp();
  }
}

authForm.addEventListener("submit", async (e) => {
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

function compareVerdicts(a, b) {
  if (a.verdict === "error" || b.verdict === "error") {
    return { type: "partial", text: "⚠ Един източник не отговори" };
  }
  if (a.verdict === b.verdict) {
    return { type: "agree", text: "✓ Вердиктите съвпадат" };
  }
  if (a.verdict === "uncertain" || b.verdict === "uncertain") {
    return { type: "partial", text: "⚠ Частично съвпадение" };
  }
  return { type: "disagree", text: "⚠ Различни вердикти" };
}

function updateSummaryBanner(aiornot, gemini) {
  const a = cardSnapshot(aiornot);
  const g = cardSnapshot(gemini);

  summaryAon.textContent = a.pct != null ? `${a.label} (${a.pct}%)` : a.label;
  summaryGem.textContent = g.pct != null ? `${g.label} (${g.pct}%)` : g.label;

  const match = compareVerdicts(a, g);
  summaryMatch.textContent = match.text;
  summaryMatch.className = `summary-match ${match.type}`;
  summaryMatch.classList.remove("hidden");
  summaryBanner.classList.remove("hidden");
}

function showLoading() {
  summaryBanner.classList.add("hidden");
  resultsGrid.classList.add("hidden");
  exportActions.classList.add("hidden");
  loadingPanel.classList.remove("hidden");
}

function hideLoading() {
  loadingPanel.classList.add("hidden");
  resultsGrid.classList.remove("hidden");
  exportActions.classList.remove("hidden");
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

function setFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    log("Моля, изберете файл с изображение.", "error");
    showToast("Само файлове с изображения");
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
  previewImg.removeAttribute("src");
  previewWrap.classList.add("hidden");
  dropzoneEmpty.classList.remove("hidden");
  resultsPanel.classList.add("hidden");
  layout.classList.remove("has-results");
  summaryBanner.classList.add("hidden");
  mobileBar.classList.add("hidden");
  fileInput.value = "";
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
  if (!lastResult) return "";
  const { aiornot, gemini, fileName, at } = lastResult;
  const a = cardSnapshot(aiornot);
  const g = cardSnapshot(gemini);
  const match = compareVerdicts(a, g);

  let text = `ОТЧЕТ — ИИ инструмент (factcheck.bg)\n`;
  text += `Дата: ${at}\n`;
  text += `Файл: ${fileName}\n`;
  text += `${match.text}\n\n`;
  text += `--- AI or Not ---\n`;
  if (aiornot?.ok) {
    text += `Вердикт: ${verdictLabel(aiornot.verdict)} (${Math.max(aiornot.aiPercent, aiornot.humanPercent)}%)\n`;
    text += `ИИ: ${aiornot.aiPercent}% | Човек: ${aiornot.humanPercent}%\n`;
    text += `${aiornot.summary || ""}\n`;
    if (aiornot.generators?.length) {
      text += `Генератори: ${aiornot.generators.map((x) => `${x.name} ${x.confidence}%`).join(", ")}\n`;
    }
  } else {
    text += `Грешка: ${aiornot?.error || "—"}\n`;
  }
  text += `\n--- Google Gemini ---\n`;
  if (gemini?.ok) {
    text += `Вердикт: ${verdictLabel(gemini.verdict)} (${gemini.confidencePercent ?? Math.max(gemini.aiPercent, gemini.humanPercent)}%)\n`;
    text += `ИИ: ${gemini.aiPercent}% | Човек: ${gemini.humanPercent}%\n`;
    text += `${gemini.summary || ""}\n`;
  } else {
    text += `Грешка: ${gemini?.error || "—"}\n`;
  }
  return text;
}

function buildPrintHtml() {
  if (!lastResult) return "";
  const { aiornot, gemini, fileName, at, previewSrc } = lastResult;
  const a = cardSnapshot(aiornot);
  const g = cardSnapshot(gemini);
  const match = compareVerdicts(a, g);

  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  return `
    <h1>ИИ инструмент — factcheck.bg</h1>
    <p class="meta">${esc(at)} · ${esc(fileName)} · ${esc(match.text)}</p>
    ${previewSrc ? `<img src="${previewSrc}" alt="Анализирано изображение" />` : ""}
    <section>
      <h2>AI or Not — ${esc(a.label)}${a.pct != null ? ` (${a.pct}%)` : ""}</h2>
      <pre>${esc(aiornot?.ok ? aiornot.summary : aiornot?.error || "—")}</pre>
    </section>
    <section>
      <h2>Google Gemini — ${esc(g.label)}${g.pct != null ? ` (${g.pct}%)` : ""}</h2>
      <pre>${esc(gemini?.ok ? gemini.summary : gemini?.error || "—")}</pre>
    </section>
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
  log("Анализира се с AI or Not и Gemini...");
  resultsPanel.classList.remove("hidden");
  layout.classList.add("has-results");
  showLoading();

  const form = new FormData();
  form.append("image", selectedFile);
  if (keys.aiornot) form.append("aiornot_key", keys.aiornot);
  if (keys.gemini) form.append("gemini_key", keys.gemini);

  try {
    const res = await fetch(`${apiBase()}/api/analyze`, fetchOpts({
      method: "POST",
      body: form,
    }));

    const data = await safeJson(res);
    if (res.status === 401 && data.code === "auth_required") {
      showAuthGate();
      log("Нужен е вход с парола.", "error");
      hideLoading();
      return;
    }

    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    hideLoading();
    updateCard("aon", data.aiornot);
    updateCard("gem", data.gemini);
    updateSummaryBanner(data.aiornot, data.gemini);

    lastResult = {
      aiornot: data.aiornot,
      gemini: data.gemini,
      fileName: selectedFile.name,
      at: new Date().toLocaleString("bg-BG"),
      previewSrc: previewImg.src,
    };

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

    log("Готово.");
  } catch (err) {
    hideLoading();
    log(err.message || "Анализът не успя", "error");
    showToast("Анализът не успя");
  }
}

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

initTheme();
initAuth().then(() => loadKeys());

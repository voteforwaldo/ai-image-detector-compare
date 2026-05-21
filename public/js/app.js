const STORAGE_KEYS = "aidetector_keys";

const $ = (sel) => document.querySelector(sel);

const dropzone = $("#dropzone");
const fileInput = $("#file-input");
const previewWrap = $("#preview-wrap");
const previewImg = $("#preview-img");
const dropzoneEmpty = $("#dropzone-empty");
const terminal = $("#terminal");
const resultsPanel = $("#results-panel");
const layout = $(".layout");
const btnUpload = $("#btn-upload");
const btnClear = $("#btn-clear");
const btnAnalyze = $("#btn-analyze");
const settingsDialog = $("#settings-dialog");
const settingsForm = $("#settings-form");

const VERDICT_LABELS = {
  ai: "ИИ",
  human: "Човек",
  uncertain: "Неясно",
};

let selectedFile = null;
let keys = { aiornot: "", gemini: "" };

function apiBase() {
  const meta = document.querySelector('meta[name="api-base"]');
  if (meta?.content) return meta.content.replace(/\/$/, "");
  return "";
}

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

function setFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    log("Моля, изберете файл с изображение.", "error");
    return;
  }
  selectedFile = file;
  const url = URL.createObjectURL(file);
  previewImg.src = url;
  previewWrap.classList.remove("hidden");
  dropzoneEmpty.classList.add("hidden");
  btnAnalyze.classList.remove("hidden");
  btnAnalyze.disabled = false;
  log(`Заредено: ${file.name} (${(file.size / 1024).toFixed(1)} КБ)`);
  runAnalysis();
}

function clearFile() {
  selectedFile = null;
  previewImg.removeAttribute("src");
  previewWrap.classList.add("hidden");
  dropzoneEmpty.classList.remove("hidden");
  btnAnalyze.classList.add("hidden");
  resultsPanel.classList.add("hidden");
  layout.classList.remove("has-results");
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
    return;
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

async function runAnalysis() {
  if (!selectedFile) return;

  loadKeys();
  clearTerminal();
  log("Качване към AI or Not и Gemini паралелно...");
  resultsPanel.classList.remove("hidden");
  layout.classList.add("has-results");
  btnAnalyze.disabled = true;

  const form = new FormData();
  form.append("image", selectedFile);
  if (keys.aiornot) form.append("aiornot_key", keys.aiornot);
  if (keys.gemini) form.append("gemini_key", keys.gemini);

  try {
    const res = await fetch(`${apiBase()}/api/analyze`, {
      method: "POST",
      body: form,
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    updateCard("aon", data.aiornot);
    updateCard("gem", data.gemini);

    if (data.aiornot?.ok) {
      updateAiornotGenerators(data.aiornot.generators);
      log(
        `AI or Not: ${verdictLabel(data.aiornot.verdict)} (${data.aiornot.aiPercent}% ИИ)`
      );
    } else {
      log(`AI or Not — грешка: ${data.aiornot?.error}`, "error");
    }

    if (data.gemini?.ok) {
      log(
        `Gemini: ${verdictLabel(data.gemini.verdict)} (${data.gemini.confidencePercent ?? data.gemini.aiPercent}% сигурност)`
      );
    } else {
      log(`Gemini — грешка: ${data.gemini?.error}`, "error");
    }

    log("Анализът приключи.");
  } catch (err) {
    log(err.message || "Анализът не успя", "error");
  } finally {
    btnAnalyze.disabled = false;
  }
}

btnUpload.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) setFile(fileInput.files[0]);
});
btnClear.addEventListener("click", clearFile);
btnAnalyze.addEventListener("click", runAnalysis);

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
  log("API ключовете са запазени за тази сесия.");
});

loadKeys();

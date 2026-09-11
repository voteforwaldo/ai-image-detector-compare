/** Shared Gemini monthly budget tracker (Node ESM, no deps). */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SEARCH_FLAT_USD = 0.035;

const MODEL_RATES = {
  "gemini-2.5-flash-lite": [0.1, 0.4],
  "gemini-3.1-flash-lite": [0.1, 0.4],
  "gemini-2.5-flash": [0.3, 2.5],
  "gemini-2.5-pro": [1.25, 10.0],
  "gemini-3.5-flash": [0.5, 3.0],
};

const BUDGET_SAFE_MODELS = new Set(["gemini-2.5-flash-lite"]);

export function budgetFile() {
  const raw = (process.env.GEMINI_BUDGET_FILE || "").trim();
  if (raw) return path.resolve(raw.replace(/^~(?=$|[\\/])/, os.homedir()));
  return path.join(os.homedir(), ".gemini-budget", "usage.json");
}

export function monthlyBudgetUsd() {
  const n = Number.parseFloat(process.env.GEMINI_MONTHLY_BUDGET_USD || "5");
  return Number.isFinite(n) && n > 0 ? n : 5;
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function resolveRates(model) {
  if (MODEL_RATES[model]) return MODEL_RATES[model];
  if (model.includes("3.5") || model.includes("3.1") || model.includes("3-pro")) {
    return MODEL_RATES["gemini-3.5-flash"];
  }
  if (model.includes("2.5-pro")) return MODEL_RATES["gemini-2.5-pro"];
  if (model.includes("2.5-flash")) return MODEL_RATES["gemini-2.5-flash"];
  return MODEL_RATES["gemini-2.5-flash-lite"];
}

export function computeUsdCost(model, inputTokens, outputTokens, webSearch = false) {
  const [inRate, outRate] = resolveRates(model);
  let total = (inputTokens / 1_000_000) * inRate + (outputTokens / 1_000_000) * outRate;
  if (webSearch) total += SEARCH_FLAT_USD;
  return total;
}

export function estimateInputTokens(...texts) {
  const chars = texts.reduce((n, t) => n + (t || "").length, 0);
  return Math.max(80, Math.ceil(chars / 4) + 80);
}

export function isModelAllowed(model) {
  if (monthlyBudgetUsd() > 10) return true;
  return BUDGET_SAFE_MODELS.has(model);
}

export function searchAllowed() {
  const status = getStatus();
  return status.remainingUsd >= SEARCH_FLAT_USD;
}

function emptyState() {
  return {
    month: currentMonth(),
    budgetUsd: monthlyBudgetUsd(),
    spentUsd: 0,
    calls: 0,
    byProject: {},
  };
}

function readStateUnlocked() {
  try {
    const data = JSON.parse(fs.readFileSync(budgetFile(), "utf8"));
    if (data.month !== currentMonth()) return emptyState();
    return {
      month: data.month,
      budgetUsd: monthlyBudgetUsd(),
      spentUsd: Number.isFinite(data.spentUsd) ? data.spentUsd : 0,
      calls: Number.isFinite(data.calls) ? data.calls : 0,
      byProject: data.byProject || {},
    };
  } catch {
    return emptyState();
  }
}

function writeStateUnlocked(state) {
  const file = budgetFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  state.month = currentMonth();
  state.budgetUsd = monthlyBudgetUsd();
  fs.writeFileSync(file, JSON.stringify(state, null, 2), "utf8");
}

function withLock(fn) {
  const lockPath = `${budgetFile()}.lock`;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
      try {
        return fn();
      } finally {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
      }
    } catch {
      const spin = Date.now() + 15;
      while (Date.now() < spin) {
        /* busy wait */
      }
    }
  }
  throw new Error("Gemini budget lock timeout");
}

export function getStatus() {
  return withLock(() => {
    const state = readStateUnlocked();
    const remainingUsd = Math.max(0, state.budgetUsd - state.spentUsd);
    return {
      month: state.month,
      budgetUsd: state.budgetUsd,
      spentUsd: Math.round(state.spentUsd * 10_000) / 10_000,
      remainingUsd: Math.round(remainingUsd * 10_000) / 10_000,
      calls: state.calls,
      exhausted: remainingUsd < 0.001,
      byProject: { ...state.byProject },
    };
  });
}

export function assertBudget(project, model, inputTokens, outputTokens, webSearch = false) {
  if (webSearch && !searchAllowed()) {
    const status = getStatus();
    throw new Error(
      `Google Search grounding disabled — insufficient Gemini budget remaining ` +
        `(need ~$${SEARCH_FLAT_USD.toFixed(3)}, have ~$${status.remainingUsd.toFixed(3)}).`,
    );
  }
  const useModel = isModelAllowed(model) ? model : "gemini-2.5-flash-lite";
  const estimate = computeUsdCost(useModel, inputTokens, outputTokens, webSearch);
  withLock(() => {
    const state = readStateUnlocked();
    if (state.spentUsd + estimate > state.budgetUsd) {
      const remaining = Math.max(0, state.budgetUsd - state.spentUsd);
      throw new Error(
        `Gemini monthly budget reached ($${state.budgetUsd.toFixed(2)}/month, ` +
          `~$${remaining.toFixed(3)} left). Resets on the 1st.`,
      );
    }
  });
}

export function recordSpend(project, model, inputTokens, outputTokens, webSearch = false) {
  const usd = computeUsdCost(model, inputTokens, outputTokens, webSearch);
  withLock(() => {
    const state = readStateUnlocked();
    state.spentUsd += usd;
    state.calls += 1;
    state.byProject[project] = Math.round(((state.byProject[project] || 0) + usd) * 1_000_000) / 1_000_000;
    writeStateUnlocked(state);
  });
  return usd;
}

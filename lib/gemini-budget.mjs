import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PROJECT = "ai-image-detector-compare";
const DEFAULT_MONTHLY_USD = "1";

function isolateProjectBudget() {
  if (!String(process.env.GEMINI_MONTHLY_BUDGET_USD || "").trim()) {
    process.env.GEMINI_MONTHLY_BUDGET_USD = DEFAULT_MONTHLY_USD;
  }
  if (!String(process.env.GEMINI_BUDGET_FILE || "").trim()) {
    const dir = process.env.VERCEL
      ? os.tmpdir()
      : path.join(os.homedir(), ".gemini-budget");
    process.env.GEMINI_BUDGET_FILE = path.join(dir, "ai-image-detector-compare.json");
  }
}

isolateProjectBudget();

function isBudgetStoreError(err) {
  const msg = err?.message || String(err || "");
  return /lock timeout|EPERM|EROFS|ENOENT|EACCES|ENOTDIR|EROFS/i.test(msg);
}

async function loadBudgetModule() {
  const homePath = path.join(os.homedir(), ".gemini-budget", "budget.mjs");
  if (fs.existsSync(homePath)) {
    try {
      return await import(pathToFileURL(homePath).href);
    } catch (err) {
      console.warn("Shared gemini-budget unavailable, using bundled copy:", err?.message || err);
    }
  }
  return import("./gemini-budget-core.mjs");
}

const shared = await loadBudgetModule();

/** Per-instance spend tracker for Vercel (shared /tmp budget is not reliable across lambdas). */
let memorySpentUsd = 0;

function memoryBudgetCap() {
  const n = Number.parseFloat(process.env.GEMINI_MONTHLY_BUDGET_USD || DEFAULT_MONTHLY_USD);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export const assertBudget = (model, inputTokens, outputTokens, webSearch = false) => {
  if (process.env.VERCEL && memorySpentUsd >= memoryBudgetCap()) {
    throw new Error(
      `Gemini бюджетът за този процес е изчерпан (~$${memoryBudgetCap().toFixed(2)}). Изчакайте или увеличете GEMINI_MONTHLY_BUDGET_USD.`
    );
  }
  try {
    return shared.assertBudget(PROJECT, model, inputTokens, outputTokens, webSearch);
  } catch (err) {
    if (isBudgetStoreError(err)) {
      console.warn("Gemini budget store unavailable, using memory guard:", err?.message || err);
      return;
    }
    throw err;
  }
};

export const recordSpend = (model, inputTokens, outputTokens, webSearch = false) => {
  try {
    const cost = shared.recordSpend(PROJECT, model, inputTokens, outputTokens, webSearch);
    const n = Number(cost);
    if (Number.isFinite(n) && n > 0) memorySpentUsd += n;
    return cost;
  } catch (err) {
    if (isBudgetStoreError(err)) {
      // Approximate cost so memory guard still works when file store fails.
      try {
        const approx = shared.computeUsdCost?.(model, inputTokens, outputTokens, webSearch);
        if (Number.isFinite(approx) && approx > 0) memorySpentUsd += approx;
      } catch {
        memorySpentUsd += 0.002;
      }
      console.warn("Gemini spend not recorded to disk:", err?.message || err);
      return 0;
    }
    throw err;
  }
};

export const getStatus = shared.getStatus;
export const estimateInputTokens = shared.estimateInputTokens;
export const isModelAllowed = shared.isModelAllowed;

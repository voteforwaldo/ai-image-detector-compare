import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PROJECT = "ai-image-detector-compare";

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

export const assertBudget = (model, inputTokens, outputTokens, webSearch = false) =>
  shared.assertBudget(PROJECT, model, inputTokens, outputTokens, webSearch);

export const recordSpend = (model, inputTokens, outputTokens, webSearch = false) =>
  shared.recordSpend(PROJECT, model, inputTokens, outputTokens, webSearch);

export const getStatus = shared.getStatus;
export const estimateInputTokens = shared.estimateInputTokens;
export const isModelAllowed = shared.isModelAllowed;

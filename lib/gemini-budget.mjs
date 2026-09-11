import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PROJECT = "ai-image-detector-compare";

const sharedUrl = pathToFileURL(path.join(os.homedir(), ".gemini-budget", "budget.mjs")).href;
const shared = await import(sharedUrl);

export const assertBudget = (model, inputTokens, outputTokens, webSearch = false) =>
  shared.assertBudget(PROJECT, model, inputTokens, outputTokens, webSearch);

export const recordSpend = (model, inputTokens, outputTokens, webSearch = false) =>
  shared.recordSpend(PROJECT, model, inputTokens, outputTokens, webSearch);

export const getStatus = shared.getStatus;
export const estimateInputTokens = shared.estimateInputTokens;
export const isModelAllowed = shared.isModelAllowed;

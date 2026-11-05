// LLM module exports

// Default model from env
export { model, modelName } from "./client.js";

// Dynamic model creation
export {
  createModel,
  createModelFromProvider,
  createGroqModel,
  createGeminiModel,
  createAutoModel,
  PROVIDERS,
  type ModelConfig,
  type ProviderName,
} from "./client.js";

// Generation functions
export { generate, generateArray, generatePlainText, type GenerateOptions } from "./generate.js";

// Retry utilities
export { withRetry, sleep, type RetryOptions } from "./retry.js";

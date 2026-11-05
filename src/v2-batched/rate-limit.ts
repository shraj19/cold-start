// Rate limiting with API key AND model rotation

import { env } from "../env.js";

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Model configuration with quota info
 */
export interface ModelConfig {
  name: string;
  rpm: number;  // requests per minute limit
  rpd: number;  // requests per day limit
}

// Models with available quota (from your rate limit dashboard)
// Prioritize models with higher limits
export const AVAILABLE_MODELS: ModelConfig[] = [
  { name: "gemini-3.1-flash-lite", rpm: 15, rpd: 500 },  // Best limits
  { name: "gemini-2.5-flash", rpm: 5, rpd: 20 },
  { name: "gemini-3-flash", rpm: 5, rpd: 20 },
  { name: "gemini-3.8-flash", rpm: 5, rpd: 20 },
  { name: "gemini-3.6-flash", rpm: 5, rpd: 20 },  // Original, may be exhausted
];

/**
 * Rate limiter with API key AND model rotation
 * 
 * Rotates through multiple API keys and models to maximize throughput
 * while staying under rate limits.
 */
export class RateLimiter {
  private apiKeys: string[];
  private models: ModelConfig[];
  private currentKeyIndex = 0;
  private currentModelIndex = 0;
  private lastRequestTime = 0;
  private minDelayMs: number;
  private requestCount = 0;
  
  constructor(options: {
    apiKeys?: string[];
    models?: ModelConfig[];
    requestsPerMinute?: number;
  } = {}) {
    // Collect all available API keys
    this.apiKeys = options.apiKeys || this.collectApiKeys();
    this.models = options.models || AVAILABLE_MODELS;
    
    // Calculate delay between requests
    // With multiple models, we can go faster
    const rpm = options.requestsPerMinute || 6;
    this.minDelayMs = Math.ceil((60 * 1000) / rpm);
    
    console.error(`RateLimiter initialized:`);
    console.error(`  API keys: ${this.apiKeys.length}`);
    console.error(`  Models: ${this.models.map(m => m.name).join(", ")}`);
    console.error(`  Target RPM: ${rpm}`);
    console.error(`  Min delay: ${this.minDelayMs}ms`);
  }
  
  /**
   * Collect API keys from environment
   */
  private collectApiKeys(): string[] {
    const keys: string[] = [];
    
    // Primary key
    if (env.LLM_API_KEY) {
      keys.push(env.LLM_API_KEY);
    }
    
    // Check for spare keys in process.env (not validated by env.ts)
    const spareKeys = [
      process.env["GEMINI_API_KEY_SPARE1"],
      process.env["GEMINI_API_KEY_SPARE2"],
    ].filter((k): k is string => !!k && k.length > 0);
    
    keys.push(...spareKeys);
    
    if (keys.length === 0) {
      throw new Error("No API keys found");
    }
    
    return keys;
  }
  
  /**
   * Get the next API key and model with rate limiting
   * 
   * - Waits if needed to respect rate limits
   * - Rotates MODELS first, then keys (spreads load across models better)
   */
  async getNext(): Promise<{ apiKey: string; model: string }> {
    // Wait if we're going too fast
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    
    if (elapsed < this.minDelayMs && this.lastRequestTime > 0) {
      const waitTime = this.minDelayMs - elapsed;
      console.error(`  Rate limit: waiting ${waitTime}ms...`);
      await sleep(waitTime);
    }
    
    // Get current key and model
    const apiKey = this.apiKeys[this.currentKeyIndex]!;
    const model = this.models[this.currentModelIndex]!.name;
    
    // Rotate: MODELS first, then keys
    // This spreads requests across different models to avoid per-model RPM limits
    this.currentModelIndex = (this.currentModelIndex + 1) % this.models.length;
    if (this.currentModelIndex === 0) {
      // Wrapped around models, move to next key
      this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
    }
    
    this.lastRequestTime = Date.now();
    this.requestCount++;
    
    return { apiKey, model };
  }
  
  /**
   * Get the next API key (legacy method for compatibility)
   */
  async getNextKey(): Promise<string> {
    const { apiKey } = await this.getNext();
    return apiKey;
  }
  
  /**
   * Get current model name
   */
  getCurrentModel(): string {
    return this.models[this.currentModelIndex]!.name;
  }
  
  /**
   * Get current key index (for logging)
   */
  getCurrentKeyIndex(): number {
    return this.currentKeyIndex;
  }
  
  /**
   * Get total request count
   */
  getRequestCount(): number {
    return this.requestCount;
  }
  
  /**
   * Get estimated time remaining for N more requests
   */
  estimateTimeRemaining(remainingRequests: number): number {
    return remainingRequests * this.minDelayMs;
  }
}

/**
 * Format milliseconds as human-readable time
 */
export function formatTime(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

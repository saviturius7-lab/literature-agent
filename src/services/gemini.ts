import { GoogleGenAI } from "@google/genai";
import { generateDeepSeekJSON, getDeepSeekStatus as getDSStatus } from "./deepseek";

// Helper to collect keys from import.meta.env
function collectKeys(): string[] {
  const collected: string[] = [];
  
  // 1. Check for the bulk VITE_GEMINI_KEYS provided by vite.config.ts
  // This is the primary source of keys, including those from AI Studio Secrets
  const bulkKeys = (import.meta as any).env.VITE_GEMINI_KEYS;
  if (bulkKeys) {
    if (Array.isArray(bulkKeys)) {
      collected.push(...bulkKeys.filter(k => typeof k === 'string' && k.trim()));
    } else if (typeof bulkKeys === 'string') {
      try {
        const parsed = JSON.parse(bulkKeys);
        if (Array.isArray(parsed)) {
          collected.push(...parsed.filter(k => typeof k === 'string' && k.trim()));
        } else {
          collected.push(bulkKeys.trim());
        }
      } catch (e) {
        const split = bulkKeys.split(',').map(k => k.trim()).filter(k => k);
        collected.push(...split);
      }
    }
  }

  // 2. Fallback to individual keys if they exist in the browser environment
  // Note: Vite only supports static access like import.meta.env.VITE_GEMINI_API_KEY
  const primaryKey = (import.meta as any).env.VITE_GEMINI_API_KEY;
  if (primaryKey && primaryKey.trim()) {
    collected.push(primaryKey.trim());
  }
  
  // 3. Check for the bulk VITE_GEMINI_API_KEYS (common alias)
  const apiBulkKeys = (import.meta as any).env.VITE_GEMINI_API_KEYS;
  if (apiBulkKeys) {
    if (Array.isArray(apiBulkKeys)) {
      collected.push(...apiBulkKeys.filter(k => typeof k === 'string' && k.trim()));
    } else if (typeof apiBulkKeys === 'string') {
      try {
        const parsed = JSON.parse(apiBulkKeys);
        if (Array.isArray(parsed)) {
          collected.push(...parsed.filter(k => typeof k === 'string' && k.trim()));
        } else {
          collected.push(apiBulkKeys.trim());
        }
      } catch (e) {
        const split = apiBulkKeys.split(',').map(k => k.trim()).filter(k => k);
        collected.push(...split);
      }
    }
  }

  // Final fallback: check for process.env.GEMINI_API_KEY (might be available if defined in vite.config.ts)
  try {
    const procKey = (process as any).env.GEMINI_API_KEY;
    if (procKey && procKey.trim()) {
      collected.push(procKey.trim());
    }
  } catch (e) { /* ignore */ }

  const uniqueKeys = Array.from(new Set(collected)).filter(k => {
    if (!k || typeof k !== 'string' || k.length < 10) return false;
    const upper = k.toUpperCase();
    if (upper.includes("TODO")) return false;
    if (upper.includes("YOUR_API_KEY")) return false;
    if (upper.includes("MY_GEMINI_KEY")) return false;
    if (upper.includes("GEMINI_API_KEY")) return false;
    if (upper.includes("INSERT_KEY")) return false;
    if (upper.includes("REPLACE_WITH")) return false;
    return true;
  });
  console.log(`[Gemini] Collected ${uniqueKeys.length} unique API keys for rotation.`);
  if (uniqueKeys.length > 0) {
    console.log(`[Gemini] Key prefixes: ${uniqueKeys.map(k => k.slice(0, 6)).join(', ')}`);
  } else {
    console.warn(`[Gemini] NO API KEYS COLLECTED! Please check your environment variables or secrets.`);
  }
  return uniqueKeys;
}

const allGeminiKeys = collectKeys();
let totalRetries = 0;

// Track failed keys to avoid them in the same session
const failedKeys = new Set<string>();

// Track rate-limited keys and when they can be used again
const keyCooldowns = new Map<string, number>();

export function getGeminiStatus() {
  const now = Date.now();
  const total = allGeminiKeys.length;
  const failed = failedKeys.size;
  const cooldowns = Array.from(keyCooldowns.values());
  const coolingDown = cooldowns.filter(t => t > now).length;
  const hardQuota = cooldowns.filter(t => t > now + (2 * 60 * 1000)).length;
  const available = total - failed - coolingDown;
  
  return { total, failed, coolingDown, hardQuota, available, totalRetries };
}

// Simple semaphore to limit concurrent calls
class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;
  constructor(private max: number) {}

  async acquire() {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    return new Promise<void>(resolve => this.queue.push(resolve));
  }

  release() {
    this.active--;
    if (this.queue.length > 0) {
      this.active++;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

// Limit concurrent calls to a reasonable number to avoid overwhelming the API
// and triggering "Quota Exceeded" errors due to bursts.
const MAX_CONCURRENCY = 4;
const geminiSemaphore = new Semaphore(MAX_CONCURRENCY);

// Track keys currently performing a request to ensure even distribution
const keysInUse = new Map<string, number>();

// Track last used time for each key
const keyLastUsed = new Map<string, number>();
// Track consecutive failures for circuit breaker
const keyFailureCounts = new Map<string, number>();
const MAX_CONSECUTIVE_FAILURES = 5;

// Export reset function for the UI
export function resetGeminiStatus() {
  failedKeys.clear();
  keyCooldowns.clear();
  keyFailureCounts.clear();
  keysInUse.clear();
  totalRetries = 0;
  console.log("[Gemini] API status and rotation state reset.");
}

async function withRetry<T>(fn: (ai: GoogleGenAI) => Promise<T>, retries = 50): Promise<T> {
  let lastError: any;
  
  for (let i = 0; i < retries; i++) {
    await geminiSemaphore.acquire();
    
    let apiKey: string | undefined;
    let released = false;

    try {
      const now = Date.now();
      
      // 1. Find available keys (not failed, not cooling down, and NOT currently in use)
      const availableKeys = allGeminiKeys.filter(k => {
        if (failedKeys.has(k)) return false;
        // keysInUse is now a Map, but we still want to filter out keys that are "too busy"
        // For now, let's allow up to 2 concurrent requests per key if we have to, 
        // but prefer keys with 0 active requests.
        const inUseCount = keysInUse.get(k) || 0;
        if (inUseCount >= 2) return false; 
        const cooldownUntil = keyCooldowns.get(k) || 0;
        return now >= cooldownUntil;
      });

      if (availableKeys.length === 0) {
        if (allGeminiKeys.length === 0) {
          throw new Error("No Gemini API keys found. Please add VITE_GEMINI_API_KEY to your environment variables or secrets.");
        }
        
        // If all keys are busy or on cooldown, find the one that will be available soonest
        const sortedKeys = allGeminiKeys
          .filter(k => !failedKeys.has(k))
          .sort((a, b) => {
            // Priority: fewer active requests
            const aInUse = keysInUse.get(a) || 0;
            const bInUse = keysInUse.get(b) || 0;
            if (aInUse !== bInUse) return aInUse - bInUse;
            
            return (keyCooldowns.get(a) || 0) - (keyCooldowns.get(b) || 0);
          });
        
        if (sortedKeys.length === 0) {
          throw new Error("All Gemini API keys have failed. Please check your keys in Settings -> Secrets and try again.");
        }
        
        apiKey = sortedKeys[0];
        const cooldownUntil = keyCooldowns.get(apiKey) || 0;
        const waitTime = Math.max(0, cooldownUntil - now);
        
        // If the best key is on a very long cooldown (hard quota), and it's the best we have,
        // we might as well tell the user now instead of making them wait 5+ minutes.
        if (waitTime > 4.5 * 60 * 1000) {
          throw new Error("All available Gemini API keys have reached their hard quota (billing/plan limits). Please wait for the 5-minute cooldown or add more API keys in Settings -> Secrets (VITE_GEMINI_API_KEY_1, _2, etc.).");
        }
        
        // If the best key is still very busy or on a moderate cooldown, wait a bit
        const activeCount = keysInUse.get(apiKey) || 0;
        if (activeCount >= 2 || waitTime > 500) {
          console.log(`[Gemini] All keys busy or on cooldown. Waiting for key ${apiKey.slice(0, 6)}...`);
          geminiSemaphore.release();
          released = true;
          await new Promise(resolve => setTimeout(resolve, Math.min(waitTime + 500, 2000)));
          continue;
        }
      } else {
        // Sophisticated rotation: use the key that hasn't been used for the longest time
        const sortedAvailable = availableKeys.sort((a, b) => (keyLastUsed.get(a) || 0) - (keyLastUsed.get(b) || 0));
        apiKey = sortedAvailable[0];
      }

      keysInUse.set(apiKey, (keysInUse.get(apiKey) || 0) + 1);
      keyLastUsed.set(apiKey, Date.now());
      console.log(`[Gemini] Using key ${apiKey.slice(0, 6)}... (Active on key: ${keysInUse.get(apiKey)})`);
      const ai = new GoogleGenAI({ apiKey });
      
      try {
        const result = await fn(ai);
        // Success: reset failure count for this key
        keyFailureCounts.set(apiKey, 0);
        return result;
      } catch (error: any) {
        totalRetries++;
        lastError = error;
        let message = error.message || "";
        let status = error.status || 0;
        
        if (message.startsWith("{") && message.endsWith("}")) {
          try {
            const parsed = JSON.parse(message);
            if (parsed.error && parsed.error.code) {
              status = parsed.error.code;
              message = parsed.error.message || message;
            }
          } catch (e) { /* ignore */ }
        }
        
        const isRateLimit = status === 429 || message.includes("429") || message.includes("RESOURCE_EXHAUSTED") || message.toLowerCase().includes("quota") || message.toLowerCase().includes("rate limit");
        const isAuthError = status === 401 || message.includes("401") || message.includes("API_KEY_INVALID") || message.toLowerCase().includes("invalid api key");
        const isTransientError = [500, 502, 503, 504].includes(status) || message.includes("500") || message.includes("502") || message.includes("503") || message.includes("504") || message.toLowerCase().includes("internal error") || message.toLowerCase().includes("overloaded") || message.toLowerCase().includes("bad gateway");
        const isSafetyError = status === 400 && (message.toLowerCase().includes("safety") || message.toLowerCase().includes("blocked"));

        if (isAuthError) {
          console.error(`[Gemini] Key ${apiKey.slice(0, 6)}... is invalid or unauthorized. Removing from rotation.`);
          failedKeys.add(apiKey);
          keysInUse.set(apiKey, Math.max(0, (keysInUse.get(apiKey) || 0) - 1));
          geminiSemaphore.release();
          released = true;
          continue;
        }
        
        if (isRateLimit) {
          const isQuota = message.toLowerCase().includes("quota");
          const isHardQuota = message.toLowerCase().includes("billing") || 
                             message.toLowerCase().includes("plan") || 
                             message.toLowerCase().includes("daily limit") || 
                             message.toLowerCase().includes("budget") ||
                             message.toLowerCase().includes("current quota") ||
                             message.toLowerCase().includes("exceeded your current quota");
          
          if (isHardQuota) {
            // Use a 5-minute cooldown for hard quota
            const longCooldownMs = 5 * 60 * 1000; 
            keyCooldowns.set(apiKey, Date.now() + longCooldownMs);
            
            // Only log as error if we are running low on available keys
            const status = getGeminiStatus();
            if (status.available < 2) {
              console.error(`[Gemini] Key ${apiKey.slice(0, 6)}... reached hard quota (billing/plan). Cooling down for 5m. CRITICAL: Only ${status.available} keys left.`);
            } else {
              console.warn(`[Gemini] Key ${apiKey.slice(0, 6)}... reached hard quota. Cooling down. (${status.available} keys still available)`);
            }
          } else {
            const cooldownMs = isQuota ? 60000 : 15000; 
            keyCooldowns.set(apiKey, Date.now() + cooldownMs);
            console.warn(`[Gemini] Key ${apiKey.slice(0, 6)}... rate limited (${isQuota ? 'Quota' : 'Rate'}). Cooldown: ${cooldownMs/1000}s.`);
          }
          
          keysInUse.set(apiKey, Math.max(0, (keysInUse.get(apiKey) || 0) - 1));
          
          // Check if any other keys are available right now
          const otherKeysAvailable = allGeminiKeys.some(k => !failedKeys.has(k) && (keysInUse.get(k) || 0) === 0 && (keyCooldowns.get(k) || 0) <= Date.now());
          
          if (!otherKeysAvailable) {
            // All keys are rate limited or failed, apply a small backoff before trying again
            const backoff = Math.min(20000, 2000 * Math.pow(1.5, i));
            const jitter = Math.random() * 3000;
            console.log(`[Gemini] No other keys available. Backing off for ${Math.round(backoff + jitter)}ms...`);
            geminiSemaphore.release();
            released = true;
            await new Promise(resolve => setTimeout(resolve, backoff + jitter));
          } else {
            // Switch immediately!
            console.log(`[Gemini] Switching to another key immediately...`);
            geminiSemaphore.release();
            released = true;
          }
          continue;
        }

        if (isTransientError) {
          const failures = (keyFailureCounts.get(apiKey) || 0) + 1;
          keyFailureCounts.set(apiKey, failures);
          
          if (failures >= MAX_CONSECUTIVE_FAILURES) {
            console.error(`[Gemini] Key ${apiKey.slice(0, 6)}... failed ${failures} times consecutively. Marking as failed.`);
            failedKeys.add(apiKey);
          } else {
            keyCooldowns.set(apiKey, Date.now() + 5000);
          }
          
          keysInUse.set(apiKey, Math.max(0, (keysInUse.get(apiKey) || 0) - 1));
          const backoff = Math.min(30000, 1000 * Math.pow(2, i));
          const jitter = Math.random() * 1000;
          console.warn(`[Gemini] Transient error (${status}) with key ${apiKey.slice(0, 6)}...: ${message}. Retrying in ${Math.round(backoff + jitter)}ms...`);
          
          geminiSemaphore.release();
          released = true;
          await new Promise(resolve => setTimeout(resolve, backoff + jitter));
          continue;
        }

        if (isSafetyError) {
          console.error(`[Gemini] Request blocked by safety filters with key ${apiKey.slice(0, 6)}...: ${message}`);
          keysInUse.set(apiKey, Math.max(0, (keysInUse.get(apiKey) || 0) - 1));
          if (i >= 2) throw error; 
          geminiSemaphore.release();
          released = true;
          continue;
        }
        
        if (i < retries - 1) {
          keysInUse.set(apiKey, Math.max(0, (keysInUse.get(apiKey) || 0) - 1));
          const backoff = Math.min(30000, 1000 * Math.pow(2, i));
          const jitter = Math.random() * 1000;
          console.warn(`[Gemini] Other error (${status}) with key ${apiKey.slice(0, 6)}...: ${message}. Retrying in ${Math.round(backoff + jitter)}ms...`);
          
          geminiSemaphore.release();
          released = true;
          await new Promise(resolve => setTimeout(resolve, backoff + jitter));
          continue;
        }
        keysInUse.set(apiKey, Math.max(0, (keysInUse.get(apiKey) || 0) - 1));
        throw error;
      } finally {
        if (!released && apiKey) {
          keysInUse.set(apiKey, Math.max(0, (keysInUse.get(apiKey) || 0) - 1));
        }
      }
    } finally {
      if (!released) {
        geminiSemaphore.release();
      }
    }
  }
  
  throw lastError || new Error("Max retries reached");
}

export async function embedText(text: string): Promise<number[]> {
  const results = await embedTexts([text]);
  return results[0];
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  
  return withRetry(async (ai) => {
    const response = await ai.models.embedContent({
      model: 'gemini-embedding-2-preview',
      contents: texts,
    });
    return response.embeddings.map(e => e.values);
  });
}

function sanitizeJSON(text: string): string {
  // 1. Remove markdown code blocks
  let cleaned = text.replace(/```json\n?|```/g, "").trim();

  // 2. Fix common JSON issues from LLMs
  // LLMs often output single backslashes for LaTeX or paths which break JSON.parse
  // We want to escape backslashes that are NOT part of a valid JSON escape sequence
  // Valid JSON escapes: \", \\, \/, \b, \f, \n, \r, \t, \uXXXX
  
  let result = "";
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "\\") {
      const next = cleaned[i + 1];
      if (next === undefined) {
        result += "\\\\";
        continue;
      }
      
      // If it's a valid escape, keep it as is
      if (["\"", "\\", "/", "b", "f", "n", "r", "t"].includes(next)) {
        result += "\\";
        result += next;
        i++;
      } else if (next === "u") {
        // Check for \uXXXX
        const hexPart = cleaned.slice(i + 2, i + 6);
        if (hexPart.length === 4 && /[0-9a-fA-F]{4}/.test(hexPart)) {
          result += "\\u";
          result += hexPart;
          i += 5;
        } else {
          // Invalid unicode escape, escape the backslash
          result += "\\\\";
        }
      } else {
        // Not a valid JSON escape sequence (e.g. \theta), escape the backslash
        result += "\\\\";
      }
    } else {
      result += cleaned[i];
    }
  }
  
  return result;
}

export async function generateJSON<T>(prompt: string, systemInstruction?: string, model: string = "gemini-3-flash-preview"): Promise<T> {
  const geminiStatus = getGeminiStatus();
  const dsStatus = getDSStatus();

  // 1. Try DeepSeek first as preferred provider
  if (dsStatus.available > 0) {
    console.log("[LLM] Using DeepSeek (preferred)...");
    try {
      return await generateDeepSeekJSON<T>(prompt, systemInstruction);
    } catch (e) {
      console.error("[LLM] DeepSeek failed, falling back to Gemini:", e);
      // Continue to Gemini if DeepSeek fails
    }
  }

  // 2. Fallback to Gemini
  try {
    const text = await withRetry(async (ai) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { 
          systemInstruction,
          responseMimeType: "application/json"
        },
      });
      
      return response.text || "{}";
    });

    const cleaned = sanitizeJSON(text);
    
    try {
      return JSON.parse(cleaned) as T;
    } catch (e) {
      console.error("Failed to parse Gemini JSON response:", text);
      console.error("Cleaned version:", cleaned);
      throw new Error(`Invalid JSON response from Gemini: ${e instanceof Error ? e.message : String(e)}`);
    }
  } catch (error: any) {
    // If Pro model fails with rate limit, fallback to Flash automatically
    if (model.includes("pro") && (error.message.includes("429") || error.message.includes("RESOURCE_EXHAUSTED") || error.message.toLowerCase().includes("quota"))) {
      console.warn(`Pro model rate limited, falling back to Flash for JSON generation...`);
      return generateJSON<T>(prompt, systemInstruction, "gemini-3-flash-preview");
    }

    throw error;
  }
}

export async function generateText(prompt: string, systemInstruction?: string): Promise<string> {
  const geminiStatus = getGeminiStatus();
  const dsStatus = getDSStatus();

  // 1. Try DeepSeek first as preferred provider
  if (dsStatus.available > 0) {
    console.log("[LLM] Using DeepSeek (preferred)...");
    try {
      const result = await generateDeepSeekJSON<{ response: string }>(
        prompt + "\n\nReturn your response in a JSON object with a 'response' key.",
        systemInstruction
      );
      return result.response;
    } catch (e) {
      console.error("[LLM] DeepSeek text failed, falling back to Gemini:", e);
    }
  }

  // 2. Fallback to Gemini
  try {
    return await withRetry(async (ai) => {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: { systemInstruction },
      });
      return response.text || "";
    });
  } catch (error) {
    throw error;
  }
}

import { GoogleGenAI } from "@google/genai";

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

  const uniqueKeys = Array.from(new Set(collected)).filter(k => k && k.length > 10);
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
  const coolingDown = Array.from(keyCooldowns.values()).filter(t => t > now).length;
  const available = total - failed - coolingDown;
  
  return { total, failed, coolingDown, available, totalRetries };
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

// Limit concurrent calls based on the number of available keys to maximize throughput
// while ensuring we don't hit global concurrency limits.
const geminiSemaphore = new Semaphore(Math.max(4, allGeminiKeys.length));

// Track keys currently performing a request to ensure even distribution
const keysInUse = new Set<string>();

// Track last used time for each key
const keyLastUsed = new Map<string, number>();
// Track consecutive failures for circuit breaker
const keyFailureCounts = new Map<string, number>();
const MAX_CONSECUTIVE_FAILURES = 5;

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
        if (keysInUse.has(k)) return false; 
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
            // Priority: not in use > in use
            const aInUse = keysInUse.has(a) ? 1 : 0;
            const bInUse = keysInUse.has(b) ? 1 : 0;
            if (aInUse !== bInUse) return aInUse - bInUse;
            
            return (keyCooldowns.get(a) || 0) - (keyCooldowns.get(b) || 0);
          });
        
        if (sortedKeys.length === 0) {
          throw new Error("All Gemini API keys have failed. Please check your keys and try again.");
        }
        
        apiKey = sortedKeys[0];
        const cooldownUntil = keyCooldowns.get(apiKey) || 0;
        const waitTime = Math.max(0, cooldownUntil - now);
        
        // If the best key is still in use or on a long cooldown, wait a bit
        if (keysInUse.has(apiKey) || waitTime > 500) {
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

      keysInUse.add(apiKey);
      keyLastUsed.set(apiKey, Date.now());
      console.log(`[Gemini] Using key ${apiKey.slice(0, 6)}... (Active: ${keysInUse.size}/${allGeminiKeys.length})`);
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
        
        const isRateLimit = status === 429 || message.includes("429") || message.includes("RESOURCE_EXHAUSTED") || message.toLowerCase().includes("quota");
        const isAuthError = status === 401 || message.includes("401") || message.includes("API_KEY_INVALID");
        const isTransientError = [500, 503, 504].includes(status) || message.includes("500") || message.includes("503") || message.includes("504") || message.toLowerCase().includes("internal error") || message.toLowerCase().includes("overloaded");
        const isSafetyError = status === 400 && (message.toLowerCase().includes("safety") || message.toLowerCase().includes("blocked"));

        if (isAuthError) {
          console.error(`[Gemini] Key ${apiKey.slice(0, 6)}... is invalid or unauthorized. Removing from rotation.`);
          failedKeys.add(apiKey);
          keysInUse.delete(apiKey);
          geminiSemaphore.release();
          released = true;
          continue;
        }
        
        if (isRateLimit) {
          const isQuota = message.toLowerCase().includes("quota");
          const cooldownMs = isQuota ? 60000 : 15000; 
          keyCooldowns.set(apiKey, Date.now() + cooldownMs);
          console.warn(`[Gemini] Key ${apiKey.slice(0, 6)}... rate limited (${isQuota ? 'Quota' : 'Rate'}). Cooldown: ${cooldownMs/1000}s.`);
          
          keysInUse.delete(apiKey);
          
          // Check if any other keys are available right now
          const otherKeysAvailable = allGeminiKeys.some(k => !failedKeys.has(k) && !keysInUse.has(k) && (keyCooldowns.get(k) || 0) <= Date.now());
          
          if (!otherKeysAvailable) {
            const backoff = Math.min(10000, 1000 * Math.pow(1.5, i));
            const jitter = Math.random() * 1000;
            console.log(`[Gemini] No other keys available. Backing off for ${Math.round(backoff + jitter)}ms...`);
            geminiSemaphore.release();
            released = true;
            await new Promise(resolve => setTimeout(resolve, backoff + jitter));
          } else {
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
          
          keysInUse.delete(apiKey);
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
          keysInUse.delete(apiKey);
          if (i >= 2) throw error; 
          geminiSemaphore.release();
          released = true;
          continue;
        }
        
        if (i < retries - 1) {
          keysInUse.delete(apiKey);
          const backoff = Math.min(30000, 1000 * Math.pow(2, i));
          const jitter = Math.random() * 1000;
          console.warn(`[Gemini] Other error (${status}) with key ${apiKey.slice(0, 6)}...: ${message}. Retrying in ${Math.round(backoff + jitter)}ms...`);
          
          geminiSemaphore.release();
          released = true;
          await new Promise(resolve => setTimeout(resolve, backoff + jitter));
          continue;
        }
        keysInUse.delete(apiKey);
        throw error;
      } finally {
        keysInUse.delete(apiKey);
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
  return withRetry(async (ai) => {
    const response = await ai.models.embedContent({
      model: 'gemini-embedding-2-preview',
      contents: [text],
    });
    return response.embeddings[0].values;
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
  return withRetry(async (ai) => {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: { systemInstruction },
    });
    return response.text || "";
  });
}

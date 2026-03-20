import { GoogleGenAI } from "@google/genai";
import { generateDeepSeekJSON, getDeepSeekStatus as getDSStatus } from "./deepseek";

// Helper to collect keys injected by vite.config.ts at build time
function collectKeys(): string[] {
  // VITE_GEMINI_KEYS is a JSON array injected by vite.config.ts from all
  // GEMINI_API_KEY* and VITE_GEMINI_API_KEY* environment variables / Replit secrets.
  const injected = (import.meta as any).env.VITE_GEMINI_KEYS;
  let keys: string[] = [];

  if (Array.isArray(injected)) {
    keys = injected.filter((k: unknown) => typeof k === 'string' && k.trim().length > 10);
  } else if (typeof injected === 'string' && injected.length > 2) {
    try {
      const parsed = JSON.parse(injected);
      if (Array.isArray(parsed)) {
        keys = parsed.filter((k: unknown) => typeof k === 'string' && (k as string).trim().length > 10);
      }
    } catch {
      keys = injected.split(',').map(k => k.trim()).filter(k => k.length > 10);
    }
  }

  const unique = Array.from(new Set(keys));
  if (unique.length > 0) {
    console.log(`[Gemini] ${unique.length} API key(s) ready for rotation.`);
  } else {
    console.warn('[Gemini] No API keys found. Add GEMINI_API_KEY to Replit Secrets.');
  }
  return unique;
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
const MAX_CONCURRENCY = 8;
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
        if (waitTime > 4 * 60 * 1000) {
          throw new Error("All available Gemini API keys have reached their hard quota (billing/plan limits). Please wait for the 5-minute cooldown or add a new API key in Settings -> Secrets.");
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
        
        const isRateLimit = status === 429 || message.includes("429") || message.includes("RESOURCE_EXHAUSTED") || message.toLowerCase().includes("quota");
        const isAuthError = status === 401 || message.includes("401") || message.includes("API_KEY_INVALID");
        const isTransientError = [500, 503, 504].includes(status) || message.includes("500") || message.includes("503") || message.includes("504") || message.toLowerCase().includes("internal error") || message.toLowerCase().includes("overloaded");
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
          const isHardQuota = message.toLowerCase().includes("billing") || message.toLowerCase().includes("plan") || message.toLowerCase().includes("daily limit") || message.toLowerCase().includes("budget");
          
          if (isHardQuota) {
            // Use a 5-minute cooldown for hard quota instead of 10
            const longCooldownMs = 5 * 60 * 1000; 
            keyCooldowns.set(apiKey, Date.now() + longCooldownMs);
            console.error(`[Gemini] Key ${apiKey.slice(0, 6)}... reached hard quota (billing/plan). Cooling down for 5m.`);
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

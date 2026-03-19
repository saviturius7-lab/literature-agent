import { GoogleGenAI } from "@google/genai";

// Helper to collect keys from import.meta.env
function collectKeys(): string[] {
  const collected: string[] = [];
  
  // 1. Check for the bulk VITE_GEMINI_KEYS provided by vite.config.ts
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

  // 4. Legacy support for VITE_GEMINI_API_KEY_1 to 32
  for (let i = 1; i <= 32; i++) {
    const key = (import.meta as any).env[`VITE_GEMINI_API_KEY_${i}`];
    if (key && key.trim()) {
      collected.push(key.trim());
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
  console.log(`[Gemini] Collected ${uniqueKeys.length} API keys for rotation.`);
  return uniqueKeys;
}

const allGeminiKeys = collectKeys();
let currentKeyIndex = 0;

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
  
  return { total, failed, coolingDown, available };
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

// Limit to 2 concurrent calls to avoid hitting RPM/concurrency limits too fast
const geminiSemaphore = new Semaphore(2);

async function withRetry<T>(fn: (ai: GoogleGenAI) => Promise<T>, retries = 50): Promise<T> {
  let lastError: any;
  
  await geminiSemaphore.acquire();
  
  try {
    for (let i = 0; i < retries; i++) {
      const now = Date.now();
      const availableKeys = allGeminiKeys.filter(k => {
        if (failedKeys.has(k)) return false;
        const cooldownUntil = keyCooldowns.get(k) || 0;
        return now >= cooldownUntil;
      });

      // If no keys are available (all cooling down or failed), use the one with the shortest cooldown
      let apiKey: string;
      if (availableKeys.length === 0) {
        if (allGeminiKeys.length === 0) {
          throw new Error("No Gemini API keys found. Please add VITE_GEMINI_API_KEY to your environment variables or secrets.");
        }
        
        const sortedKeys = allGeminiKeys
          .filter(k => !failedKeys.has(k))
          .sort((a, b) => (keyCooldowns.get(a) || 0) - (keyCooldowns.get(b) || 0));
        
        if (sortedKeys.length === 0) {
          throw new Error("All Gemini API keys have failed. Please check your keys and try again.");
        }
        
        apiKey = sortedKeys[0];
        const waitTime = Math.max(0, (keyCooldowns.get(apiKey) || 0) - now);
        if (waitTime > 0) {
          console.log(`[Gemini] All keys on cooldown. Waiting ${Math.ceil(waitTime/1000)}s for the next available key...`);
          await new Promise(resolve => setTimeout(resolve, waitTime + 500));
        }
      } else {
        // Rotate through available keys
        apiKey = availableKeys[currentKeyIndex % availableKeys.length];
        currentKeyIndex++;
      }
      
      const ai = new GoogleGenAI({ apiKey });
      
      try {
        return await fn(ai);
      } catch (error: any) {
        lastError = error;
        let message = error.message || "";
        let status = error.status || 0;
        
        // If message is a JSON string, try to parse it to get status
        if (message.startsWith("{") && message.endsWith("}")) {
          try {
            const parsed = JSON.parse(message);
            if (parsed.error && parsed.error.code) {
              status = parsed.error.code;
              message = parsed.error.message || message;
            }
          } catch (e) { /* ignore */ }
        }
        
        const isRateLimit = message.includes("429") || status === 429 || message.includes("RESOURCE_EXHAUSTED") || message.toLowerCase().includes("quota");
        const isAuthError = message.includes("401") || status === 401 || message.includes("API_KEY_INVALID");
        
        if (isAuthError) {
          console.error(`[Gemini] Key ${apiKey.slice(0, 6)}... is invalid or unauthorized. Removing from rotation.`);
          failedKeys.add(apiKey);
          continue;
        }
        
        if (isRateLimit) {
          // Set a cooldown for this key
          const isQuota = message.toLowerCase().includes("quota");
          const cooldownMs = isQuota ? 60000 : 15000; 
          keyCooldowns.set(apiKey, Date.now() + cooldownMs);
          console.warn(`[Gemini] Key ${apiKey.slice(0, 6)}... rate limited (${isQuota ? 'Quota' : 'Rate'}). Cooldown: ${cooldownMs/1000}s. Retrying...`);
          
          // Exponential backoff for the retry loop itself
          const backoff = Math.min(30000, 2000 * Math.pow(1.5, i));
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }
        
        if (i < retries - 1) {
          const backoff = Math.min(30000, 1000 * Math.pow(2, i));
          console.warn(`[Gemini] Other error with key ${apiKey.slice(0, 6)}...: ${message}. Retrying in ${Math.round(backoff)}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }
        throw error;
      }
    }
  } finally {
    geminiSemaphore.release();
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

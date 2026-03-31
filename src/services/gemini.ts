import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { generateDeepSeekJSON, getDeepSeekStatus as getDSStatus } from "./deepseek";
import { KeyRotator, KeyStats } from "./keyRotator";
import { sanitizeJSON } from "../lib/jsonUtils";

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

  // 2. Fallback to individual keys
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

  // Final fallback: check for process.env.GEMINI_API_KEY
  try {
    const procKey = (process as any).env.GEMINI_API_KEY;
    if (procKey && procKey.trim()) {
      collected.push(procKey.trim());
    }
  } catch (e) { /* ignore */ }

  // User-provided keys as fallback (from chat)
  const userProvidedKeys: string[] = [];
  collected.push(...userProvidedKeys);

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
  
  if (uniqueKeys.length > 0) {
    console.log(`[Gemini] Collected ${uniqueKeys.length} unique API keys for rotation.`);
  } else {
    console.warn(`[Gemini] NO API KEYS COLLECTED!`);
  }
  return uniqueKeys;
}

const allGeminiKeys = collectKeys();
const rotator = new KeyRotator(allGeminiKeys, 'gemini', {
  minConcurrencyPerKey: 1,
  maxConcurrencyPerKey: 4,
  maxConcurrencyTotal: Math.max(100, allGeminiKeys.length * 2),
  baseCooldownMs: 15000,
  maxRetries: Math.max(20, allGeminiKeys.length), // Try at least 20 times or once per key
  circuitBreakerThreshold: 5,
  hedgingThresholdMs: 8000,
  enableHedging: true
});

export function getGeminiStatus() {
  const status = rotator.getStatus();
  const now = Date.now();
  // Hard quota is now 1 hour, so we check for cooldowns > 10 mins
  const hardQuota = status.stats.filter(s => s.cooldownUntil > now + (10 * 60 * 1000)).length;
  
  return { 
    ...status, 
    hardQuota,
    totalRetries: status.stats.reduce((acc, s) => acc + s.failureCount, 0)
  };
}

export function resetGeminiStatus() {
  rotator.reset();
  console.log("[Gemini] API status and rotation state reset.");
}

const geminiErrorHandler = (error: any, stats: KeyStats) => {
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
  const isAuthError = status === 401 || (status === 400 && message.includes("API_KEY_INVALID")) || message.toLowerCase().includes("invalid api key");
  const isTransientError = [500, 502, 503, 504].includes(status) || message.includes("500") || message.includes("502") || message.includes("503") || message.includes("504") || message.toLowerCase().includes("internal error") || message.toLowerCase().includes("overloaded") || message.toLowerCase().includes("bad gateway");
  const isSafetyError = status === 400 && (message.toLowerCase().includes("safety") || message.toLowerCase().includes("blocked"));
  const isTimeout = message.toLowerCase().includes("timeout") || message.toLowerCase().includes("deadline");

  if (isAuthError) return { retry: true, fatal: true };
  
  if (isRateLimit) {
    const isHardQuota = message.toLowerCase().includes("billing") || 
                       message.toLowerCase().includes("plan") || 
                       message.toLowerCase().includes("daily limit") || 
                       message.toLowerCase().includes("budget") ||
                       message.toLowerCase().includes("current quota") ||
                       message.toLowerCase().includes("exceeded your current quota");
    
    // Hard quota cooldown: 1 hour. Transient rate limit: 30s.
    return { retry: true, cooldownMs: isHardQuota ? 60 * 60 * 1000 : 30000 };
  }

  if (isTimeout) return { retry: true, cooldownMs: 1000 };
  if (isTransientError) return { retry: true, cooldownMs: 5000 };
  if (isSafetyError) return { retry: false };

  return { retry: true, cooldownMs: 2000 };
};

async function withRetry<T>(fn: (ai: GoogleGenAI) => Promise<T>): Promise<T> {
  return rotator.execute(async (apiKey) => {
    const ai = new GoogleGenAI({ apiKey });
    return await fn(ai);
  }, geminiErrorHandler);
}

export async function embedText(text: string): Promise<number[]> {
  const results = await embedTexts([text]);
  return results[0];
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  
  // Professional Batching: Gemini embedding limit is often 2048, but 100 is safer for payload size and latency
  const BATCH_SIZE = 100;
  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    batches.push(texts.slice(i, i + BATCH_SIZE));
  }
  
  // Parallelize batches to fully utilize the key pool and reduce latency
  const results = await Promise.all(batches.map(batch => 
    withRetry(async (ai) => {
      return await withTimeout(
        (async () => {
          const response = await ai.models.embedContent({
            model: 'gemini-embedding-2-preview',
            contents: batch,
          });
          return response.embeddings.map(e => e.values);
        })(),
        30000 // 30s timeout per batch
      );
    })
  ));
  
  return results.flat();
}

export { sanitizeJSON };

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: any;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId);
    return result;
  } catch (error: any) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export async function generateJSON<T>(prompt: string, systemInstruction?: string, model: string = "gemini-3-flash-preview"): Promise<T> {
  const dsStatus = getDSStatus();

  // Professional fallback logic: DeepSeek -> Gemini Pro -> Gemini Flash
  if (dsStatus.available > 0 && !model.includes("pro")) {
    try {
      return await generateDeepSeekJSON<T>(prompt, systemInstruction);
    } catch (e) {
      console.warn("[LLM] DeepSeek failed, falling back to Gemini:", e);
    }
  }

  try {
    const text = await withRetry(async (ai) => {
      return await withTimeout(
        (async () => {
          const response = await ai.models.generateContent({
            model,
            contents: prompt,
            config: { 
              systemInstruction,
              responseMimeType: "application/json",
              maxOutputTokens: 16384,
              thinkingConfig: {
                thinkingLevel: model.includes("pro") ? ThinkingLevel.HIGH : ThinkingLevel.LOW
              }
            },
          });
          return response.text || "{}";
        })(),
        45000 // 45s timeout for LLM generation
      );
    });

    const cleaned = sanitizeJSON(text);
    try {
      return JSON.parse(cleaned) as T;
    } catch (e) {
      console.error("[Gemini] Failed to parse JSON. Raw response:", text);
      // One last attempt: try to fix common JSON errors with a regex if simple parse fails
      throw new Error(`Invalid JSON response from Gemini: ${e instanceof Error ? e.message : String(e)}`);
    }
  } catch (error: any) {
    const msg = error.message || String(error);
    if (model.includes("pro") && (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.toLowerCase().includes("quota"))) {
      console.warn(`[Gemini] Pro model rate limited, falling back to Flash...`);
      return generateJSON<T>(prompt, systemInstruction, "gemini-3-flash-preview");
    }
    throw error;
  }
}

export async function generateText(prompt: string, systemInstruction?: string): Promise<string> {
  const dsStatus = getDSStatus();

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

  return await withRetry(async (ai) => {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: { 
        systemInstruction,
        maxOutputTokens: 16384,
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.LOW
        }
      },
    });
    return response.text || "";
  });
}

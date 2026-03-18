import { GoogleGenAI } from "@google/genai";

// Helper to collect keys from import.meta.env
function collectKeys(): string[] {
  const collected: string[] = [];
  
  // 1. Check for individual keys VITE_GEMINI_API_KEY_1 to VITE_GEMINI_API_KEY_32
  for (let i = 1; i <= 32; i++) {
    const key = (import.meta as any).env[`VITE_GEMINI_API_KEY_${i}`];
    if (key && key.trim()) {
      collected.push(key.trim());
    }
  }

  // 2. Check for the bulk VITE_GEMINI_KEYS (JSON array or comma-separated)
  const bulkKeys = (import.meta as any).env.VITE_GEMINI_KEYS;
  if (bulkKeys) {
    if (Array.isArray(bulkKeys)) {
      collected.push(...bulkKeys.filter(k => typeof k === 'string' && k.trim()));
    } else if (typeof bulkKeys === 'string') {
      try {
        // Try JSON parse first
        const parsed = JSON.parse(bulkKeys);
        if (Array.isArray(parsed)) {
          collected.push(...parsed.filter(k => typeof k === 'string' && k.trim()));
        } else {
          collected.push(bulkKeys.trim());
        }
      } catch (e) {
        // Fallback to comma-separated
        const split = bulkKeys.split(',').map(k => k.trim()).filter(k => k);
        collected.push(...split);
      }
    }
  }

  // Remove duplicates
  return Array.from(new Set(collected));
}

const allGeminiKeys = collectKeys();
let currentKeyIndex = 0;

// Track failed keys to avoid them in the same session
const failedKeys = new Set<string>();

// Track rate-limited keys and when they can be used again
const keyCooldowns = new Map<string, number>();

async function withRetry<T>(fn: (ai: GoogleGenAI) => Promise<T>, retries = 30): Promise<T> {
  let lastError: any;
  
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
      const sortedKeys = allGeminiKeys
        .filter(k => !failedKeys.has(k))
        .sort((a, b) => (keyCooldowns.get(a) || 0) - (keyCooldowns.get(b) || 0));
      
      apiKey = sortedKeys[0] || allGeminiKeys[0];
      
      // If even the best key is still cooling down, wait a bit
      const waitTime = Math.max(0, (keyCooldowns.get(apiKey) || 0) - now);
      if (waitTime > 0) {
        console.log(`All keys cooling down. Waiting ${waitTime}ms for best key...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    } else {
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
        failedKeys.add(apiKey);
      }
      
      if (isRateLimit) {
        // Set a cooldown for this key (e.g., 5 seconds for free tier)
        keyCooldowns.set(apiKey, Date.now() + 5000);
      }
      
      if (i < retries - 1 && (isRateLimit || isAuthError)) {
        const backoff = Math.min(15000, 1000 * Math.pow(1.5, i)); // Exponential backoff up to 15s
        console.warn(`Gemini API error (${isRateLimit ? "Rate limit" : "Auth error"}). Retrying in ${Math.round(backoff)}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }
      throw error;
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

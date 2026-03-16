import { GoogleGenAI } from "@google/genai";

// Helper to collect keys from import.meta.env
function collectKeys(): string[] {
  const keys = (import.meta as any).env.VITE_GEMINI_KEYS;
  if (Array.isArray(keys)) return keys;
  if (typeof keys === 'string') {
    try {
      return JSON.parse(keys);
    } catch (e) {
      return [];
    }
  }
  return [];
}

const allGeminiKeys = collectKeys();
let currentKeyIndex = 0;

// Track failed keys to avoid them in the same session
const failedKeys = new Set<string>();

async function withRetry<T>(fn: (ai: GoogleGenAI) => Promise<T>, retries = 15): Promise<T> {
  const keys = allGeminiKeys.filter(k => !failedKeys.has(k));
  const availableKeys = keys.length > 0 ? keys : allGeminiKeys; // Fallback to all if all "failed"
  
  let lastError: any;
  
  for (let i = 0; i < retries; i++) {
    const apiKey = availableKeys[currentKeyIndex % availableKeys.length];
    currentKeyIndex++;
    
    const ai = new GoogleGenAI({ apiKey });
    
    try {
      return await fn(ai);
    } catch (error: any) {
      lastError = error;
      const message = error.message || "";
      const status = error.status || 0;
      
      const isRateLimit = message.includes("429") || status === 429 || message.includes("RESOURCE_EXHAUSTED");
      const isAuthError = message.includes("401") || status === 401 || message.includes("API_KEY_INVALID");
      
      if (isAuthError) {
        failedKeys.add(apiKey);
      }
      
      if (i < retries - 1 && (isRateLimit || isAuthError)) {
        console.warn(`Gemini API error (${isRateLimit ? "Rate limit" : "Auth error"}), retrying with next key...`);
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

export async function generateJSON<T>(prompt: string, systemInstruction?: string): Promise<T> {
  return withRetry(async (ai) => {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: { 
        systemInstruction,
        responseMimeType: "application/json"
      },
    });
    
    const text = response.text || "{}";
    // Clean JSON if needed (sometimes model adds markdown blocks)
    const cleaned = text.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
    return JSON.parse(cleaned) as T;
  });
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

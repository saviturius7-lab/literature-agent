import { GoogleGenAI } from "@google/genai";

const geminiKeys = [
  process.env.GEMINI_API_KEY || "",
  "AIzaSyAgyLOp3O2KJSDuBzTHIcO3P6u0JnYOy9Y",
  "AIzaSyAZLw-MJuq_FVcAPB-VWeGzF5AMoUQ_S8s",
  "AIzaSyCCi9hVrs_Bd7yHgid962SfpxTpLzvEkjs",
  "AIzaSyBOgiTqWdtu5iMww1a_i5R8x8N1YdC4GQ8"
].filter(k => k && k !== "MY_GEMINI_API_KEY");

const openRouterKeys = [
  "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",
  "sk-31d2ee7822fa4e77b05c9aac1f87938f",
  "sk-bfd3cd74043e445a82eb2cf3fd44c0e1",
  "sk-7b833fa108ca4e7d9e1dbbb15d879746",
  "sk-3bae3e9d58f6419faa9e89e8738ad3b1"
];

let invalidOpenRouterKeys = new Set<string>();
let currentGeminiKeyIndex = 0;
let currentOpenRouterKeyIndex = 0;

function getGeminiAI() {
  const apiKey = geminiKeys.length > 0 ? geminiKeys[currentGeminiKeyIndex % geminiKeys.length] : "";
  currentGeminiKeyIndex++;
  return new GoogleGenAI({ apiKey });
}

function getOpenRouterKey() {
  const availableKeys = openRouterKeys.filter(k => !invalidOpenRouterKeys.has(k));
  if (availableKeys.length === 0) {
    // If all keys are invalid, reset and try again (maybe it was a temporary issue)
    invalidOpenRouterKeys.clear();
    return openRouterKeys[currentOpenRouterKeyIndex++ % openRouterKeys.length];
  }
  const key = availableKeys[currentOpenRouterKeyIndex % availableKeys.length];
  currentOpenRouterKeyIndex++;
  return key;
}

export const geminiModel = "gemini-3.1-pro-preview";
const openRouterModels = [
  "google/gemini-pro-1.5",
  "anthropic/claude-3.5-sonnet",
  "openai/gpt-4o"
];

async function callOpenRouter(prompt: string, systemInstruction?: string, jsonMode = false): Promise<string> {
  const apiKey = getOpenRouterKey();
  const model = openRouterModels[Math.floor(Math.random() * openRouterModels.length)];
  
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ai.studio/build",
        "X-Title": "Research Agent"
      },
      body: JSON.stringify({
        model: model,
        messages: [
          ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
          { role: "user", content: prompt }
        ],
        response_format: jsonMode ? { type: "json_object" } : undefined
      })
    });

    if (response.status === 401) {
      console.error(`OpenRouter Key Invalid (401): ${apiKey.slice(0, 8)}...`);
      invalidOpenRouterKeys.add(apiKey);
      throw new Error("401: Unauthorized - Key might be invalid or user not found.");
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter Error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error: any) {
    if (error.message?.includes("401")) {
      // Re-throw to trigger retry with a different key
      throw error;
    }
    throw error;
  }
}

async function withRetry<T>(fn: (attempt: number) => Promise<T>, retries = 5, delay = 1000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn(i);
    } catch (error: any) {
      const isRateLimit = error.message?.includes("429") || 
                          error.status === 429 || 
                          error.message?.includes("RESOURCE_EXHAUSTED") ||
                          (typeof error === 'string' && error.includes("429"));
      
      const isAuthError = error.message?.includes("401");
                          
      if (i < retries - 1 && (isRateLimit || isAuthError)) {
        const reason = isRateLimit ? "Rate limit" : "Auth error";
        console.warn(`${reason} hit (attempt ${i + 1}), retrying...`);
        if (isRateLimit) await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries reached");
}

export async function generateJSON<T>(prompt: string, systemInstruction?: string): Promise<T> {
  return withRetry(async (attempt) => {
    // Try Gemini first for first 2 attempts, then fallback to OpenRouter
    if (attempt < 2) {
      const ai = getGeminiAI();
      const response = await ai.models.generateContent({
        model: geminiModel,
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
        },
      });

      const text = response.text;
      if (!text) throw new Error("No response from Gemini");
      return JSON.parse(text) as T;
    } else {
      console.log("Falling back to OpenRouter for JSON generation...");
      const text = await callOpenRouter(prompt, systemInstruction, true);
      return JSON.parse(text) as T;
    }
  });
}

export async function generateText(prompt: string, systemInstruction?: string): Promise<string> {
  return withRetry(async (attempt) => {
    if (attempt < 2) {
      const ai = getGeminiAI();
      const response = await ai.models.generateContent({
        model: geminiModel,
        contents: prompt,
        config: {
          systemInstruction,
        },
      });

      return response.text || "";
    } else {
      console.log("Falling back to OpenRouter for text generation...");
      return await callOpenRouter(prompt, systemInstruction, false);
    }
  });
}

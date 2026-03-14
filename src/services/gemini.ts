import { GoogleGenAI } from "@google/genai";

const geminiKeys = [
  process.env.GEMINI_API_KEY || "",
  "AIzaSyAgyLOp3O2KJSDuBzTHIcO3P6u0JnYOy9Y",
  "AIzaSyAZLw-MJuq_FVcAPB-VWeGzF5AMoUQ_S8s",
  "AIzaSyCCi9hVrs_Bd7yHgid962SfpxTpLzvEkjs",
  "AIzaSyBOgiTqWdtu5iMww1a_i5R8x8N1YdC4GQ8"
].filter(k => k && k !== "MY_GEMINI_API_KEY");

const deepSeekKeys = [
  "sk-31d2ee7822fa4e77b05c9aac1f87938f",
  "sk-bfd3cd74043e445a82eb2cf3fd44c0e1",
  "sk-7b833fa108ca4e7d9e1dbbb15d879746",
  "sk-3bae3e9d58f6419faa9e89e8738ad3b1"
];

const openRouterKeys = [
  "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"
];

let invalidOpenRouterKeys = new Set<string>();
let invalidDeepSeekKeys = new Set<string>();
let currentGeminiKeyIndex = 0;
let currentOpenRouterKeyIndex = 0;
let currentDeepSeekKeyIndex = 0;

function getGeminiAI() {
  const apiKey = geminiKeys.length > 0 ? geminiKeys[currentGeminiKeyIndex % geminiKeys.length] : "";
  currentGeminiKeyIndex++;
  return new GoogleGenAI({ apiKey });
}

function getDeepSeekKey() {
  const availableKeys = deepSeekKeys.filter(k => !invalidDeepSeekKeys.has(k));
  if (availableKeys.length === 0) {
    invalidDeepSeekKeys.clear();
    return deepSeekKeys[currentDeepSeekKeyIndex++ % deepSeekKeys.length];
  }
  const key = availableKeys[currentDeepSeekKeyIndex % availableKeys.length];
  currentDeepSeekKeyIndex++;
  return key;
}

function getOpenRouterKey() {
  const availableKeys = openRouterKeys.filter(k => !invalidOpenRouterKeys.has(k));
  if (availableKeys.length === 0) {
    invalidOpenRouterKeys.clear();
    return openRouterKeys[currentOpenRouterKeyIndex++ % openRouterKeys.length];
  }
  const key = availableKeys[currentOpenRouterKeyIndex % availableKeys.length];
  currentOpenRouterKeyIndex++;
  return key;
}

export const geminiModel = "gemini-3-flash-preview";
export const geminiProModel = "gemini-3.1-pro-preview";

const openRouterModels = [
  "google/gemini-pro-1.5",
  "anthropic/claude-3.5-sonnet",
  "openai/gpt-4o",
  "meta-llama/llama-3.1-70b-instruct"
];

async function callDeepSeek(prompt: string, systemInstruction?: string, jsonMode = false): Promise<string> {
  const apiKey = getDeepSeekKey();
  
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
          { role: "user", content: prompt }
        ],
        response_format: jsonMode ? { type: "json_object" } : undefined,
        temperature: 0.7
      })
    });

    if (response.status === 401) {
      console.error(`DeepSeek Key Invalid (401): ${apiKey.slice(0, 8)}...`);
      invalidDeepSeekKeys.add(apiKey);
      throw new Error("401: Unauthorized - DeepSeek Key might be invalid.");
    }

    if (response.status === 402) {
      console.error(`DeepSeek Insufficient Balance (402): ${apiKey.slice(0, 8)}...`);
      invalidDeepSeekKeys.add(apiKey);
      throw new Error("402: Insufficient Balance - DeepSeek Key has no funds.");
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`DeepSeek Error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error: any) {
    throw error;
  }
}

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
      throw new Error("401: Unauthorized - OpenRouter Key might be invalid.");
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter Error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error: any) {
    throw error;
  }
}

async function withRetry<T>(fn: (attempt: number) => Promise<T>, retries = 15, delay = 1000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn(i);
    } catch (error: any) {
      const isRateLimit = error.message?.includes("429") || 
                          error.status === 429 || 
                          error.message?.includes("RESOURCE_EXHAUSTED") ||
                          (typeof error === 'string' && error.includes("429"));
      
      const isAuthError = error.message?.includes("401");
      const isBalanceError = error.message?.includes("402");
                          
      if (i < retries - 1 && (isRateLimit || isAuthError || isBalanceError)) {
        const reason = isRateLimit ? "Rate limit" : isAuthError ? "Auth error" : "Balance error";
        console.warn(`${reason} hit (attempt ${i + 1}), retrying with different provider/key...`);
        
        if (isRateLimit) {
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 1.5;
        }
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries reached. All providers and keys failed. Please check your API balances and keys.");
}

function cleanJSON(text: string): string {
  // Remove markdown code blocks
  let cleaned = text.replace(/```json\n?|```/g, "").trim();
  
  // Fix common unescaped backslash issues in strings
  // This regex looks for backslashes that are NOT followed by a valid escape character (", \, /, b, f, n, r, t, uXXXX)
  // and escapes them.
  cleaned = cleaned.replace(/\\(?![\\\/bfnrtu"'])/g, "\\\\");
  
  return cleaned;
}

export async function generateJSON<T>(prompt: string, systemInstruction?: string): Promise<T> {
  return withRetry(async (attempt) => {
    const providerIndex = attempt % 3;
    
    if (providerIndex === 0) {
      console.log(`[Attempt ${attempt}] Using Gemini...`);
      try {
        const ai = getGeminiAI();
        // Alternate between Pro and Flash
        const model = attempt % 2 === 0 ? geminiModel : geminiProModel;
        const response = await ai.models.generateContent({
          model: model,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
          },
        });

        const text = response.text;
        if (!text) throw new Error("No response from Gemini");
        try {
          return JSON.parse(cleanJSON(text)) as T;
        } catch (parseError) {
          console.error("JSON Parse Error (Gemini):", parseError, "Raw text:", text);
          throw parseError;
        }
      } catch (e: any) {
        console.error("Gemini failed, moving to next provider...");
        throw e;
      }
    } else if (providerIndex === 1) {
      console.log(`[Attempt ${attempt}] Using DeepSeek...`);
      try {
        const text = await callDeepSeek(prompt, systemInstruction, true);
        try {
          return JSON.parse(cleanJSON(text)) as T;
        } catch (parseError) {
          console.error("JSON Parse Error (DeepSeek):", parseError, "Raw text:", text);
          throw parseError;
        }
      } catch (e: any) {
        console.error("DeepSeek failed, moving to next provider...");
        throw e;
      }
    } else {
      console.log(`[Attempt ${attempt}] Using OpenRouter...`);
      try {
        const text = await callOpenRouter(prompt, systemInstruction, true);
        try {
          return JSON.parse(cleanJSON(text)) as T;
        } catch (parseError) {
          console.error("JSON Parse Error (OpenRouter):", parseError, "Raw text:", text);
          throw parseError;
        }
      } catch (e: any) {
        console.error("OpenRouter failed, moving to next provider...");
        throw e;
      }
    }
  });
}

export async function generateText(prompt: string, systemInstruction?: string): Promise<string> {
  return withRetry(async (attempt) => {
    const providerIndex = attempt % 3;
    
    if (providerIndex === 0) {
      console.log(`[Attempt ${attempt}] Using Gemini...`);
      try {
        const ai = getGeminiAI();
        const model = attempt % 2 === 0 ? geminiModel : geminiProModel;
        const response = await ai.models.generateContent({
          model: model,
          contents: prompt,
          config: {
            systemInstruction,
          },
        });

        return response.text || "";
      } catch (e: any) {
        throw e;
      }
    } else if (providerIndex === 1) {
      console.log(`[Attempt ${attempt}] Using DeepSeek...`);
      try {
        return await callDeepSeek(prompt, systemInstruction, false);
      } catch (e: any) {
        throw e;
      }
    } else {
      console.log(`[Attempt ${attempt}] Using OpenRouter...`);
      try {
        return await callOpenRouter(prompt, systemInstruction, false);
      } catch (e: any) {
        throw e;
      }
    }
  });
}

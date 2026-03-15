import express from "express";
import path from "path";
import { GoogleGenAI } from "@google/genai";

const app = express();
app.use(express.json());
const PORT = 3000;

// In-memory blacklists
const fatalKeys = new Set<string>();
const quotaKeys = new Map<string, number>(); // key -> expiry timestamp

// Helper to collect keys from both comma-separated lists and numbered variables
function collectKeys(baseName: string): string[] {
  const keys: string[] = [];
  
  const listName = `${baseName}S`;
  if (process.env[listName]) {
    process.env[listName]?.split(",").forEach(k => {
      const trimmed = k.trim();
      // Filter out empty strings and common placeholders
      if (trimmed && !trimmed.includes("TODO") && !trimmed.startsWith("YOUR_") && trimmed.length > 10) {
        keys.push(trimmed);
      }
    });
  }

  for (let i = 1; i <= 20; i++) {
    const keyName = `${baseName}_${i}`;
    const val = process.env[keyName]?.trim();
    if (val && !val.includes("TODO") && !val.startsWith("YOUR_") && val.length > 10) {
      keys.push(val);
    }
  }

  const defaultVal = process.env[baseName]?.trim();
  if (defaultVal && !defaultVal.includes("TODO") && !defaultVal.startsWith("YOUR_") && defaultVal.length > 10 && !keys.includes(defaultVal)) {
    keys.push(defaultVal);
  }

  return Array.from(new Set(keys));
}

function getAvailableKeys(allKeys: string[]): string[] {
  const now = Date.now();
  return allKeys.filter(k => {
    if (fatalKeys.has(k)) return false;
    const quotaExpiry = quotaKeys.get(k);
    if (quotaExpiry && now < quotaExpiry) return false;
    return true;
  });
}

// API Keys from Environment Variables
const allGeminiKeys = collectKeys("GEMINI_API_KEY");

let currentGeminiKeyIndex = 0;

function getGeminiAI() {
  const available = getAvailableKeys(allGeminiKeys);
  if (available.length === 0) return null;
  const apiKey = available[currentGeminiKeyIndex % available.length];
  currentGeminiKeyIndex++;
  return { ai: new GoogleGenAI({ apiKey }), key: apiKey };
}

async function withRetry<T>(fn: (ai: any) => Promise<T>): Promise<T> {
  let lastError: any;
  const attemptedKeys = new Set<string>();
  const maxAttempts = Math.max(allGeminiKeys.length, 1);

  for (let i = 0; i < maxAttempts; i++) {
    const available = getAvailableKeys(allGeminiKeys);
    if (available.length === 0) {
      // If all keys are in quota cooldown, try the oldest one anyway if we have no other choice
      if (fatalKeys.size < allGeminiKeys.length) {
        const sortedQuotaKeys = Array.from(quotaKeys.entries()).sort((a, b) => a[1] - b[1]);
        if (sortedQuotaKeys.length > 0) {
          const [key] = sortedQuotaKeys[0];
          console.log(`[Backend] All keys exhausted/quota-limited. Forcing retry with oldest quota key.`);
          const ai = new GoogleGenAI({ apiKey: key });
          try {
            return await fn(ai);
          } catch (err) {
            lastError = err;
            continue;
          }
        }
      }
      throw new Error("No valid GEMINI_API_KEYS available (all failed, expired, or none configured)");
    }

    const gemini = getGeminiAI();
    if (!gemini) break;

    const { ai, key } = gemini;
    if (attemptedKeys.has(key)) continue;
    attemptedKeys.add(key);

    try {
      return await fn(ai);
    } catch (error: any) {
      lastError = error;
      const msg = typeof error.message === 'string' ? error.message : JSON.stringify(error);
      
      const isFatal = 
        msg.includes("PERMISSION_DENIED") || 
        msg.includes("API key") || 
        msg.includes("leaked") ||
        msg.includes("expired") ||
        msg.includes("INVALID_ARGUMENT") ||
        msg.includes("API_KEY_INVALID");

      const isQuota = 
        msg.includes("RESOURCE_EXHAUSTED") || 
        msg.includes("429") || 
        msg.includes("quota");

      if (isFatal) {
        fatalKeys.add(key);
        console.warn(`[Backend] Fatal error with Gemini key. Blacklisting permanently. Attempt ${i + 1}/${maxAttempts}`);
        continue;
      }

      if (isQuota) {
        // Quota hit: Cooldown for 60 seconds
        quotaKeys.set(key, Date.now() + 60000);
        console.warn(`[Backend] Quota exceeded for Gemini key. Cooldown for 60s. Attempt ${i + 1}/${maxAttempts}`);
        continue;
      }

      throw error;
    }
  }
  throw lastError || new Error("Request failed after trying all available keys.");
}

function cleanJSON(text: string): string {
  let cleaned = text.replace(/```json\n?|```/g, "").trim();
  let result = "";
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "\\") {
      const next = cleaned[i + 1];
      if (["\"", "\\", "/", "b", "f", "n", "r", "t"].includes(next)) {
        result += "\\";
        result += next;
        i++;
      } else if (next === "u") {
        const hexPart = cleaned.slice(i + 2, i + 6);
        if (/[0-9a-fA-F]{4}/.test(hexPart)) {
          result += "\\u";
          result += hexPart;
          i += 5;
        } else {
          result += "\\\\";
        }
      } else {
        result += "\\\\";
      }
    } else {
      result += cleaned[i];
    }
  }
  return result;
}

// API Proxy for arXiv to bypass CORS
app.get("/api/arxiv", async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "Query parameter 'q' is required" });

  const query = (q as string).startsWith("all:") || (q as string).startsWith("ti:") || (q as string).startsWith("au:") 
    ? q 
    : `all:${q}`;

  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query as string)}&start=0&max_results=30&sortBy=relevance&sortOrder=descending`;
  
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "ResearchAgent/1.0" }
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: `ArXiv API error: ${response.status}` });
    }

    const data = await response.text();
    res.set("Content-Type", "application/xml");
    res.send(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch from arXiv" });
  }
});

app.post("/api/generate-json", async (req, res) => {
  const { prompt, systemInstruction, attempt = 0 } = req.body;

  try {
    const result = await withRetry(async (ai) => {
      const model = attempt % 2 === 0 ? "gemini-3-flash-preview" : "gemini-3.1-pro-preview";
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { systemInstruction, responseMimeType: "application/json" },
      });
      return cleanJSON(response.text || "{}");
    });
    return res.json({ text: result });
  } catch (error: any) {
    console.error(`[Backend] Generate JSON Error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/generate-text", async (req, res) => {
  const { prompt, systemInstruction, attempt = 0 } = req.body;

  try {
    const result = await withRetry(async (ai) => {
      const model = attempt % 2 === 0 ? "gemini-3-flash-preview" : "gemini-3.1-pro-preview";
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { systemInstruction },
      });
      return response.text || "";
    });
    return res.json({ text: result });
  } catch (error: any) {
    console.error(`[Backend] Generate Text Error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/embed", async (req, res) => {
  const { text } = req.body;
  try {
    const result = await withRetry(async (ai) => {
      const response = await ai.models.embedContent({
        model: 'gemini-embedding-2-preview',
        contents: [text],
      });
      return response.embeddings[0].values;
    });
    res.json({ embedding: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

async function setupServer() {
  if (process.env.NODE_ENV !== "production") {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Development server running on http://localhost:${PORT}`);
      });
    } catch (e) {
      console.error("Failed to start Vite dev server:", e);
    }
  }
}

setupServer();
export default app;

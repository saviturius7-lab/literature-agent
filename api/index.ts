import express from "express";
import path from "path";
import { GoogleGenAI } from "@google/genai";

const app = express();
app.use(express.json());
const PORT = 3000;

// Helper to collect keys from both comma-separated lists and numbered variables (e.g., GEMINI_API_KEY_1)
function collectKeys(baseName: string): string[] {
  const keys: string[] = [];
  
  // 1. Check for comma-separated list (e.g., GEMINI_API_KEYS)
  const listName = `${baseName}S`;
  if (process.env[listName]) {
    process.env[listName]?.split(",").forEach(k => {
      const trimmed = k.trim();
      if (trimmed) keys.push(trimmed);
    });
  }

  // 2. Check for individual numbered variables (e.g., GEMINI_API_KEY_1 to 20)
  for (let i = 1; i <= 20; i++) {
    const keyName = `${baseName}_${i}`;
    if (process.env[keyName]) {
      keys.push(process.env[keyName]!.trim());
    }
  }

  // 3. Check for the single default variable (e.g., GEMINI_API_KEY)
  if (process.env[baseName] && !keys.includes(process.env[baseName]!.trim())) {
    keys.push(process.env[baseName]!.trim());
  }

  return Array.from(new Set(keys)); // Remove duplicates
}

// API Keys from Environment Variables
const geminiKeys = collectKeys("GEMINI_API_KEY");
const deepSeekKeys = collectKeys("DEEPSEEK_API_KEY");
const openRouterKeys = collectKeys("OPENROUTER_API_KEY");

let currentGeminiKeyIndex = 0;
let currentDeepSeekKeyIndex = 0;
let currentOpenRouterKeyIndex = 0;

const openRouterModels = [
  "google/gemini-pro-1.5",
  "anthropic/claude-3.5-sonnet",
  "openai/gpt-4o",
  "meta-llama/llama-3.1-70b-instruct"
];

function getGeminiAI() {
  if (geminiKeys.length === 0) throw new Error("GEMINI_API_KEYS not configured on server");
  const apiKey = geminiKeys[currentGeminiKeyIndex % geminiKeys.length];
  currentGeminiKeyIndex++;
  return new GoogleGenAI({ apiKey });
}

function getDeepSeekKey() {
  if (deepSeekKeys.length === 0) throw new Error("DEEPSEEK_API_KEYS not configured on server");
  const key = deepSeekKeys[currentDeepSeekKeyIndex % deepSeekKeys.length];
  currentDeepSeekKeyIndex++;
  return key;
}

function getOpenRouterKey() {
  if (openRouterKeys.length === 0) throw new Error("OPENROUTER_API_KEYS not configured on server");
  const key = openRouterKeys[currentOpenRouterKeyIndex % openRouterKeys.length];
  currentOpenRouterKeyIndex++;
  return key;
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
  const providerIndex = attempt % 3;

  try {
    if (providerIndex === 0 && geminiKeys.length > 0) {
      const ai = getGeminiAI();
      const model = attempt % 2 === 0 ? "gemini-3-flash-preview" : "gemini-3.1-pro-preview";
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { systemInstruction, responseMimeType: "application/json" },
      });
      return res.json({ text: cleanJSON(response.text || "{}") });
    } else if (providerIndex === 1 && deepSeekKeys.length > 0) {
      const apiKey = getDeepSeekKey();
      const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
            { role: "user", content: prompt }
          ],
          response_format: { type: "json_object" },
          temperature: 0.7
        })
      });
      const data = await response.json();
      return res.json({ text: cleanJSON(data.choices[0].message.content) });
    } else if (openRouterKeys.length > 0) {
      const apiKey = getOpenRouterKey();
      const model = openRouterModels[Math.floor(Math.random() * openRouterModels.length)];
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
            { role: "user", content: prompt }
          ],
          response_format: { type: "json_object" }
        })
      });
      const data = await response.json();
      return res.json({ text: cleanJSON(data.choices[0].message.content) });
    }
    throw new Error("No available provider for JSON generation");
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/generate-text", async (req, res) => {
  const { prompt, systemInstruction, attempt = 0 } = req.body;
  const providerIndex = attempt % 3;

  try {
    if (providerIndex === 0 && geminiKeys.length > 0) {
      const ai = getGeminiAI();
      const model = attempt % 2 === 0 ? "gemini-3-flash-preview" : "gemini-3.1-pro-preview";
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { systemInstruction },
      });
      return res.json({ text: response.text || "" });
    } else if (providerIndex === 1 && deepSeekKeys.length > 0) {
      const apiKey = getDeepSeekKey();
      const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
            { role: "user", content: prompt }
          ],
          temperature: 0.7
        })
      });
      const data = await response.json();
      return res.json({ text: data.choices[0].message.content });
    } else if (openRouterKeys.length > 0) {
      const apiKey = getOpenRouterKey();
      const model = openRouterModels[Math.floor(Math.random() * openRouterModels.length)];
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
            { role: "user", content: prompt }
          ]
        })
      });
      const data = await response.json();
      return res.json({ text: data.choices[0].message.content });
    }
    throw new Error("No available provider for text generation");
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/embed", async (req, res) => {
  const { text } = req.body;
  try {
    const ai = getGeminiAI();
    const result = await ai.models.embedContent({
      model: 'gemini-embedding-2-preview',
      contents: [text],
    });
    res.json({ embedding: result.embeddings[0].values });
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

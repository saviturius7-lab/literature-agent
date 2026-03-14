import { GoogleGenAI } from "@google/genai";

const keys = [
  process.env.GEMINI_API_KEY || "",
  "AIzaSyAgyLOp3O2KJSDuBzTHIcO3P6u0JnYOy9Y",
  "AIzaSyAZLw-MJuq_FVcAPB-VWeGzF5AMoUQ_S8s",
  "AIzaSyCCi9hVrs_Bd7yHgid962SfpxTpLzvEkjs",
  "AIzaSyBOgiTqWdtu5iMww1a_i5R8x8N1YdC4GQ8"
].filter(k => k && k !== "MY_GEMINI_API_KEY");

let currentKeyIndex = 0;

function getAI() {
  const apiKey = keys.length > 0 ? keys[currentKeyIndex % keys.length] : "";
  currentKeyIndex++;
  return new GoogleGenAI({ apiKey });
}

export const geminiModel = "gemini-3.1-pro-preview";

export async function generateJSON<T>(prompt: string, systemInstruction?: string): Promise<T> {
  const ai = getAI();
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
}

export async function generateText(prompt: string, systemInstruction?: string): Promise<string> {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: geminiModel,
    contents: prompt,
    config: {
      systemInstruction,
    },
  });

  return response.text || "";
}

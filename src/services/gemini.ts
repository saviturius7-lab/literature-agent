import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey });

export const geminiModel = "gemini-3.1-pro-preview";

export async function generateJSON<T>(prompt: string, systemInstruction?: string): Promise<T> {
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
  const response = await ai.models.generateContent({
    model: geminiModel,
    contents: prompt,
    config: {
      systemInstruction,
    },
  });

  return response.text || "";
}

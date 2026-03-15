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

export async function embedText(text: string): Promise<number[]> {
  return withRetry(async () => {
    const response = await fetch("/api/embed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    if (!response.ok) throw new Error(`Embed failed: ${response.status}`);
    const data = await response.json();
    return data.embedding;
  });
}

export async function generateJSON<T>(prompt: string, systemInstruction?: string): Promise<T> {
  return withRetry(async (attempt) => {
    const response = await fetch("/api/generate-json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, systemInstruction, attempt })
    });
    if (!response.ok) throw new Error(`Generate JSON failed: ${response.status}`);
    const data = await response.json();
    return JSON.parse(data.text) as T;
  });
}

export async function generateText(prompt: string, systemInstruction?: string): Promise<string> {
  return withRetry(async (attempt) => {
    const response = await fetch("/api/generate-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, systemInstruction, attempt })
    });
    if (!response.ok) throw new Error(`Generate Text failed: ${response.status}`);
    const data = await response.json();
    return data.text;
  });
}

async function withRetry<T>(fn: (attempt: number) => Promise<T>, retries = 15, delay = 1000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn(i);
    } catch (error: any) {
      const status = error.status || 0;
      const message = error.message || "";
      
      const isRateLimit = message.includes("429") || status === 429 || message.includes("RESOURCE_EXHAUSTED");
      const isAuthError = message.includes("401") || status === 401;
      const isBalanceError = message.includes("402") || status === 402;
      const isServerError = message.includes("500") || status === 500;
                          
      if (i < retries - 1 && (isRateLimit || isAuthError || isBalanceError || isServerError)) {
        const reason = isRateLimit ? "Rate limit" : isAuthError ? "Auth error" : isBalanceError ? "Balance error" : "Server error";
        console.warn(`${reason} hit (attempt ${i + 1}), retrying with different provider/key...`);
        
        if (isRateLimit || isServerError) {
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 1.5;
        }
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries reached. All providers and keys failed. Please check your API balances and keys in the environment variables.");
}

export async function embedText(text: string): Promise<number[]> {
  return withRetry(async () => {
    const response = await fetch("/api/embed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(errorData.error || `Embed failed: ${response.status}`);
      (error as any).status = response.status;
      throw error;
    }
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
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(errorData.error || `Generate JSON failed: ${response.status}`);
      (error as any).status = response.status;
      throw error;
    }
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
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(errorData.error || `Generate Text failed: ${response.status}`);
      (error as any).status = response.status;
      throw error;
    }
    const data = await response.json();
    return data.text;
  });
}

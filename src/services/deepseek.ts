/**
 * DeepSeek API Key Management
 * Collects and rotates through DeepSeek API keys for fallback support.
 */

// Helper to collect keys injected by vite.config.ts at build time
function collectDeepSeekKeys(): string[] {
  // VITE_DEEPSEEK_KEYS is a JSON array injected by vite.config.ts from all
  // DEEPSEEK_API_KEY* and VITE_DEEPSEEK_API_KEY* environment variables / Replit secrets.
  const injected = (import.meta as any).env.VITE_DEEPSEEK_KEYS;
  let keys: string[] = [];

  if (Array.isArray(injected)) {
    keys = injected.filter((k: unknown) => typeof k === 'string' && (k as string).trim().length > 10);
  } else if (typeof injected === 'string' && injected.length > 2) {
    try {
      const parsed = JSON.parse(injected);
      if (Array.isArray(parsed)) {
        keys = parsed.filter((k: unknown) => typeof k === 'string' && (k as string).trim().length > 10);
      }
    } catch {
      keys = injected.split(',').map(k => k.trim()).filter(k => k.length > 10);
    }
  }

  const unique = Array.from(new Set(keys));
  if (unique.length > 0) {
    console.log(`[DeepSeek] ${unique.length} API key(s) ready for rotation.`);
  } else {
    console.warn('[DeepSeek] No API keys found. Add DEEPSEEK_API_KEY to Replit Secrets (optional).');
  }
  return unique;
}

export const allDeepSeekKeys = collectDeepSeekKeys();
const failedKeys = new Set<string>();
const keyCooldowns = new Map<string, number>();
const keyLastUsed = new Map<string, number>();

export function getDeepSeekStatus() {
  const now = Date.now();
  const total = allDeepSeekKeys.length;
  const failed = failedKeys.size;
  const coolingDown = Array.from(keyCooldowns.values()).filter(t => t > now).length;
  const available = total - failed - coolingDown;
  
  return { total, failed, coolingDown, available };
}

export function resetDeepSeekStatus() {
  failedKeys.clear();
  keyCooldowns.clear();
  keyLastUsed.clear();
}

export async function withDeepSeekRetry<T>(fn: (apiKey: string) => Promise<T>, retries = 3): Promise<T> {
  let lastError: any;
  
  for (let i = 0; i < retries; i++) {
    const now = Date.now();
    const availableKeys = allDeepSeekKeys.filter(k => {
      if (failedKeys.has(k)) return false;
      const cooldownUntil = keyCooldowns.get(k) || 0;
      return now >= cooldownUntil;
    }).sort((a, b) => (keyLastUsed.get(a) || 0) - (keyLastUsed.get(b) || 0));

    if (availableKeys.length === 0) {
      if (allDeepSeekKeys.length === 0) {
        throw new Error("No DeepSeek API keys found.");
      }
      // Wait a bit if all keys are on cooldown
      await new Promise(resolve => setTimeout(resolve, 2000));
      continue;
    }

    const apiKey = availableKeys[0];
    keyLastUsed.set(apiKey, Date.now());

    try {
      return await fn(apiKey);
    } catch (error: any) {
      lastError = error;
      const status = error.status || 0;
      const message = error.message || "";

      if (status === 401 || message.includes("401") || message.includes("invalid")) {
        failedKeys.add(apiKey);
      } else if (status === 429 || message.includes("429") || message.includes("rate limit")) {
        keyCooldowns.set(apiKey, Date.now() + 60000);
      } else {
        keyCooldowns.set(apiKey, Date.now() + 5000);
      }
    }
  }
  
  throw lastError || new Error("DeepSeek max retries reached");
}

export async function generateDeepSeekJSON<T>(prompt: string, systemInstruction?: string): Promise<T> {
  return withDeepSeekRetry(async (apiKey) => {
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw { status: response.status, message: errorData.error?.message || response.statusText };
    }

    const data = await response.json();
    return JSON.parse(data.choices[0].message.content) as T;
  });
}

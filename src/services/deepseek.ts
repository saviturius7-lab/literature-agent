/**
 * DeepSeek API Key Management
 * Collects and rotates through DeepSeek API keys for fallback support.
 */

function collectDeepSeekKeys(): string[] {
  const collected: string[] = [];
  
  // 1. Check for the bulk VITE_DEEPSEEK_KEYS provided by vite.config.ts
  const bulkKeys = (import.meta as any).env.VITE_DEEPSEEK_KEYS;
  if (bulkKeys) {
    if (Array.isArray(bulkKeys)) {
      collected.push(...bulkKeys.filter(k => typeof k === 'string' && k.trim()));
    } else if (typeof bulkKeys === 'string') {
      try {
        const parsed = JSON.parse(bulkKeys);
        if (Array.isArray(parsed)) {
          collected.push(...parsed.filter(k => typeof k === 'string' && k.trim()));
        } else {
          collected.push(bulkKeys.trim());
        }
      } catch (e) {
        const split = bulkKeys.split(',').map(k => k.trim()).filter(k => k);
        collected.push(...split);
      }
    }
  }

  // 2. Fallback to individual keys (Vite static access)
  const primaryKey = (import.meta as any).env.VITE_DEEPSEEK_API_KEY;
  if (primaryKey && primaryKey.trim() && !primaryKey.includes("TODO")) {
    collected.push(primaryKey.trim());
  }

  // 3. Check for DEEPSEEK_KEYS (common alias)
  const dsBulkKeys = (import.meta as any).env.DEEPSEEK_KEYS;
  if (dsBulkKeys) {
    if (Array.isArray(dsBulkKeys)) {
      collected.push(...dsBulkKeys.filter(k => typeof k === 'string' && k.trim()));
    } else if (typeof dsBulkKeys === 'string') {
      try {
        const parsed = JSON.parse(dsBulkKeys);
        if (Array.isArray(parsed)) {
          collected.push(...parsed.filter(k => typeof k === 'string' && k.trim()));
        }
      } catch (e) {
        const split = dsBulkKeys.split(',').map(k => k.trim()).filter(k => k);
        collected.push(...split);
      }
    }
  }
  
  const uniqueKeys = Array.from(new Set(collected)).filter(k => k && k.length > 10 && !k.includes("TODO"));
  if (uniqueKeys.length > 0) {
    console.log(`[DeepSeek] Collected ${uniqueKeys.length} unique API keys for rotation.`);
    console.log(`[DeepSeek] Key prefixes: ${uniqueKeys.map(k => k.slice(0, 6)).join(', ')}`);
  } else {
    console.warn(`[DeepSeek] NO DEEPSEEK API KEYS COLLECTED!`);
  }
  return uniqueKeys;
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

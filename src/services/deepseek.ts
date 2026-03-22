import { KeyRotator, KeyStats } from "./keyRotator";

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

  // 4. Check for OPENROUTER_API_KEY (common source of sk-or- keys)
  const orKey = (import.meta as any).env.VITE_OPENROUTER_API_KEY || (import.meta as any).env.OPENROUTER_API_KEY;
  if (orKey && orKey.trim() && !orKey.includes("TODO")) {
    collected.push(orKey.trim());
  }
  
  const uniqueKeys = Array.from(new Set(collected)).filter(k => {
    if (!k || typeof k !== 'string' || k.length < 10) return false;
    const upper = k.toUpperCase();
    if (upper.includes("TODO")) return false;
    if (upper.includes("YOUR_API_KEY")) return false;
    if (upper.includes("DEEPSEEK_API_KEY")) return false;
    if (upper.includes("INSERT_KEY")) return false;
    if (upper.includes("REPLACE_WITH")) return false;
    return true;
  });
  
  if (uniqueKeys.length > 0) {
    console.log(`[DeepSeek] Collected ${uniqueKeys.length} unique API keys for rotation.`);
  } else {
    console.warn(`[DeepSeek] NO DEEPSEEK API KEYS COLLECTED!`);
  }
  return uniqueKeys;
}

const allDeepSeekKeys = collectDeepSeekKeys();
const rotator = new KeyRotator(allDeepSeekKeys, 'deepseek', {
  minConcurrencyPerKey: 1,
  maxConcurrencyPerKey: 4,
  maxConcurrencyTotal: 15,
  baseCooldownMs: 30000,
  maxRetries: 5,
  circuitBreakerThreshold: 5,
  hedgingThresholdMs: 12000, // DeepSeek can be slow sometimes
  enableHedging: true
});

export function getDeepSeekStatus() {
  return rotator.getStatus();
}

export function resetDeepSeekStatus() {
  rotator.reset();
}

const deepSeekErrorHandler = (error: any, stats: KeyStats) => {
  const status = error.status || 0;
  const message = (error.message || "").toLowerCase();

  const isAuth = status === 401 || status === 403 || 
                message.includes("401") || message.includes("403") || 
                message.includes("invalid") || message.includes("auth") || 
                message.includes("unauthorized") || message.includes("user not found") || 
                message.includes("authentication fails") || message.includes("credentials");

  const isRate = status === 429 || message.includes("429") || 
                message.includes("rate limit") || message.includes("quota") || 
                message.includes("too many requests") || message.includes("insufficient_balance");

  if (isAuth) return { retry: true, fatal: true };
  if (isRate) return { retry: true, cooldownMs: 60000 };
  
  return { retry: true, cooldownMs: 5000 };
};

export async function generateDeepSeekJSON<T>(prompt: string, systemInstruction?: string): Promise<T> {
  return rotator.execute(async (apiKey) => {
    // Detect provider based on key prefix
    const isOpenRouter = apiKey.startsWith('sk-or-');
    const endpoint = isOpenRouter 
      ? "https://openrouter.ai/api/v1/chat/completions" 
      : "https://api.deepseek.com/v1/chat/completions";
    
    const model = isOpenRouter ? "deepseek/deepseek-chat" : "deepseek-chat";

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        ...(isOpenRouter ? {
          "HTTP-Referer": window.location.origin,
          "X-Title": "Literature Agent"
        } : {})
      },
      body: JSON.stringify({
        model: model,
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
  }, deepSeekErrorHandler);
}

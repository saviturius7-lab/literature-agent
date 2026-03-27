
export type ProviderType = 'gemini' | 'deepseek' | 'openrouter';

export interface KeyStats {
  key: string;
  provider: ProviderType;
  successCount: number;
  failureCount: number;
  totalRequests: number;
  avgLatency: number;
  lastUsed: number;
  cooldownUntil: number;
  isFailed: boolean;
  concurrency: number;
  consecutiveFailures: number;
  // New fields for adaptive logic
  dynamicConcurrencyLimit: number;
  healthScore: number;
}

export interface RotatorOptions {
  minConcurrencyPerKey: number;
  maxConcurrencyPerKey: number;
  maxConcurrencyTotal: number;
  baseCooldownMs: number;
  maxRetries: number;
  circuitBreakerThreshold: number;
  hedgingThresholdMs: number; // If request takes longer than this, start another
  enableHedging: boolean;
}

export class KeyRotator {
  private stats: Map<string, KeyStats> = new Map();
  private activeTotal = 0;
  private requestQueue: (() => void)[] = [];

  constructor(
    private keys: string[],
    private provider: ProviderType,
    private options: RotatorOptions = {
      minConcurrencyPerKey: 1,
      maxConcurrencyPerKey: 4,
      maxConcurrencyTotal: 100,
      baseCooldownMs: 15000,
      maxRetries: 10,
      circuitBreakerThreshold: 5,
      hedgingThresholdMs: 8000,
      enableHedging: true
    }
  ) {
    // Ensure total concurrency is at least proportional to the number of keys
    const minTotal = Math.max(options.maxConcurrencyTotal || 0, keys.length * 2);
    this.options.maxConcurrencyTotal = minTotal;

    keys.forEach(key => {
      this.stats.set(key, {
        key,
        provider,
        successCount: 0,
        failureCount: 0,
        totalRequests: 0,
        avgLatency: 0,
        lastUsed: 0,
        cooldownUntil: 0,
        isFailed: false,
        concurrency: 0,
        consecutiveFailures: 0,
        dynamicConcurrencyLimit: options.minConcurrencyPerKey,
        healthScore: 100
      });
    });
  }

  private updateHealth(s: KeyStats, success: boolean, latency?: number) {
    if (success && latency !== undefined) {
      // AIMD for concurrency
      s.dynamicConcurrencyLimit = Math.min(
        this.options.maxConcurrencyPerKey,
        s.dynamicConcurrencyLimit + 0.2
      );
      
      // Moving average for latency
      s.avgLatency = s.avgLatency === 0 ? latency : (s.avgLatency * 0.8) + (latency * 0.2);
      
      // Health score boost
      s.healthScore = Math.min(100, s.healthScore + 10);
      s.consecutiveFailures = 0;
      s.isFailed = false; // Recover if it was marked failed
    } else {
      // Multiplicative decrease for concurrency
      s.dynamicConcurrencyLimit = Math.max(
        this.options.minConcurrencyPerKey,
        s.dynamicConcurrencyLimit * 0.5
      );
      
      // Health score penalty
      s.healthScore = Math.max(0, s.healthScore - 20);
      s.consecutiveFailures++;
    }
  }

  private selectBestKey(): KeyStats | null {
    const now = Date.now();
    const candidates = Array.from(this.stats.values())
      .filter(s => !s.isFailed && s.cooldownUntil <= now && s.concurrency < Math.ceil(s.dynamicConcurrencyLimit));
    
    if (candidates.length === 0) return null;

    // Sort by health score (primary), then by least recently used (secondary)
    // We add a small random factor to healthScore to distribute load among equally healthy keys
    return candidates.sort((a, b) => {
      const scoreA = a.healthScore + (Math.random() * 5);
      const scoreB = b.healthScore + (Math.random() * 5);
      if (Math.abs(scoreB - scoreA) > 2) return scoreB - scoreA;
      return a.lastUsed - b.lastUsed;
    })[0];
  }

  private async acquire(): Promise<KeyStats> {
    const now = Date.now();
    const allFailed = Array.from(this.stats.values()).every(s => s.isFailed);
    if (allFailed && this.stats.size > 0) {
      throw new Error(`[Rotator:${this.provider}] All available keys have failed. Please check your API keys or reset status.`);
    }

    const selected = this.selectBestKey();
    if (selected && this.activeTotal < this.options.maxConcurrencyTotal) {
      selected.concurrency++;
      this.activeTotal++;
      return selected;
    }

    // If no key is immediately available, wait in queue
    if (this.requestQueue.length < 100) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const idx = this.requestQueue.indexOf(resolveFn);
          if (idx !== -1) {
            this.requestQueue.splice(idx, 1);
            reject(new Error(`[Rotator:${this.provider}] Timed out waiting for available key`));
          }
        }, 30000); // 30s queue timeout

        const resolveFn = () => {
          clearTimeout(timeout);
          resolve(this.acquire());
        };
        
        this.requestQueue.push(resolveFn);
      });
    }
    
    throw new Error(`[Rotator:${this.provider}] Request queue full`);
  }

  private release(s: KeyStats) {
    s.concurrency = Math.max(0, s.concurrency - 1);
    this.activeTotal = Math.max(0, this.activeTotal - 1);
    
    if (this.requestQueue.length > 0) {
      const next = this.requestQueue.shift();
      if (next) next();
    }
  }

  async execute<T>(
    fn: (key: string) => Promise<T>,
    errorHandler?: (error: any, stats: KeyStats) => { retry: boolean; cooldownMs?: number; fatal?: boolean }
  ): Promise<T> {
    let lastError: any;
    const maxRetries = this.options.maxRetries;

    for (let i = 0; i < maxRetries; i++) {
      let stats: KeyStats;
      try {
        stats = await this.acquire();
      } catch (e) {
        // Queue full or timeout acquiring
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        continue;
      }

      const startTime = Date.now();
      stats.lastUsed = startTime;
      stats.totalRequests++;

      // Professional Hedging Logic
      const controller = new AbortController();
      let hedgingTimer: any;
      
      const runRequest = async (s: KeyStats, isHedging = false): Promise<T> => {
        try {
          const result = await fn(s.key);
          if (controller.signal.aborted) throw new Error("Aborted by hedging");
          
          this.updateHealth(s, true, Date.now() - startTime);
          return result;
        } catch (error: any) {
          if (controller.signal.aborted) throw error;
          
          this.updateHealth(s, false);
          const decision = errorHandler 
            ? errorHandler(error, s) 
            : this.defaultErrorHandler(error, s);

          if (decision.fatal || s.consecutiveFailures >= this.options.circuitBreakerThreshold) {
            s.isFailed = true;
          } else if (decision.cooldownMs) {
            s.cooldownUntil = Date.now() + decision.cooldownMs;
          }
          
          if (!decision.retry || isHedging) throw error;
          throw error; // Let the outer loop handle retries
        } finally {
          this.release(s);
        }
      };

      try {
        if (this.options.enableHedging && i === 0) {
          // Primary request
          const primaryPromise = runRequest(stats);
          
          // Hedging request after threshold
          const hedgingPromise = new Promise<T>((resolve, reject) => {
            hedgingTimer = setTimeout(async () => {
              try {
                const hedgeStats = await this.selectBestKey();
                if (hedgeStats && hedgeStats.key !== stats.key) {
                  hedgeStats.concurrency++;
                  this.activeTotal++;
                  console.log(`[Rotator:${this.provider}] Hedging request started with key: ${hedgeStats.key.slice(0, 8)}...`);
                  resolve(await runRequest(hedgeStats, true));
                }
              } catch (e) {
                // Hedging failed, just wait for primary
              }
            }, this.options.hedgingThresholdMs);
          });

          try {
            const result = await Promise.race([primaryPromise, hedgingPromise]);
            return result;
          } finally {
            clearTimeout(hedgingTimer);
            controller.abort(); // Cancel whichever one is still running
          }
        } else {
          return await runRequest(stats);
        }
      } catch (error: any) {
        lastError = error;
        if (error.message === "Aborted by hedging") continue;
        
        // If we've tried many times, maybe the keys are just slow or rate limited
        // Don't retry indefinitely if all keys are failing
        const availableKeys = Array.from(this.stats.values()).filter(s => !s.isFailed).length;
        const maxRetriesToTry = Math.min(availableKeys, 10); // Try at most 10 keys per request
        if (i >= Math.max(this.options.maxRetries, maxRetriesToTry)) {
          throw error;
        }

        // Exponential backoff for retries
        const backoff = Math.min(10000, 500 * Math.pow(2, i));
        await new Promise(r => setTimeout(r, backoff));
      }
    }

    throw lastError || new Error(`[Rotator:${this.provider}] Max retries reached`);
  }

  private defaultErrorHandler(error: any, stats: KeyStats) {
    const status = error.status || 0;
    const message = (error.message || "").toLowerCase();
    const isAuth = status === 401 || status === 403 || message.includes("auth") || message.includes("key");
    const isRate = status === 429 || message.includes("rate") || message.includes("quota");

    if (isAuth) return { retry: true, fatal: true };
    if (isRate) return { retry: true, cooldownMs: this.options.baseCooldownMs };
    return { retry: true, cooldownMs: 2000 };
  }

  getStatus() {
    const now = Date.now();
    const all = Array.from(this.stats.values());
    return {
      total: all.length,
      failed: all.filter(s => s.isFailed).length,
      coolingDown: all.filter(s => !s.isFailed && s.cooldownUntil > now).length,
      available: all.filter(s => !s.isFailed && s.cooldownUntil <= now && s.concurrency < s.dynamicConcurrencyLimit).length,
      active: this.activeTotal,
      stats: all.map(s => ({ ...s }))
    };
  }

  reset() {
    this.stats.forEach(s => {
      s.isFailed = false;
      s.cooldownUntil = 0;
      s.consecutiveFailures = 0;
      s.concurrency = 0;
      s.dynamicConcurrencyLimit = this.options.minConcurrencyPerKey;
      s.healthScore = 100;
    });
    this.activeTotal = 0;
    this.requestQueue = [];
  }
}

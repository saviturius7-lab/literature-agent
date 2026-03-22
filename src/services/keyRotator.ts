
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
      maxConcurrencyTotal: 20,
      baseCooldownMs: 15000,
      maxRetries: 5,
      circuitBreakerThreshold: 5,
      hedgingThresholdMs: 8000, // 8 seconds default for LLMs
      enableHedging: true
    }
  ) {
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
      s.healthScore = Math.min(100, s.healthScore + 5);
      s.consecutiveFailures = 0;
    } else {
      // Multiplicative decrease for concurrency
      s.dynamicConcurrencyLimit = Math.max(
        this.options.minConcurrencyPerKey,
        s.dynamicConcurrencyLimit * 0.5
      );
      
      // Health score penalty
      s.healthScore = Math.max(0, s.healthScore - 25);
      s.consecutiveFailures++;
    }
  }

  private selectKeyLottery(): KeyStats | null {
    const now = Date.now();
    const candidates = Array.from(this.stats.values()).filter(s => 
      !s.isFailed && 
      s.cooldownUntil <= now && 
      s.concurrency < Math.ceil(s.dynamicConcurrencyLimit)
    );

    if (candidates.length === 0) return null;

    // Weighted random selection (Lottery)
    const totalWeight = candidates.reduce((sum, s) => sum + s.healthScore, 0);
    if (totalWeight === 0) return candidates[Math.floor(Math.random() * candidates.length)];

    let random = Math.random() * totalWeight;
    for (const s of candidates) {
      random -= s.healthScore;
      if (random <= 0) return s;
    }

    return candidates[0];
  }

  private async acquire(): Promise<KeyStats> {
    if (this.activeTotal >= this.options.maxConcurrencyTotal) {
      return new Promise(resolve => {
        this.requestQueue.push(() => resolve(this.acquire()));
      });
    }

    const selected = this.selectKeyLottery();
    if (selected) {
      selected.concurrency++;
      this.activeTotal++;
      return selected;
    }

    // No keys available (all on cooldown or busy)
    // Wait for a bit and retry
    await new Promise(r => setTimeout(r, 1000));
    return this.acquire();
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

    for (let i = 0; i < this.options.maxRetries; i++) {
      const stats = await this.acquire();
      const startTime = Date.now();
      stats.lastUsed = startTime;
      stats.totalRequests++;

      // Implement Hedging
      let hedgingTimeout: any;
      const controller = new AbortController();

      const executePromise = (async () => {
        try {
          const result = await fn(stats.key);
          this.updateHealth(stats, true, Date.now() - startTime);
          return result;
        } catch (error: any) {
          this.updateHealth(stats, false);
          throw error;
        }
      })();

      const result = await Promise.race([
        executePromise,
        new Promise<never>((_, reject) => {
          if (this.options.enableHedging) {
            hedgingTimeout = setTimeout(() => {
              console.log(`[Rotator:${this.provider}] Hedging triggered for key ${stats.key.slice(0, 6)}...`);
              reject({ isHedging: true });
            }, this.options.hedgingThresholdMs);
          }
        })
      ]).catch(async (err) => {
        if (err.isHedging) {
          // If hedging triggered, we don't release the current key yet, 
          // but we start another attempt in parallel.
          // This is a bit complex for a simple loop, so we'll just treat it as a "retry" 
          // but keep the current one running if possible.
          // Actually, for simplicity in this environment, we'll just fall through to the retry logic.
          return null; 
        }
        throw err;
      });

      clearTimeout(hedgingTimeout);
      this.release(stats);

      if (result !== null) return result;

      // If we're here, it was either an error or hedging
      if (lastError && !lastError.isHedging) {
        const decision = errorHandler 
          ? errorHandler(lastError, stats) 
          : this.defaultErrorHandler(lastError, stats);

        if (decision.fatal || stats.consecutiveFailures >= this.options.circuitBreakerThreshold) {
          stats.isFailed = true;
        } else if (decision.cooldownMs) {
          stats.cooldownUntil = Date.now() + decision.cooldownMs;
        }
        if (!decision.retry) throw lastError;
      }
      
      // Small backoff
      await new Promise(r => setTimeout(r, 200 * (i + 1)));
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

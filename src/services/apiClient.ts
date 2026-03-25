
/**
 * Professional API Client for Research Agent
 * Handles retries, timeouts, and structured error reporting.
 */

export interface ApiRequestOptions extends RequestInit {
  timeout?: number;
  retries?: number;
  backoff?: number;
}

export class ApiError extends Error {
  constructor(
    public message: string,
    public status: number,
    public data?: any,
    public stage?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchWithTimeout(resource: string, options: ApiRequestOptions = {}) {
  const { timeout = 30000 } = options;
  
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error: any) {
    clearTimeout(id);
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms`);
    }
    throw error;
  }
}

export interface ApiClient {
  request<T>(endpoint: string, options?: ApiRequestOptions): Promise<T>;
  get<T>(endpoint: string, options?: ApiRequestOptions): Promise<T>;
  post<T>(endpoint: string, body: any, options?: ApiRequestOptions): Promise<T>;
}

export const apiClient: ApiClient = {
  async request<T>(endpoint: string, options: ApiRequestOptions = {}): Promise<T> {
    const { retries = 3, backoff = 1000, ...fetchOptions } = options;
    let lastError: any;

    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetchWithTimeout(endpoint, fetchOptions);
        
        if (!response.ok) {
          let errorData: any;
          try {
            errorData = await response.json();
          } catch (e) {
            errorData = { error: response.statusText };
          }
          
          throw new ApiError(
            errorData.error || `Request failed with status ${response.status}`,
            response.status,
            errorData,
            errorData.stage
          );
        }

        // Handle different content types
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const data = await response.json();
          return data as T;
        }
        const text = await response.text();
        return text as unknown as T;
        
      } catch (error: any) {
        lastError = error;
        
        // Don't retry on 4xx errors (except 429)
        if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429) {
          throw error;
        }

        if (i < retries - 1) {
          const waitTime = backoff * Math.pow(2, i) + (Math.random() * 500);
          console.warn(`[API] Request to ${endpoint} failed, retrying in ${Math.round(waitTime)}ms...`, error.message);
          await new Promise(r => setTimeout(r, waitTime));
        }
      }
    }

    throw lastError;
  },

  async get<T>(endpoint: string, options: ApiRequestOptions = {}): Promise<T> {
    return apiClient.request<T>(endpoint, { ...options, method: 'GET' });
  },

  async post<T>(endpoint: string, body: any, options: ApiRequestOptions = {}): Promise<T> {
    return apiClient.request<T>(endpoint, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: JSON.stringify(body),
    });
  }
};

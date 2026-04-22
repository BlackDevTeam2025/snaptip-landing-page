/**
 * @typedef {{ ok: boolean, data?: any, error?: { code: string, message: string, detail?: any }, meta?: Record<string, any> }} ApiResponse
 */

export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ApiError";
    this.status = options.status || 500;
    this.code = options.code || "UNKNOWN_ERROR";
    this.detail = options.detail;
  }
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: any, signal?: AbortSignal }} options
 * @returns {Promise<ApiResponse>}
 */
export async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    signal: options.signal,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }

  if (!response.ok || !payload?.ok) {
    throw new ApiError(payload?.error?.message || "Request failed", {
      status: response.status,
      code: payload?.error?.code,
      detail: payload?.error?.detail,
    });
  }

  return payload;
}

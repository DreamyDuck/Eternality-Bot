export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

let csrfToken = '';
export function setCsrfToken(token: string) { csrfToken = token; }

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const mutating = options.method && !['GET', 'HEAD'].includes(options.method);
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(mutating ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if ([401, 403].includes(response.status) && path !== '/api/me') {
      window.dispatchEvent(new Event('session-expired'));
    }
    throw new ApiError(response.status, body?.error || `请求失败 (${response.status})`);
  }
  return response.status === 204 ? undefined as T : response.json();
}

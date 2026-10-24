export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfter: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch('/api/' + path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  let data: T & { error?: string };
  try {
    data = await response.json();
  } catch {
    throw new Error('The gateway returned an unexpected response. Please retry.');
  }
  if (!response.ok) {
    if (response.status === 401 && !['login', 'setup', 'session'].includes(path))
      window.dispatchEvent(new Event('session-expired'));
    const retry = Number(response.headers.get('retry-after')) || 0;
    throw new ApiError(
      (data.error || 'Request failed.') + (retry ? ` Try again in ${retry} seconds.` : ''),
      response.status,
      retry,
    );
  }
  return data;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public headers: Record<string, string> = {},
  ) {
    super(message);
  }
}
export function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers },
  });
}
export async function readBytes(
  source: Request | Response,
  max: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const advertised = Number(source.headers.get('content-length'));
  if (advertised > max) throw new HttpError(413, 'Request is too large.');
  const reader = source.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > max) {
        await reader.cancel();
        throw new HttpError(413, 'Request is too large.');
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of chunks) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
    throw new HttpError(415, 'Expected application/json.');
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(await readBytes(request, 8192)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Invalid JSON request.');
  }
}
export function requireOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (origin !== new URL(request.url).origin)
    throw new HttpError(403, 'Request origin is not allowed.');
}

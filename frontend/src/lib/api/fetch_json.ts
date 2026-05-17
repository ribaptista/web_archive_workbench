/**
 * Thin fetch wrapper used by all `lib/api/*` functions.
 *
 * - Throws an `Error` whose message comes from the response body's `error`
 *   field if present (handy for our API which returns `{ error: string }`),
 *   else from `res.statusText`.
 * - Returns the parsed JSON body on success.
 *
 * Use `fetchJsonVoid` for endpoints that do not return a JSON body.
 */
async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === 'string') return body.error;
  } catch {
    // body wasn't JSON or wasn't readable
  }
  return res.statusText || `HTTP ${res.status}`;
}

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<T>;
}

export async function fetchJsonVoid(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<void> {
  const res = await fetch(input, init);
  if (!res.ok) throw new Error(await readError(res));
}

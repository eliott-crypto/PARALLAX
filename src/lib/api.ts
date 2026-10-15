export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error || body.message || `Request failed (${response.status})`);
  return body as T;
}
export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
export function readable(value: string) {
  return value.replaceAll('_', ' ').toLowerCase();
}
export function canonicalSourceUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(fbclid|gclid|msclkid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.href;
  } catch {
    return value.trim();
  }
}
export function uniqueSources<T extends { url: string }>(records: readonly T[]): T[] {
  return [...new Map(records.map((record) => [canonicalSourceUrl(record.url), record])).values()];
}
export function sourceCount(records: readonly { url: string }[]): number {
  return uniqueSources(records).length;
}
export function dateLabel(value?: string | null) {
  if (!value) return 'Date not specified';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

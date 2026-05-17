export function formatTimestamp(ts: string): string {
  if (ts.length === 14)
    return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
  return ts;
}

export interface AggregatedStats {
  count: number;
  total: number;
  avg: number;
  max: number;
}

export function aggregateStats(durations: number[]): AggregatedStats {
  const count = durations.length;
  const total = durations.reduce((a, b) => a + b, 0);
  const max = count ? Math.max(...durations) : 0;
  const avg = count ? Math.round(total / count) : 0;
  return { count, total, avg, max };
}

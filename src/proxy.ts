import fs from 'fs';
import Bottleneck from 'bottleneck';
import { ProxyAgent, Agent } from 'undici';

export interface ProxyEntry {
  address: string;
  agent: ProxyAgent | Agent;
  limiter: Bottleneck;
  ongoing: number;
}

const CONNECT_TIMEOUT_MS = 10_000;
const KEEP_ALIVE_TIMEOUT_MS = 30_000;
const KEEP_ALIVE_MAX_TIMEOUT_MS = 60_000;
const AGENT_CONNECTIONS = 300;

export function loadProxies(
  proxyFile: string | undefined,
  maxReqPerPeriod: number,
  periodMs: number,
): ProxyEntry[] {
  const makeAgent = (proxy?: string): ProxyAgent | Agent => {
    if (proxy) {
      return new ProxyAgent({
        uri: proxy.includes('://') ? proxy : `http://${proxy}`,
        keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
        keepAliveMaxTimeout: KEEP_ALIVE_MAX_TIMEOUT_MS,
        connections: AGENT_CONNECTIONS,
        connect: {
          timeout: CONNECT_TIMEOUT_MS,
        },
      });
    }
    return new Agent({
      keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
      keepAliveMaxTimeout: KEEP_ALIVE_MAX_TIMEOUT_MS,
      connections: AGENT_CONNECTIONS,
      connect: {
        timeout: CONNECT_TIMEOUT_MS,
      },
    });
  };

  const makeLimiter = (): Bottleneck => {
    return new Bottleneck({
      reservoir: maxReqPerPeriod,
      reservoirRefreshAmount: maxReqPerPeriod,
      reservoirRefreshInterval: periodMs,
      maxConcurrent: maxReqPerPeriod,
      minTime: Math.ceil(periodMs / maxReqPerPeriod),
    });
  };

  if (!proxyFile) {
    // No proxy - single entry with direct connection
    return [
      {
        address: 'direct',
        agent: makeAgent(),
        limiter: makeLimiter(),
        ongoing: 0,
      },
    ];
  }

  const lines = fs
    .readFileSync(proxyFile, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    console.error('Proxy file is empty');
    process.exit(1);
  }

  return lines.map((addr) => ({
    address: addr,
    agent: makeAgent(addr),
    limiter: makeLimiter(),
    ongoing: 0,
  }));
}

/**
 * Pick the proxy with lowest ongoing request count, breaking ties randomly.
 */
export function pickProxy(proxies: ProxyEntry[]): ProxyEntry {
  const minOngoing = Math.min(...proxies.map((p) => p.ongoing));
  const candidates = proxies.filter((p) => p.ongoing === minOngoing);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

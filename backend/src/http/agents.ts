import Bottleneck from 'bottleneck';
import { Agent } from 'undici';
import { createProxyAgent, parseProxyFile } from './proxy';

export interface AgentEntry {
  address: string | null;
  agent: ReturnType<typeof createProxyAgent> | Agent;
  limiter: Bottleneck;
  ongoing: number;
}

const CONNECT_TIMEOUT_MS = 10_000;
const KEEP_ALIVE_TIMEOUT_MS = 30_000;
const KEEP_ALIVE_MAX_TIMEOUT_MS = 60_000;
const AGENT_CONNECTIONS = 300;

function createLocalAgent(): Agent {
  return new Agent({
    keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
    keepAliveMaxTimeout: KEEP_ALIVE_MAX_TIMEOUT_MS,
    connections: AGENT_CONNECTIONS,
    connect: {
      timeout: CONNECT_TIMEOUT_MS,
    },
  });
}

export function loadAgents(
  proxyFile: string | undefined,
  maxReqPerPeriod: number,
  periodMs: number,
): AgentEntry[] {
  const limiter = new Bottleneck({
    reservoir: maxReqPerPeriod,
    reservoirRefreshAmount: maxReqPerPeriod,
    reservoirRefreshInterval: periodMs,
    maxConcurrent: maxReqPerPeriod,
    minTime: Math.ceil(periodMs / maxReqPerPeriod),
  });

  if (!proxyFile) {
    return [{ address: null, agent: createLocalAgent(), limiter, ongoing: 0 }];
  }

  const lines = parseProxyFile(proxyFile);

  return lines.map((addr) => ({
    address: addr,
    agent: createProxyAgent(addr),
    limiter: limiter,
    ongoing: 0,
  }));
}

/**
 * Pick the agent with lowest ongoing request count, breaking ties randomly.
 */
export function pickAgent(agents: AgentEntry[]): AgentEntry {
  const minOngoing = Math.min(...agents.map((a) => a.ongoing));
  const candidates = agents.filter((a) => a.ongoing === minOngoing);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

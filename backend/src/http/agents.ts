import Bottleneck from 'bottleneck';
import { Agent } from 'undici';
import { createProxyAgent, parseProxyFile } from './proxy';

export interface AgentEntry {
  address: string | null;
  agent: ReturnType<typeof createProxyAgent> | Agent;
  limiter: Bottleneck;
  ongoing: number;
}

export interface AgentFactoryOptions {
  proxyFile?: string;
  limiterOptions?: Partial<LimiterOptions>;
}

export interface LimiterOptions {
  maxReqPerPeriod: number;
  periodMs: number;
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

const DEFAULT_MAX_REQ_PER_PERIOD = 100;
const DEFAULT_PERIOD_MS = 1_000;

export function loadAgents({
  proxyFile,
  limiterOptions = {},
}: AgentFactoryOptions = {}): AgentEntry[] {
  if (!proxyFile) {
    return [
      {
        address: null,
        agent: createLocalAgent(),
        limiter: createLimiter(limiterOptions),
        ongoing: 0,
      },
    ];
  }

  return createProxyAgentsFromFile(proxyFile, limiterOptions);
}

function createLimiter({
  maxReqPerPeriod = DEFAULT_MAX_REQ_PER_PERIOD,
  periodMs = DEFAULT_PERIOD_MS,
}: Partial<LimiterOptions> = {}): Bottleneck {
  return new Bottleneck({
    reservoir: maxReqPerPeriod,
    reservoirRefreshAmount: maxReqPerPeriod,
    reservoirRefreshInterval: periodMs,
    minTime: Math.ceil(periodMs / maxReqPerPeriod),
  });
}

function createProxyAgentsFromFile(
  proxyFile: string,
  options: Partial<LimiterOptions>,
): AgentEntry[] {
  const lines = parseProxyFile(proxyFile);
  return lines.map((addr) => ({
    address: addr,
    agent: createProxyAgent(addr),
    limiter: createLimiter(options),
    ongoing: 0,
  }));
}

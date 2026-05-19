import Bottleneck from 'bottleneck';
import { Dispatcher, request as undiciRequest } from 'undici';
import { Agent } from 'undici';
import { createProxyAgent, parseProxyFile } from './proxy';
import { IncomingHttpHeaders } from './types';

const ABORT_CONTROLLER_TIMEOUT_MS = 40_000;
const HEADER_TIMEOUT_MS = 10_000;
const BODY_TIMEOUT_MS = 20_000;
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

let nextAgentId = 1;

export interface AgentResponse {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export interface RequestMetadata {
  url: string;
  durationMs: number;
  proxyAddress: string | null;
}

export class NetworkFetchError extends Error {
  constructor(
    public readonly requestMetadata: RequestMetadata,
    public readonly cause: unknown,
  ) {
    super();
    this.name = 'NetworkFetchError';
  }
}

export interface AgentFetchResult extends AgentResponse {
  requestMetadata: RequestMetadata;
}

export class AgentEntry {
  readonly id: number;
  readonly address: string | null;
  readonly agent: Dispatcher;
  readonly limiter: Bottleneck;
  consecutiveErrors: number = 0;

  constructor(
    id: number,
    address: string | null,
    agent: Dispatcher,
    limiter: Bottleneck,
  ) {
    this.id = id;
    this.address = address;
    this.agent = agent;
    this.limiter = limiter;
  }

  fetch(url: string): Promise<AgentFetchResult> {
    return this.limiter.schedule(() => this.fetchImmediately(url));
  }

  async fetchImmediately(url: string): Promise<AgentFetchResult> {
    const ac = new AbortController();
    const timeout = setTimeout(
      () => ac.abort(new Error('request timed out')),
      ABORT_CONTROLLER_TIMEOUT_MS,
    );
    const fetchStart = Date.now();
    try {
      const response = await this.request(url, ac.signal);
      this.consecutiveErrors = 0;
      return {
        ...response,
        requestMetadata: {
          url,
          durationMs: Date.now() - fetchStart,
          proxyAddress: this.address,
        },
      };
    } catch (cause) {
      this.consecutiveErrors++;
      throw new NetworkFetchError(
        {
          url,
          durationMs: Date.now() - fetchStart,
          proxyAddress: this.address,
        },
        cause,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async request(
    url: string,
    signal: AbortSignal,
  ): Promise<AgentResponse> {
    const {
      statusCode,
      headers,
      body: bodyStream,
    } = await undiciRequest(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
      },
      dispatcher: this.agent,
      signal,
      headersTimeout: HEADER_TIMEOUT_MS,
      bodyTimeout: BODY_TIMEOUT_MS,
    });
    const chunks: Buffer[] = [];
    for await (const chunk of bodyStream as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    return { statusCode, headers, body: Buffer.concat(chunks) };
  }
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
      new AgentEntry(
        nextAgentId++,
        null,
        createLocalAgent(),
        createLimiter(limiterOptions),
      ),
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
  return lines.map(
    (addr) =>
      new AgentEntry(
        nextAgentId++,
        addr,
        createProxyAgent(addr),
        createLimiter(options),
      ),
  );
}

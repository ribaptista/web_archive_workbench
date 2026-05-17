import { request as undiciRequest } from 'undici';
import { loadAgents, type AgentEntry, type LimiterOptions } from './agents';
import { IncomingHttpHeaders } from './types';

export interface AgentPoolOptions {
  proxyFile?: string;
  limiterOptions?: Partial<LimiterOptions>;
  agents?: AgentEntry[];
}

const ABORT_CONTROLLER_TIMEOUT_MS = 40_000;
const HEADER_TIMEOUT_MS = 10_000;
const BODY_TIMEOUT_MS = 20_000;

export interface RequestMetadata {
  url: string;
  durationMs: number;
  proxyAddress: string | null;
}

export type AgentPoolResponse = Response & { requestMetadata: RequestMetadata };

interface Response {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
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

/**
 * Manages a pool of proxy entries.
 * acquire() picks the least-loaded proxy and increments its ongoing counter.
 * release() decrements the ongoing counter when the request is done.
 */
export class AgentPool {
  private readonly agents: AgentEntry[];

  constructor(options: AgentPoolOptions = {}) {
    this.agents = options.agents ?? loadAgents(options);
    if (this.agents.length === 0) {
      throw new Error('AgentPool requires at least one agent');
    }
  }

  private acquire(): AgentEntry {
    const minOngoing = this.agents.reduce(
      (min, a) => Math.min(min, a.ongoing),
      Infinity,
    );
    const candidates = this.agents.filter((a) => a.ongoing === minOngoing);
    const agent = candidates[Math.floor(Math.random() * candidates.length)];
    agent.ongoing++;
    return agent;
  }

  private release(agent: AgentEntry): void {
    agent.ongoing--;
  }

  async fetch(url: string): Promise<AgentPoolResponse> {
    const agent = this.acquire();
    try {
      return await agent.limiter.schedule(() =>
        this.fetchImmediately(url, agent),
      );
    } finally {
      this.release(agent);
    }
  }

  private async fetchImmediately(
    url: string,
    agent: AgentEntry,
  ): Promise<AgentPoolResponse> {
    const ac = new AbortController();
    const timeout = setTimeout(
      () => ac.abort(new Error('request timed out')),
      ABORT_CONTROLLER_TIMEOUT_MS,
    );
    const fetchStart = Date.now();
    try {
      const response = await this.request(url, agent, ac.signal);
      return {
        ...response,
        requestMetadata: {
          url,
          durationMs: Date.now() - fetchStart,
          proxyAddress: agent.address,
        },
      };
    } catch (cause) {
      throw new NetworkFetchError(
        {
          url,
          durationMs: Date.now() - fetchStart,
          proxyAddress: agent.address,
        },
        cause,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async request(
    url: string,
    agent: AgentEntry,
    signal: AbortSignal,
  ): Promise<Response> {
    const {
      statusCode,
      headers,
      body: bodyStream,
    } = await undiciRequest(url, {
      method: 'GET',
      dispatcher: agent.agent,
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

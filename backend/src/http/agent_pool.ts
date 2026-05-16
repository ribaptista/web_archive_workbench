import { request as undiciRequest } from 'undici';
import { type AgentEntry } from './agents';
import { IncomingHttpHeaders } from './types';

const ABORT_CONTROLLER_TIMEOUT_MS = 40_000;
const HEADER_TIMEOUT_MS = 10_000;
const BODY_TIMEOUT_MS = 20_000;

export interface RequestMetadata {
  durationMs: number;
  proxyAddress: string | null;
}

export interface RawResponse {
  url: string;
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  metadata: RequestMetadata;
}

export class NetworkFetchError extends Error {
  constructor(
    public readonly url: string,
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
  constructor(private readonly agents: AgentEntry[]) {}

  private acquire(): AgentEntry {
    const minOngoing = Math.min(...this.agents.map((a) => a.ongoing));
    const candidates = this.agents.filter((a) => a.ongoing === minOngoing);
    const agent = candidates[Math.floor(Math.random() * candidates.length)];
    agent.ongoing++;
    return agent;
  }

  private release(agent: AgentEntry): void {
    agent.ongoing--;
  }

  async fetch(url: string): Promise<RawResponse> {
    const agent = this.acquire();
    const ac = new AbortController();
    const timeout = setTimeout(
      () => ac.abort(new Error('request timed out')),
      ABORT_CONTROLLER_TIMEOUT_MS,
    );
    const fetchStart = Date.now();
    try {
      const { statusCode, headers, body } = await undiciRequest(url, {
        method: 'GET',
        dispatcher: agent.agent,
        signal: ac.signal,
        headersTimeout: HEADER_TIMEOUT_MS,
        bodyTimeout: BODY_TIMEOUT_MS,
      });
      const chunks: Buffer[] = [];
      for await (const chunk of body as AsyncIterable<Buffer>) {
        chunks.push(chunk);
      }
      return {
        url,
        statusCode,
        headers,
        body: Buffer.concat(chunks),
        metadata: {
          durationMs: Date.now() - fetchStart,
          proxyAddress: agent.address,
        },
      };
    } catch (cause) {
      throw new NetworkFetchError(
        url,
        { durationMs: Date.now() - fetchStart, proxyAddress: agent.address },
        cause,
      );
    } finally {
      clearTimeout(timeout);
      this.release(agent);
    }
  }
}

import {
  loadAgents,
  type AgentEntry,
  type LimiterOptions,
  type RequestMetadata,
  type AgentFetchResult,
  NetworkFetchError,
} from './agents';
import { asPlainError } from '../lib/errors';

export interface AgentPoolOptions {
  proxyFile?: string;
  limiterOptions?: Partial<LimiterOptions>;
  agents?: AgentEntry[];
  log?: (message: string) => void;
}

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 60_000;
const BACKOFF_MULTIPLIER = 2;

export { NetworkFetchError, type RequestMetadata } from './agents';

export type AgentPoolResponse = AgentFetchResult;

export interface AgentPoolStats {
  total: number;
  idle: number;
  inflight: number;
  recovering: number;
}

function backoffDelay(consecutiveErrors: number): number {
  const delay =
    BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, consecutiveErrors - 1);
  return Math.min(delay, BACKOFF_MAX_MS);
}

function logError(
  log: (message: string) => void,
  agent: AgentEntry,
  error: unknown,
  delayMs?: number,
): void {
  let causeInfo = '';
  if (error instanceof NetworkFetchError) {
    const { name, code, message } = asPlainError(error.cause);
    causeInfo = ` — ${name}${code ? ` code=${code}` : ''}: ${message}`;
  }
  const delayInfo =
    delayMs === undefined
      ? 'already recovering'
      : `delaying release by ${delayMs}ms`;
  log(
    `Agent #${agent.id} error (consecutive errors: ${agent.consecutiveErrors}), ` +
      `${delayInfo}${causeInfo}`,
  );
}

/**
 * Manages a pool of proxy entries.
 * acquire() picks the least-loaded proxy and increments its ongoing counter.
 * release() decrements the ongoing counter when the request is done.
 */
export class AgentPool {
  private readonly agents: AgentEntry[];
  private readonly log: (message: string) => void;
  private readonly recovering = new Set<AgentEntry>();
  private readonly ongoing = new Map<AgentEntry, number>();
  private waitQueue: Array<(agent: AgentEntry) => void> = [];

  constructor(options: AgentPoolOptions = {}) {
    this.agents = options.agents ?? loadAgents(options);
    this.log = options.log ?? console.log;
    if (this.agents.length === 0) {
      throw new Error('AgentPool requires at least one agent');
    }
  }

  private getOngoing(agent: AgentEntry): number {
    return this.ongoing.get(agent) ?? 0;
  }

  private acquire(): AgentEntry | null {
    const active = this.agents.filter((a) => !this.recovering.has(a));
    if (active.length === 0) return null;
    const agent = this.pickLeastOngoingAgent(active)!;
    this.ongoing.set(agent, this.getOngoing(agent) + 1);
    return agent;
  }

  /**
   * Pick a random agent among those with the lowest ongoing count.
   * Returns undefined iff `agents` is empty.
   */
  private pickLeastOngoingAgent(agents: AgentEntry[]): AgentEntry | undefined {
    if (agents.length === 0) return undefined;
    const minOngoing = agents.reduce(
      (min, a) => Math.min(min, this.getOngoing(a)),
      Infinity,
    );
    const candidates = agents.filter((a) => this.getOngoing(a) === minOngoing);
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  private async acquireOrWait(): Promise<AgentEntry> {
    const agent = this.acquire();
    if (agent) return agent;
    return new Promise((resolve) => this.waitQueue.push(resolve));
  }

  private release(agent: AgentEntry): void {
    this.ongoing.set(agent, this.getOngoing(agent) - 1);
    if (this.waitQueue.length > 0) {
      // Re-pick the best agent rather than handing this one back blindly:
      // the just-released agent may itself still be recovering (release()
      // is also called on the duplicate-failure path of recoverAgent before
      // the backoff timer has cleared `recovering`). If every agent is
      // recovering, `next` is null and the waiter stays queued until a
      // recovery timer fires.
      const next = this.acquire();
      if (next) {
        const waiter = this.waitQueue.shift()!;
        waiter(next);
      }
    }
  }

  private isAgentInFlight(agent: AgentEntry): boolean {
    return this.getOngoing(agent) > 0 && !this.recovering.has(agent);
  }

  getStats(): AgentPoolStats {
    const total = this.agents.length;
    const recovering = this.recovering.size;
    const inflight = this.agents.filter((a) => this.isAgentInFlight(a)).length;
    const idle = total - recovering - inflight;
    return { total, idle, inflight, recovering };
  }

  private recoverAgent(agent: AgentEntry, error: unknown): void {
    // If the agent is already recovering, another concurrent failure has
    // already armed the backoff timer. Re-arming would shorten the effective
    // delay (we'd come out of recovery on whichever timer fires first), so we
    // just release immediately and let the existing timer run its course —
    // the agent will not be picked again until that timer clears `recovering`.
    if (this.recovering.has(agent)) {
      logError(this.log, agent, error);
      this.release(agent);
      return;
    }
    const delay = backoffDelay(agent.consecutiveErrors);
    logError(this.log, agent, error, delay);
    this.recovering.add(agent);
    new Promise((resolve) => setTimeout(resolve, delay))
      .then(() => {
        this.recovering.delete(agent);
        this.release(agent);
      })
      .catch((err) => {
        // Defensive: nothing in the .then body is expected to throw, but if
        // it ever does (e.g., a future logging hook), surface it instead of
        // letting it surface as an unhandled rejection.
        this.log(
          `Agent #${agent.id} recovery handler threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }

  async fetch(url: string): Promise<AgentPoolResponse> {
    const agent = await this.acquireOrWait();
    try {
      const result = await agent.fetch(url);
      this.release(agent);
      return result;
    } catch (error) {
      this.recoverAgent(agent, error);
      throw error;
    }
  }
}

import { RedirectChain } from './redirect_chain';
import { RedirectError } from './types';
import { AgentPool, type RawResponse } from '../agent_pool';
import { resolveLocationHeader } from './header';

export function isRedirect(status: number): boolean {
  return status >= 300 && status <= 399;
}

export class RedirectAwareClient {
  private readonly redirectChain = new RedirectChain();
  private nextUrl: string | undefined;
  private lastResponse: RawResponse | undefined;

  constructor(
    initialUrl: string,
    private readonly pool: AgentPool,
  ) {
    this.nextUrl = initialUrl;
  }

  peekNextLocation(): string | undefined {
    this.ensureRedirectResolved();
    return this.nextUrl;
  }

  canFollowRedirect(): RedirectError | undefined {
    this.ensureRedirectResolved();
    if (this.nextUrl === undefined) {
      throw new Error(
        'RedirectAwareClient: no next URL — check peekNextLocation() first',
      );
    }
    return this.redirectChain.canPush(this.nextUrl);
  }

  // idempotent
  private ensureRedirectResolved() {
    if (this.nextUrl !== undefined) return;

    if (this.lastResponse === undefined)
      throw new Error(
        'RedirectAwareClient: no response to parse — fetchNext() must be called first',
      );

    const { statusCode, headers, url } = this.lastResponse;

    if (!isRedirect(statusCode)) {
      return;
    }

    const resolvedLocation = resolveLocationHeader(statusCode, headers, url);

    this.nextUrl = resolvedLocation;
  }

  async fetchNext(): Promise<RawResponse> {
    const err = this.canFollowRedirect();
    if (err) throw err;

    const url = this.nextUrl!;
    this.nextUrl = undefined;

    this.redirectChain.push(url);

    const response = await this.pool.fetch(url);
    this.lastResponse = response;
    return response;
  }
}

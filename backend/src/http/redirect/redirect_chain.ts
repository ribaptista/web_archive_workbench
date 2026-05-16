import { RedirectError } from './types';

export const MAX_REDIRECT_COUNT = 20;

export class RedirectChain {
  private readonly locations: string[] = [];

  canPush(url: string): RedirectError | undefined {
    if (this.locations.length >= MAX_REDIRECT_COUNT) {
      return new RedirectError(
        'redirect_limit_exceeded',
        `Redirect chain exceeded maximum hop count`,
      );
    }
    if (this.locations.includes(url)) {
      return new RedirectError(
        'redirect_loop',
        `Redirect loop detected: ${url} was already visited`,
      );
    }
    return undefined;
  }

  push(url: string): void {
    const err = this.canPush(url);
    if (err) throw err;
    this.locations.push(url);
  }
}

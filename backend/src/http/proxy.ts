import fs from 'fs';
import { ProxyAgent } from 'undici';

const CONNECT_TIMEOUT_MS = 10_000;
const KEEP_ALIVE_TIMEOUT_MS = 30_000;
const KEEP_ALIVE_MAX_TIMEOUT_MS = 60_000;
const AGENT_CONNECTIONS = 300;

export function createProxyAgent(proxy: string): ProxyAgent {
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

export class EmptyProxyFile extends Error {
  constructor() {
    super('Proxy file is empty');
    this.name = 'EmptyProxyFile';
  }
}

export function parseProxyFile(proxyFile: string): string[] {
  const lines = fs
    .readFileSync(proxyFile, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) throw new EmptyProxyFile();
  return lines;
}

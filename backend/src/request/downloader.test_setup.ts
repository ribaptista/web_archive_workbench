import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { MockAgent, setGlobalDispatcher } from 'undici';
import Bottleneck from 'bottleneck';
import { RequestRepository } from './repository';
import { CdxRepository } from '../cdx/repository';
import { RunRepository } from '../run/repository';
import { AgentPool } from '../http/agent_pool';
import { TestRepository } from './test-repository';

const MIGRATIONS_FOLDER = path.join(__dirname, '../db/migrations');

export function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_FOLDER });
  return sqlite;
}

export function createMockPool(
  intercepts: Record<
    string,
    {
      statusCode: number;
      body: Buffer | string;
      headers: Record<string, string>;
    }
  >,
): { pool: AgentPool; mockAgent: MockAgent } {
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);

  for (const [url, { statusCode, body, headers }] of Object.entries(
    intercepts,
  )) {
    const parsed = new URL(url);
    mockAgent
      .get(parsed.origin)
      .intercept({ path: parsed.pathname + parsed.search, method: 'GET' })
      .reply(statusCode, body, { headers });
  }

  const pool = new AgentPool({
    agents: [
      {
        address: null,
        agent: mockAgent,
        limiter: new Bottleneck(),
        ongoing: 0,
      },
    ],
  });

  return { pool, mockAgent };
}

export function seedResourceVersion(
  cdxRepo: CdxRepository,
  domainName: string,
  original: string,
  timestamp: number,
): void {
  const normalizedUrl = new URL(original).host + new URL(original).pathname;
  cdxRepo.insertTreeNodePaths([normalizedUrl]);
  cdxRepo.insertOrIgnoreResource(original, normalizedUrl);
  cdxRepo.insertOrIgnoreResourceVersion(original, timestamp);
  cdxRepo.insertOrIgnoreResourceVersionSource(original, timestamp, domainName);
}

export interface DownloaderTestContext {
  db: ReturnType<typeof createTestDb>;
  reqRepo: RequestRepository;
  cdxRepo: CdxRepository;
  runRepo: RunRepository;
  testRepo: TestRepository;
  runId: string;
  outputFolder: string;
  mockAgent: MockAgent | undefined;
  pool: AgentPool | undefined;
}

export const domainName = 'example.com';
export const normalizedDomain = 'example.com';
export const replayBaseUrl = 'https://web.archive.org/web/';

export function registerDownloaderHooks(ctx: DownloaderTestContext) {
  beforeEach(() => {
    ctx.db = createTestDb();
    ctx.reqRepo = new RequestRepository(ctx.db);
    ctx.cdxRepo = new CdxRepository(ctx.db);
    ctx.runRepo = new RunRepository(ctx.db);
    ctx.testRepo = new TestRepository(ctx.db);

    ctx.runId = randomUUID();
    ctx.runRepo.insertRun(ctx.runId);
    ctx.cdxRepo.insertOrIgnoreDomain(domainName, ctx.runId, normalizedDomain);

    ctx.outputFolder = `/tmp/${randomUUID()}/`;
    fs.mkdirSync(ctx.outputFolder, { recursive: true });

    ctx.mockAgent = undefined;
    ctx.pool = undefined;
  });

  afterEach(async () => {
    ctx.db.close();
    await ctx.mockAgent?.close().catch(() => {});
    fs.rmSync(ctx.outputFolder, { recursive: true, force: true });
  });
}

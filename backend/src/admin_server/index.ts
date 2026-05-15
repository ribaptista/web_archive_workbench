import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { openDatabase } from '../db/conn';
import { CdxRepository } from '../cdx/repository';
import { RunRepository } from '../run/repository';
import { RequestRepository } from '../request/repository';
import { SearchRepository } from '../search/repository';
import { ReactionRepository } from '../reaction/repository';
import { registerDomainRoutes } from './controllers/domain';
import { registerRunRoutes } from './controllers/run';
import { registerSearchRoutes } from './controllers/search';
import { registerReactionRoutes } from './controllers/reactions';
import { registerCdxRoutes } from './controllers/cdx';

const PORT = 5050;

async function main(): Promise<void> {
  const argv = yargs(hideBin(process.argv))
    .option('db', {
      type: 'string',
      description: 'Path to the SQLite database',
      demandOption: true,
    })
    .option('base-folder', {
      alias: 'b',
      type: 'string',
      description: 'Base folder containing domain asset directories',
      demandOption: true,
    })
    .option('max-workers', {
      alias: 'w',
      type: 'number',
      description: 'Number of parallel worker threads for file search',
      default: 16,
    })
    .option('context-size', {
      type: 'number',
      description: 'Number of characters of context around each match',
      default: 64,
    })
    .parseSync();

  const dbPath = argv.db;
  const baseFolder = argv['base-folder'];
  const maxWorkers = argv['max-workers'];
  const contextSize = argv['context-size'];

  const db = openDatabase(dbPath);
  const cdxRepo = new CdxRepository(db);
  const runRepo = new RunRepository(db);
  const reqRepo = new RequestRepository(db);
  const searchRepo = new SearchRepository(db);
  const reactionRepo = new ReactionRepository(db);

  const fastify = Fastify({ logger: true });
  await fastify.register(formbody);

  void fastify.register((f) => registerDomainRoutes(f, cdxRepo), {
    prefix: '/api/domains',
  });
  void fastify.register((f) => registerRunRoutes(f, runRepo), {
    prefix: '/api/runs',
  });
  void fastify.register(
    (f) =>
      registerSearchRoutes(f, searchRepo, cdxRepo, reqRepo, reactionRepo, {
        dbPath: db.name,
        baseFolder,
        maxWorkers,
        contextSize,
      }),
    { prefix: '/api/searches' },
  );
  void fastify.register((f) => registerReactionRoutes(f, reactionRepo), {
    prefix: '/reactions',
  });
  registerCdxRoutes(fastify, cdxRepo);

  await fastify.listen({ port: PORT, host: '127.0.0.1' });
  console.log(`Admin server listening on http://localhost:${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

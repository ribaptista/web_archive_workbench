import Fastify from 'fastify';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { openDatabase } from '../db/conn';
import { CdxRepository } from '../cdx/repository';
import { registerReplayRoutes } from './controllers/replay';
import { registerFromRefererRoutes } from './controllers/from_referer';
import { registerLocalhostRewriteRoutes } from './controllers/localhost_rewrite';

const PORT = 5051;

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('db', {
      alias: 'd',
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
    .option('admin-url', {
      type: 'string',
      description: 'Base URL of the admin server',
      default: 'http://localhost:3000',
    })
    .parseSync();

  const dbPath = argv.db;
  const baseFolder = argv['base-folder'];

  const db = openDatabase(dbPath);
  const cdxRepo = new CdxRepository(db);

  const replayBaseUrl = `http://localhost:${PORT}`;

  const fastify = Fastify({ logger: true });
  fastify.addHook('onSend', async (_req, reply) => {
    reply.header('Referrer-Policy', 'unsafe-url');
  });

  void fastify.register(
    (f) => {
      registerFromRefererRoutes(f, replayBaseUrl);
      registerReplayRoutes(f, cdxRepo, baseFolder);
    },
    { prefix: '/replay' },
  );
  registerLocalhostRewriteRoutes(fastify, replayBaseUrl);

  await fastify.listen({ port: PORT, host: '127.0.0.1' });
  console.error(`Listening on http://localhost:${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

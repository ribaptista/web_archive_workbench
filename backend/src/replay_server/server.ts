import path from 'path';
import Fastify from 'fastify';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { openDatabase, DB_FILENAME } from '../db/conn';
import { CdxRepository } from '../cdx/repository';
import { registerReplayRoutes } from './controllers/replay';
import { registerFromRefererRoutes } from './controllers/from_referer';
import { registerLocalhostRewriteRoutes } from './controllers/localhost_rewrite';

const PORT = 5051;

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('data-folder', {
      alias: 'b',
      type: 'string',
      description:
        'Data folder containing the archive database and domain asset directories',
      demandOption: true,
    })
    .option('admin-url', {
      type: 'string',
      description: 'Base URL of the admin server',
      default: 'http://localhost:3000',
    })
    .parseSync();

  const dataFolder = argv['data-folder'];
  const dbPath = path.join(dataFolder, DB_FILENAME);
  const baseFolder = dataFolder;

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

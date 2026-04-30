import path from 'path';
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { Eta } from 'eta';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { openDatabase } from './db';
import {
  ensureAdminTables,
  runSearch,
  type SearchConditionInput,
} from './run_search_handler';
import { renderSearchResults } from './search_results_handler';
import { renderSearches, deleteSearch } from './searches_handler';
import { setReaction } from './reaction';
import { renderResources } from './resources_handler';
import { renderListVersions } from './list_versions_handler';
import { getPathParts } from './tree-node-utils';

const PORT = 5050;

function toArray(val: unknown): string[] {
  if (val === null || val === undefined) return [];
  if (Array.isArray(val)) return (val as unknown[]).map(String);
  return [String(val)];
}

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
    .option('encoding', {
      alias: 'e',
      type: 'string',
      description:
        'Character encoding for reading asset files (e.g. utf8, latin1)',
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
  const charEncoding = argv.encoding;
  const maxWorkers = argv['max-workers'];
  const contextSize = argv['context-size'];

  const db = openDatabase(dbPath);
  ensureAdminTables(db);

  const eta = new Eta({
    views: path.join(__dirname, 'templates'),
    cache: false,
  });

  const fastify = Fastify({ logger: true });
  await fastify.register(formbody);

  fastify.get('/', async (_request, reply) => {
    const domains = db
      .prepare<
        [],
        { id: string; domain: string }
      >(`SELECT id, domain FROM cdx_file ORDER BY domain`)
      .all();
    const html =
      eta.render('./search_form', { domains }) ?? '<h1>Template error</h1>';
    return reply.type('text/html').send(html);
  });

  fastify.post('/run_search', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const regexList = toArray(body['regex[]']);
    const notRegexNearbyList = toArray(body['not_regex_nearby[]']);
    const cdxFileIdList = toArray(body['cdx_file_id[]']).filter(Boolean);
    const conditionInputs: SearchConditionInput[] = [];
    for (let i = 0; i < regexList.length; i++) {
      const regexStr = regexList[i].trim();
      if (!regexStr) continue;
      let regex: RegExp;
      try {
        regex = new RegExp(regexStr, 'gi');
      } catch {
        return reply
          .code(400)
          .send(`Invalid regex at condition ${i + 1}: ${regexStr}`);
      }
      let notRegexNearby: RegExp | undefined;
      const notStr = notRegexNearbyList[i]?.trim();
      if (notStr) {
        try {
          notRegexNearby = new RegExp(notStr, 'i');
        } catch {
          return reply
            .code(400)
            .send(`Invalid not_regex_nearby at condition ${i + 1}: ${notStr}`);
        }
      }
      conditionInputs.push({ regex, notRegexNearby });
    }

    const searchId = await runSearch(conditionInputs, charEncoding, {
      db,
      baseFolder,
      maxWorkers,
      contextSize,
      cdxFileIds: cdxFileIdList,
    });

    return reply.redirect(`/search_results?search_id=${searchId}`, 302);
  });

  fastify.get('/searches', async (_request, reply) => {
    const html = renderSearches(db, eta);
    return reply.type('text/html').send(html);
  });

  fastify.post('/searches/:id/delete', async (request, reply) => {
    const { id } = request.params as { id: string };
    const searchId = Number(id);
    if (!Number.isFinite(searchId)) {
      return reply.code(400).send('Invalid search id');
    }
    deleteSearch(db, searchId);
    return reply.redirect('/searches', 302);
  });

  fastify.get('/search_results', async (request, reply) => {
    const query = request.query as {
      search_id?: string;
      page?: string;
      similar_to?: string;
      'domain[]'?: string | string[];
      'condition_id[]'?: string | string[];
      'reaction_type_id[]'?: string | string[];
    };
    const searchId = query.search_id ? Number(query.search_id) : NaN;
    if (!Number.isFinite(searchId)) {
      return reply.code(400).send('Missing or invalid search_id');
    }
    const page = query.page ? Math.max(1, Number(query.page)) : 1;
    const similarTo = query.similar_to?.trim() || undefined;
    const filterDomains = toArray(query['domain[]']).filter(Boolean);
    const filterConditionIds = toArray(query['condition_id[]'])
      .map(Number)
      .filter(Number.isFinite);
    const filterReactionTypeIds = toArray(query['reaction_type_id[]'])
      .map(Number)
      .filter(Number.isFinite);

    const html = renderSearchResults(
      searchId,
      page,
      db,
      eta,
      baseFolder,
      similarTo,
      filterDomains,
      filterConditionIds,
      filterReactionTypeIds,
    );
    return reply.type('text/html').send(html);
  });

  fastify.post('/reactions', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const bodyDigest = String(body.body_digest ?? '').trim();
    const reactionTypeId = Number(body.reaction_type_id);
    const active = Boolean(body.active);
    if (!bodyDigest || !Number.isFinite(reactionTypeId)) {
      return reply
        .code(400)
        .send({ error: 'Invalid body_digest or reaction_type_id' });
    }
    const typeExists = db
      .prepare<
        [number],
        { id: number }
      >(`SELECT id FROM reaction_type WHERE id = ?`)
      .get(reactionTypeId);
    if (!typeExists) {
      return reply.code(400).send({ error: 'Unknown reaction_type_id' });
    }
    return reply.send(setReaction(db, bodyDigest, reactionTypeId, active));
  });

  fastify.get('/resources', async (request, reply) => {
    const query = request.query as {
      path?: string;
      url?: string;
      level?: string;
    };
    let filterPath: string | null = query.path?.trim() || null;
    let filterLevel = filterPath !== null ? Number(query.level) : 0;
    const urlParam = query.url?.trim();
    if (urlParam) {
      try {
        const parts = getPathParts(urlParam);
        if (parts.length >= 2) {
          filterPath = parts.slice(0, parts.length - 1).join('');
          filterLevel = parts.length - 2;
        } else {
          filterPath = parts[0];
          filterLevel = 0;
        }
      } catch {
        return reply.code(400).send('Invalid url parameter');
      }
    }
    const html = renderResources(db, eta, filterPath, filterLevel);
    return reply.type('text/html').send(html);
  });

  fastify.get('/list_versions', async (request, reply) => {
    const query = request.query as { url?: string };
    const url = query.url?.trim() || '';
    if (!url) return reply.code(400).send('Missing url');
    const html = renderListVersions(db, eta, url);
    return reply.type('text/html').send(html);
  });

  await fastify.listen({ port: PORT, host: '127.0.0.1' });
  console.log(`Admin server listening on http://localhost:${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

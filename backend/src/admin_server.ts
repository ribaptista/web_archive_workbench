import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { openDatabase } from './db';
import {
  ensureAdminTables,
  runSearch,
  type SearchConditionInput,
} from './run_search_handler';
import { getSearchResultsData } from './search_results_handler';
import { deleteSearch, getSearchesData } from './searches_handler';
import { setReaction } from './reaction';
import { getResourcesData } from './resources_handler';
import { getListVersionsData } from './list_versions_handler';
import { getReactionsViewData } from './reactions_view_handler';
import { getDomainsStats } from './domains_handler';
import {
  getDomainErrorsData,
  getDomainErrorFilters,
} from './domain_errors_handler';
import { getRunsData } from './runs_handler';

const PORT = 5050;

class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

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
  ensureAdminTables(db);

  const fastify = Fastify({ logger: true });
  await fastify.register(formbody);

  function getDomains(): { id: string; domain: string }[] {
    return db
      .prepare<
        [],
        { id: string; domain: string }
      >(`SELECT id, domain FROM cdx_file ORDER BY domain`)
      .all();
  }

  fastify.get('/api/domains', async (_request, reply) => {
    return reply.send(getDomains());
  });

  fastify.get('/api/domains_stats', async (_request, reply) => {
    return reply.send(getDomainsStats(db));
  });

  fastify.get('/api/domain_error_filters', async (request, reply) => {
    const query = request.query as { domain?: string };
    const domain = query.domain?.trim() || '';
    if (!domain) return reply.code(400).send({ error: 'Missing domain' });
    return reply.send(getDomainErrorFilters(db, domain));
  });

  fastify.get('/api/domain_errors', async (request, reply) => {
    const query = request.query as {
      domain?: string;
      'error_code[]'?: string | string[];
      'error_name[]'?: string | string[];
      cursor_url?: string;
      cursor_ts?: string;
    };
    const domain = query.domain?.trim() || '';
    if (!domain) return reply.code(400).send({ error: 'Missing domain' });
    const filterCodes = toArray(query['error_code[]']).filter(Boolean);
    const filterNames = toArray(query['error_name[]']).filter(Boolean);
    const cursorUrl = query.cursor_url?.trim() || null;
    const cursorTs = query.cursor_ts ? Number(query.cursor_ts) : null;
    return reply.send(
      getDomainErrorsData(
        db,
        domain,
        filterCodes,
        filterNames,
        cursorUrl,
        cursorTs,
      ),
    );
  });

  fastify.get('/api/runs', async (_request, reply) => {
    return reply.send(getRunsData(db));
  });

  type RunSearchParams = {
    conditionInputs: SearchConditionInput[];
    cdxFileIds: string[];
  };

  function parseRunSearchBody(body: Record<string, unknown>): RunSearchParams {
    const regexList = toArray(body['regex[]']);
    const notRegexNearbyList = toArray(body['not_regex_nearby[]']);
    const cdxFileIds = toArray(body['cdx_file_id[]']).filter(Boolean);
    const conditionInputs: SearchConditionInput[] = [];
    for (let i = 0; i < regexList.length; i++) {
      const regexStr = regexList[i].trim();
      if (!regexStr) continue;
      let regex: RegExp;
      try {
        regex = new RegExp(regexStr, 'gi');
      } catch {
        throw new BadRequestError(
          `Invalid regex at condition ${i + 1}: ${regexStr}`,
        );
      }
      let notRegexNearby: RegExp | undefined;
      const notStr = notRegexNearbyList[i]?.trim();
      if (notStr) {
        try {
          notRegexNearby = new RegExp(notStr, 'i');
        } catch {
          throw new BadRequestError(
            `Invalid not_regex_nearby at condition ${i + 1}: ${notStr}`,
          );
        }
      }
      conditionInputs.push({ regex, notRegexNearby });
    }
    return { conditionInputs, cdxFileIds };
  }

  fastify.post('/api/run_search', async (request, reply) => {
    let parsed: RunSearchParams;
    try {
      parsed = parseRunSearchBody(request.body as Record<string, unknown>);
    } catch (err) {
      if (err instanceof BadRequestError)
        return reply.code(400).send({ error: err.message });
      return reply.code(500).send({ error: 'Internal server error' });
    }

    const searchId = await runSearch(parsed.conditionInputs, {
      db,
      baseFolder,
      maxWorkers,
      contextSize,
      cdxFileIds: parsed.cdxFileIds,
    });

    return reply.send({ searchId });
  });

  function parseSearchId(id: string): number {
    const searchId = Number(id);
    if (!Number.isFinite(searchId))
      throw new BadRequestError('Invalid search id');
    return searchId;
  }

  fastify.delete('/api/searches/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      deleteSearch(db, parseSearchId(id));
    } catch (err) {
      if (err instanceof BadRequestError)
        return reply.code(400).send({ error: err.message });
      return reply.code(500).send({ error: 'Internal server error' });
    }
    return reply.code(204).send();
  });

  function parseSearchResultsQuery(query: {
    search_id?: string;
    cursor_timestamp?: string;
    cursor_request_id?: string;
    similar_to?: string;
    'domain[]'?: string | string[];
    'condition_id[]'?: string | string[];
    'reaction_type_id[]'?: string | string[];
  }) {
    const searchId = query.search_id ? Number(query.search_id) : NaN;
    const cursorTimestamp = query.cursor_timestamp
      ? Number(query.cursor_timestamp)
      : undefined;
    const cursorRequestId = query.cursor_request_id?.trim() || undefined;
    const similarTo = query.similar_to?.trim() || undefined;
    const filterDomains = toArray(query['domain[]']).filter(Boolean);
    const filterConditionIds = toArray(query['condition_id[]'])
      .map(Number)
      .filter(Number.isFinite);
    const filterReactionTypeIds = toArray(query['reaction_type_id[]'])
      .map(Number)
      .filter(Number.isFinite);
    return {
      searchId,
      cursorTimestamp,
      cursorRequestId,
      similarTo,
      filterDomains,
      filterConditionIds,
      filterReactionTypeIds,
    };
  }

  fastify.post('/reactions', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const url = String(body.resource_version_url ?? '').trim();
    const timestamp = Number(body.resource_version_timestamp);
    const reactionTypeId = Number(body.reaction_type_id);
    const active = Boolean(body.active);
    if (
      !url ||
      !Number.isFinite(timestamp) ||
      !Number.isFinite(reactionTypeId)
    ) {
      return reply.code(400).send({
        error:
          'Invalid resource_version_url, resource_version_timestamp, or reaction_type_id',
      });
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
    return reply.send(setReaction(db, url, timestamp, reactionTypeId, active));
  });

  fastify.get('/api/searches', async (_request, reply) => {
    return reply.send(getSearchesData(db));
  });

  fastify.get('/api/search_results', async (request, reply) => {
    const query = request.query as {
      search_id?: string;
      cursor_timestamp?: string;
      cursor_request_id?: string;
      similar_to?: string;
      'domain[]'?: string | string[];
      'condition_id[]'?: string | string[];
      'reaction_type_id[]'?: string | string[];
    };
    const {
      searchId,
      cursorTimestamp,
      cursorRequestId,
      similarTo,
      filterDomains,
      filterConditionIds,
      filterReactionTypeIds,
    } = parseSearchResultsQuery(query);
    if (!Number.isFinite(searchId)) {
      return reply.code(400).send({ error: 'Missing or invalid search_id' });
    }
    const data = getSearchResultsData(
      searchId,
      cursorTimestamp,
      cursorRequestId,
      db,
      baseFolder,
      similarTo,
      filterDomains,
      filterConditionIds,
      filterReactionTypeIds,
    );
    if (!data) return reply.code(404).send({ error: 'Search not found' });
    return reply.send(data);
  });

  fastify.get('/api/resources', async (request, reply) => {
    const query = request.query as {
      path?: string;
      level?: string;
      cursor?: string;
    };
    const filterPath: string | null = query.path?.trim() || null;
    const filterLevel = filterPath !== null ? Number(query.level) : 0;
    const cursor: string | null = query.cursor?.trim() || null;
    return reply.send(getResourcesData(db, filterPath, filterLevel, cursor));
  });

  fastify.get('/api/list_versions', async (request, reply) => {
    const query = request.query as { url?: string; cursor?: string };
    const url = query.url?.trim() || '';
    if (!url) return reply.code(400).send({ error: 'Missing url' });
    const cursor = query.cursor ? Number(query.cursor) : null;
    return reply.send(getListVersionsData(db, url, cursor));
  });

  fastify.get('/api/reactions_view', async (request, reply) => {
    const query = request.query as {
      reaction_type_id?: string;
      page?: string;
      'domain[]'?: string | string[];
    };
    const reactionTypeId = Number(query.reaction_type_id);
    if (!Number.isFinite(reactionTypeId) || reactionTypeId <= 0) {
      return reply
        .code(400)
        .send({ error: 'Missing or invalid reaction_type_id' });
    }
    const page = query.page ? Math.max(1, Number(query.page)) : 1;
    const filterDomains = toArray(query['domain[]']).filter(Boolean);
    return reply.send(
      getReactionsViewData(db, reactionTypeId, page, filterDomains),
    );
  });

  await fastify.listen({ port: PORT, host: '127.0.0.1' });
  console.log(`Admin server listening on http://localhost:${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import type { FastifyInstance } from 'fastify';
import type { SearchRepository } from '../../search/repository';
import type { CdxRepository } from '../../cdx/repository';
import type { RequestRepository } from '../../request/repository';
import type { ReactionRepository } from '../../reaction/repository';
import { runSearch } from '../../search/search_launcher';
import { WorkerPool } from '../../worker/worker_pool';
import { type SearchConditionInput } from '../../search/types';
import { getSearchResultsData } from '../../search/search_results';
import { deleteSearch, getSearchesData } from '../../search/search';
import { BadRequestError, toArray } from './common';

export interface SearchControllerOptions {
  baseFolder: string;
  contextSize: number;
}

type RunSearchParams = {
  conditionInputs: SearchConditionInput[];
  domainNames: string[];
};

function parseRunSearchBody(body: Record<string, unknown>): RunSearchParams {
  const regexList = toArray(body['regex[]']);
  const notRegexNearbyList = toArray(body['not_regex_nearby[]']);
  const domainNames = toArray(body['cdx_file_id[]']).filter(Boolean);
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
  return { conditionInputs, domainNames };
}

function parseSearchId(id: string): number {
  const searchId = Number(id);
  if (!Number.isFinite(searchId))
    throw new BadRequestError('Invalid search id');
  return searchId;
}

function parseSearchResultsQuery(query: {
  cursor_timestamp?: string;
  cursor_request_id?: string;
  similar_to?: string;
  'domain[]'?: string | string[];
  'condition_id[]'?: string | string[];
  'reaction_type_id[]'?: string | string[];
}) {
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
    cursorTimestamp,
    cursorRequestId,
    similarTo,
    filterDomains,
    filterConditionIds,
    filterReactionTypeIds,
  };
}

export function registerSearchRoutes(
  fastify: FastifyInstance,
  searchRepo: SearchRepository,
  cdxRepo: CdxRepository,
  reqRepo: RequestRepository,
  reactionRepo: ReactionRepository,
  pool: WorkerPool,
  opts: SearchControllerOptions,
): void {
  const { baseFolder, contextSize } = opts;

  fastify.post('/', async (request, reply) => {
    let parsed: RunSearchParams;
    try {
      parsed = parseRunSearchBody(request.body as Record<string, unknown>);
    } catch (err) {
      if (err instanceof BadRequestError)
        return reply.code(400).send({ error: err.message });
      return reply.code(500).send({ error: 'Internal server error' });
    }
    const searchId = await runSearch(
      pool,
      parsed.conditionInputs,
      parsed.domainNames,
      searchRepo,
      cdxRepo,
      baseFolder,
      contextSize,
    );
    return reply.send({ searchId });
  });

  fastify.get('/', async (_request, reply) => {
    return reply.send(getSearchesData(searchRepo));
  });

  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      deleteSearch(searchRepo, parseSearchId(id));
    } catch (err) {
      if (err instanceof BadRequestError)
        return reply.code(400).send({ error: err.message });
      return reply.code(500).send({ error: 'Internal server error' });
    }
    return reply.code(204).send();
  });

  fastify.get('/:search_id/results', async (request, reply) => {
    const { search_id } = request.params as { search_id: string };
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
      cursorTimestamp,
      cursorRequestId,
      similarTo,
      filterDomains,
      filterConditionIds,
      filterReactionTypeIds,
    } = parseSearchResultsQuery(query);
    const searchId = Number(search_id);
    if (!Number.isFinite(searchId)) {
      return reply.code(400).send({ error: 'Missing or invalid search_id' });
    }
    const data = getSearchResultsData(
      searchId,
      cursorTimestamp,
      cursorRequestId,
      searchRepo,
      reactionRepo,
      cdxRepo,
      reqRepo,
      baseFolder,
      similarTo,
      filterDomains,
      filterConditionIds,
      filterReactionTypeIds,
    );
    if (!data) return reply.code(404).send({ error: 'Search not found' });
    return reply.send(data);
  });
}

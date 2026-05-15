import type { FastifyInstance } from 'fastify';
import type { CdxRepository } from '../../cdx/repository';
import { getDomainsStats } from '../../cdx/domains_stats';
import {
  getDomainErrorsData,
  getDomainErrorFilters,
} from '../../cdx/domain_errors';
import { toArray } from './common';

export function registerDomainRoutes(
  fastify: FastifyInstance,
  cdxRepo: CdxRepository,
): void {
  fastify.get('/', async (_request, reply) => {
    return reply.send(cdxRepo.findAllDomains());
  });

  fastify.get('/stats', async (_request, reply) => {
    return reply.send(getDomainsStats(cdxRepo));
  });

  fastify.get('/error_filters', async (request, reply) => {
    const query = request.query as { domain?: string };
    const domain = query.domain?.trim() || '';
    if (!domain) return reply.code(400).send({ error: 'Missing domain' });
    return reply.send(getDomainErrorFilters(cdxRepo, domain));
  });

  fastify.get('/errors', async (request, reply) => {
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
        cdxRepo,
        domain,
        filterCodes,
        filterNames,
        cursorUrl,
        cursorTs,
      ),
    );
  });
}

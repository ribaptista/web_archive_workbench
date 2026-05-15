import type { FastifyInstance } from 'fastify';
import type { CdxRepository } from '../../cdx/repository';
import { getResourcesData } from '../../cdx/resource_tree';
import { getListVersionsData } from '../../cdx/resource_versions';
import { normalizeUrl } from '../../http/url';

export function registerCdxRoutes(
  fastify: FastifyInstance,
  cdxRepo: CdxRepository,
): void {
  fastify.get('/api/resources', async (request, reply) => {
    const query = request.query as {
      path?: string;
      level?: string;
      cursor?: string;
    };
    const filterPath: string | null = query.path?.trim() || null;
    const filterLevel = filterPath !== null ? Number(query.level) : 0;
    const cursor: string | null = query.cursor?.trim() || null;
    return reply.send(
      getResourcesData(cdxRepo, filterPath, filterLevel, cursor),
    );
  });

  fastify.get('/api/list_versions', async (request, reply) => {
    const query = request.query as {
      url?: string;
      originalUrl?: string;
      cursor?: string;
    };
    let url: string;
    if (query.originalUrl?.trim()) {
      url = normalizeUrl(query.originalUrl.trim());
    } else {
      url = query.url?.trim() || '';
    }
    if (!url)
      return reply.code(400).send({ error: 'Missing url or originalUrl' });
    const cursor = query.cursor ? Number(query.cursor) : null;
    return reply.send(getListVersionsData(cdxRepo, url, cursor));
  });
}

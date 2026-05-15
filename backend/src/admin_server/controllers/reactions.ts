import type { FastifyInstance } from 'fastify';
import type { ReactionRepository } from '../../reaction/repository';
import { setReaction, getReactionsViewData } from '../../reaction/reaction';
import { toArray } from './common';

export function registerReactionRoutes(
  fastify: FastifyInstance,
  reactionRepo: ReactionRepository,
): void {
  fastify.post('/', async (request, reply) => {
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
    const typeExists = reactionRepo.findTypeById(reactionTypeId);
    if (!typeExists) {
      return reply.code(400).send({ error: 'Unknown reaction_type_id' });
    }
    return reply.send(
      setReaction(reactionRepo, url, timestamp, reactionTypeId, active),
    );
  });

  fastify.get('/', async (request, reply) => {
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
      getReactionsViewData(reactionRepo, reactionTypeId, page, filterDomains),
    );
  });
}

import type { FastifyInstance } from 'fastify';
import type { RunRepository } from '../../run/repository';
import { getRunsData } from '../../run/run';

export function registerRunRoutes(
  fastify: FastifyInstance,
  runRepo: RunRepository,
): void {
  fastify.get('/', async (_request, reply) => {
    return reply.send(getRunsData(runRepo));
  });
}

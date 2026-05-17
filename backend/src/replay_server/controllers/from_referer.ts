import type { FastifyInstance } from 'fastify';

const replayPathRe = /^(\d+)\/(.+)$/s;

export function registerFromRefererRoutes(
  fastify: FastifyInstance,
  replayBaseUrl: string,
): void {
  const replayPrefix = `${replayBaseUrl}/replay/`;

  fastify.get<{ Params: { '*': string } }>(
    '/from_referer/*',
    async (request, reply) => {
      const original = request.params['*'];
      const referer = request.headers['referer'];

      if (!referer) {
        console.error('[replay] 404 from_referer: no Referer header');
        return reply.code(404).send('Not found');
      }

      if (!referer.startsWith(replayPrefix)) {
        console.error(
          `[replay] 404 from_referer: ${request.url} Referer does not match replay pattern: ${referer}`,
        );
        return reply.code(404).send('Not found');
      }

      const refMatch = referer.slice(replayPrefix.length).match(replayPathRe);
      if (!refMatch) {
        console.error(
          `[replay] 404 from_referer: ${request.url} Referer does not match replay pattern: ${referer}`,
        );
        return reply.code(404).send('Not found');
      }

      const timestamp = refMatch[1];
      const redirectUrl = `${replayBaseUrl}/replay/${timestamp}/${original}`;
      console.info(`[replay] 302 from_referer: ${original} → ${redirectUrl}`);
      return reply.redirect(redirectUrl, 302);
    },
  );
}

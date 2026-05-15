import type { FastifyInstance } from 'fastify';

const replayPathRe = /^(\d+)\/(.+)$/s;

export function registerLocalhostRewriteRoutes(
  fastify: FastifyInstance,
  replayBaseUrl: string,
): void {
  const replayPrefix = `${replayBaseUrl}/replay/`;

  // Catch-all: rewrite localhost requests using the Referer replay context
  fastify.get('/*', async (request, reply) => {
    const referer = request.headers['referer'];
    if (!referer?.startsWith(replayPrefix)) {
      console.error(
        `[replay] localhost original but no valid referer: ${request.url} referer=${request.headers['referer']}`,
      );
      return reply.code(404).send('Not found');
    }

    const refMatch = referer.slice(replayPrefix.length).match(replayPathRe);
    if (!refMatch) {
      console.error(
        `[replay] localhost original but no valid referer: ${request.url} referer=${request.headers['referer']}`,
      );
      return reply.code(404).send('Not found');
    }

    const timestamp = refMatch[1];
    const replayedUrl = refMatch[2];
    const replayedOrigin = new URL(replayedUrl).origin;
    const pathAndQuery = request.url;
    const rewritten = replayedOrigin + pathAndQuery;
    const redirectUrl = `${replayBaseUrl}/replay/${timestamp}/${rewritten}`;
    console.error(
      `[replay] 302 localhost rewrite: ${request.url} → ${redirectUrl}`,
    );
    return reply.redirect(redirectUrl, 302);
  });
}

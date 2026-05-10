import * as fs from 'fs';
import { createHash } from 'crypto';

export const DIGEST_CONTEXT_LENGTH = 256;

export interface SearchCondition {
  id: number;
  regex: RegExp;
  notRegexNearby: RegExp | null;
  contextSize: number;
}

export interface FileMatch {
  conditionId: number;
  matchOffset: number;
  matchLength: number;
}

function matchCondition(
  content: string,
  condition: SearchCondition,
): FileMatch[] {
  const results: FileMatch[] = [];
  const mainRe = condition.regex;
  const notRe = condition.notRegexNearby;

  mainRe.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = mainRe.exec(content)) !== null) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;

    if (notRe !== null) {
      const ctxStart = Math.max(0, matchStart - condition.contextSize);
      const ctxEnd = Math.min(content.length, matchEnd + condition.contextSize);
      const context = content.slice(ctxStart, ctxEnd);
      if (notRe.test(context)) {
        if (match[0].length === 0) mainRe.lastIndex++;
        continue;
      }
    }

    results.push({
      conditionId: condition.id,
      matchOffset: matchStart,
      matchLength: match[0].length,
    });

    if (match[0].length === 0) mainRe.lastIndex++;
  }

  return results;
}

export type FileMatches = {
  matches: FileMatch[];
  contextDigest: string;
};

export function getFileMatches(
  filePath: string,
  conditions: SearchCondition[],
): FileMatches {
  const content = fs.readFileSync(filePath, 'utf8');
  const matches = conditions.flatMap((condition) =>
    matchCondition(content, condition),
  );

  const hash = createHash('sha256');
  for (const m of matches) {
    const ctxStart = Math.max(0, m.matchOffset - DIGEST_CONTEXT_LENGTH);
    const ctxEnd = Math.min(
      content.length,
      m.matchOffset + m.matchLength + DIGEST_CONTEXT_LENGTH,
    );
    hash.update(content.slice(ctxStart, ctxEnd));
  }
  const contextDigest = hash.digest('base64url');
  return { matches, contextDigest };
}

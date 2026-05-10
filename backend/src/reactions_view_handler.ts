import type { Database as DB } from 'better-sqlite3';

const PAGE_SIZE = 20;

interface ReactionTypeRow {
  id: number;
  label: string;
  emoji: string;
}

interface DomainRow {
  id: string;
  domain: string;
}

interface ReactionViewFileRow {
  resource_version_url: string;
  resource_version_timestamp: number;
  request_id: string;
  original: string;
  timestamp: string;
}

interface MatchedConditionRow {
  resource_version_url: string;
  resource_version_timestamp: number;
  condition_id: number;
  regex: string;
  not_regex_nearby: string | null;
}

export function getReactionsViewData(
  db: DB,
  reactionTypeId: number,
  page: number,
  filterDomains?: string[],
) {
  const reactionTypes = db
    .prepare<
      [],
      ReactionTypeRow
    >(`SELECT id, label, emoji FROM reaction_type ORDER BY id`)
    .all();

  const domains = db
    .prepare<[number], DomainRow>(
      `SELECT DISTINCT cf.id, cf.domain
       FROM reaction rx
       INNER JOIN resource_version_source rvs
         ON rvs.url = rx.resource_version_url
        AND rvs.timestamp = rx.resource_version_timestamp
       INNER JOIN cdx_file cf ON cf.id = rvs.cdx_id
       WHERE rx.reaction_type_id = ?
       ORDER BY cf.domain`,
    )
    .all(reactionTypeId);

  const activeDomainIds = filterDomains?.length ? filterDomains : null;
  const domainWhere = activeDomainIds
    ? `AND rvs_filter.cdx_id IN (${activeDomainIds.map(() => '?').join(',')})`
    : '';
  const domainJoin = activeDomainIds
    ? `INNER JOIN resource_version_source rvs_filter
         ON rvs_filter.url = rx.resource_version_url
        AND rvs_filter.timestamp = rx.resource_version_timestamp`
    : '';
  const domainParams: string[] = activeDomainIds ?? [];

  const totalFiles =
    db
      .prepare<unknown[], { count: number }>(
        `SELECT COUNT(*) AS count
         FROM reaction rx
         ${domainJoin}
         WHERE rx.reaction_type_id = ?
         ${domainWhere}`,
      )
      .get(...domainParams, reactionTypeId)?.count ?? 0;

  const totalPages = Math.max(1, Math.ceil(totalFiles / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * PAGE_SIZE;

  const files = db
    .prepare<unknown[], ReactionViewFileRow>(
      `SELECT rx.resource_version_url,
              rx.resource_version_timestamp,
              r.id AS request_id,
              r.resource_version_url AS original,
              CAST(r.resource_version_timestamp AS TEXT) AS timestamp
       FROM reaction rx
       LEFT JOIN request r
         ON r.resource_version_url = rx.resource_version_url
        AND r.resource_version_timestamp = rx.resource_version_timestamp
        AND r.is_successful = 1
       ${domainJoin}
       WHERE rx.reaction_type_id = ?
       ${domainWhere}
       ORDER BY rx.resource_version_timestamp DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...domainParams, reactionTypeId, PAGE_SIZE, offset);

  const urlTimestampKeys = files.map(
    (f) => `${f.resource_version_url}|${f.resource_version_timestamp}`,
  );

  const activeReactions: string[] =
    files.length > 0
      ? db
          .prepare<
            unknown[],
            {
              reaction_type_id: number;
              resource_version_url: string;
              resource_version_timestamp: number;
            }
          >(
            `SELECT reaction_type_id, resource_version_url, resource_version_timestamp
             FROM reaction
             WHERE (resource_version_url, resource_version_timestamp) IN (${files.map(() => '(?,?)').join(',')})`,
          )
          .all(
            ...files.flatMap((f) => [
              f.resource_version_url,
              f.resource_version_timestamp,
            ]),
          )
          .map(
            (r) =>
              `${r.resource_version_url}|${r.resource_version_timestamp}:${r.reaction_type_id}`,
          )
      : [];

  const matchedConditionsRaw: MatchedConditionRow[] =
    files.length > 0
      ? db
          .prepare<unknown[], MatchedConditionRow>(
            `SELECT DISTINCT sf.resource_version_url, sf.resource_version_timestamp,
                    sc.id AS condition_id, sc.regex, sc.not_regex_nearby
             FROM search_file sf
             INNER JOIN search_match sm ON sm.search_file_id = sf.id
             INNER JOIN search_condition sc ON sc.id = sm.search_condition_id
             WHERE (sf.resource_version_url, sf.resource_version_timestamp) IN (${files.map(() => '(?,?)').join(',')})`,
          )
          .all(
            ...files.flatMap((f) => [
              f.resource_version_url,
              f.resource_version_timestamp,
            ]),
          )
      : [];

  const matchedConditions: Record<
    string,
    { id: number; regex: string; not_regex_nearby: string | null }[]
  > = {};
  for (const row of matchedConditionsRaw) {
    const key = `${row.resource_version_url}|${row.resource_version_timestamp}`;
    (matchedConditions[key] ??= []).push({
      id: row.condition_id,
      regex: row.regex,
      not_regex_nearby: row.not_regex_nearby,
    });
  }

  return {
    files,
    urlTimestampKeys,
    totalFiles,
    totalPages,
    currentPage: safePage,
    reactionTypes,
    domains,
    filterDomains: activeDomainIds ?? [],
    activeReactions,
    matchedConditions,
  };
}

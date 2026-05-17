import type { Database as DB } from 'better-sqlite3';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReactionTypeRow {
  id: number;
  label: string;
  icon: string;
}

export interface ReactionRow {
  reaction_type_id: number;
  resource_version_url: string;
  resource_version_timestamp: number;
}

export interface ReactionViewFileRow {
  resource_version_url: string;
  resource_version_timestamp: number;
  request_id: string;
  original: string;
  timestamp: string;
}

export interface ReactionDomainRow {
  domain_name: string;
}

export interface MatchedConditionRow {
  resource_version_url: string;
  resource_version_timestamp: number;
  condition_id: number;
  regex: string;
  not_regex_nearby: string | null;
}

interface DomainFilterFragments {
  join: string;
  where: string;
  params: string[];
}

export class ReactionRepository {
  constructor(private readonly db: DB) {}

  // ── Reaction types ────────────────────────────────────────────────────────────

  findAllTypes(): ReactionTypeRow[] {
    return this.db
      .prepare<
        [],
        ReactionTypeRow
      >(`SELECT id, label, icon FROM reaction_type ORDER BY id`)
      .all();
  }

  findTypeById(id: number): ReactionTypeRow | undefined {
    return this.db
      .prepare<
        [number],
        ReactionTypeRow
      >(`SELECT id, label, icon FROM reaction_type WHERE id = ?`)
      .get(id);
  }

  // ── Reactions ─────────────────────────────────────────────────────────────────

  findActiveTypeIds(url: string, timestamp: number): number[] {
    return this.db
      .prepare<[string, number], { reaction_type_id: number }>(
        `SELECT reaction_type_id FROM reaction
         WHERE resource_version_url = ? AND resource_version_timestamp = ?`,
      )
      .all(url, timestamp)
      .map((r) => r.reaction_type_id);
  }

  insert(reactionTypeId: number, url: string, timestamp: number): void {
    this.db
      .prepare<[number, string, number]>(
        `INSERT OR IGNORE INTO reaction
           (reaction_type_id, resource_version_url, resource_version_timestamp)
         VALUES (?, ?, ?)`,
      )
      .run(reactionTypeId, url, timestamp);
  }

  delete(reactionTypeId: number, url: string, timestamp: number): void {
    this.db
      .prepare<[number, string, number]>(
        `DELETE FROM reaction
         WHERE reaction_type_id = ? AND resource_version_url = ? AND resource_version_timestamp = ?`,
      )
      .run(reactionTypeId, url, timestamp);
  }

  setReaction(
    url: string,
    timestamp: number,
    reactionTypeId: number,
    active: boolean,
  ): { activeReactionTypeIds: number[] } {
    if (active) {
      this.insert(reactionTypeId, url, timestamp);
    } else {
      this.delete(reactionTypeId, url, timestamp);
    }
    return { activeReactionTypeIds: this.findActiveTypeIds(url, timestamp) };
  }

  findActiveForPages(
    files: {
      resource_version_url: string;
      resource_version_timestamp: number;
    }[],
  ): string[] {
    if (files.length === 0) return [];
    return this.db
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
      );
  }

  // ── Reactions view page ───────────────────────────────────────────────────────

  findDomainsForReactionType(reactionTypeId: number): ReactionDomainRow[] {
    return this.db
      .prepare<[number], ReactionDomainRow>(
        `SELECT DISTINCT rvs.domain_name
         FROM reaction rx
         INNER JOIN resource_version_source rvs
           ON rvs.url = rx.resource_version_url
          AND rvs.timestamp = rx.resource_version_timestamp
         WHERE rx.reaction_type_id = ?
         ORDER BY rvs.domain_name`,
      )
      .all(reactionTypeId);
  }

  private buildDomainFilterFragments(
    filterDomains: string[] | null | undefined,
  ): DomainFilterFragments {
    if (!filterDomains || filterDomains.length === 0) {
      return { join: '', where: '', params: [] };
    }
    return {
      join: `INNER JOIN resource_version_source rvs_filter
               ON rvs_filter.url = rx.resource_version_url
              AND rvs_filter.timestamp = rx.resource_version_timestamp`,
      where: `AND rvs_filter.domain_name IN (${filterDomains.map(() => '?').join(',')})`,
      params: filterDomains,
    };
  }

  countFilesForReactionType(
    reactionTypeId: number,
    filterDomains?: string[] | null,
  ): number {
    const domainFragments = this.buildDomainFilterFragments(filterDomains);
    return (
      this.db
        .prepare<unknown[], { count: number }>(
          `SELECT COUNT(*) AS count
           FROM reaction rx
           ${domainFragments.join}
           WHERE rx.reaction_type_id = ?
           ${domainFragments.where}`,
        )
        .get(reactionTypeId, ...domainFragments.params)?.count ?? 0
    );
  }

  findFilesForReactionTypePage(
    reactionTypeId: number,
    limit: number,
    offset: number,
    filterDomains?: string[] | null,
  ): ReactionViewFileRow[] {
    const domainFragments = this.buildDomainFilterFragments(filterDomains);
    return this.db
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
         ${domainFragments.join}
         WHERE rx.reaction_type_id = ?
         ${domainFragments.where}
         ORDER BY rx.resource_version_timestamp DESC
         LIMIT ? OFFSET ?`,
      )
      .all(reactionTypeId, ...domainFragments.params, limit, offset);
  }

  findMatchedConditionsForFiles(
    files: {
      resource_version_url: string;
      resource_version_timestamp: number;
    }[],
  ): Record<
    string,
    { id: number; regex: string; not_regex_nearby: string | null }[]
  > {
    if (files.length === 0) return {};

    const rows = this.db
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
      );

    const matchedConditions: Record<
      string,
      { id: number; regex: string; not_regex_nearby: string | null }[]
    > = {};
    for (const row of rows) {
      const key = `${row.resource_version_url}|${row.resource_version_timestamp}`;
      (matchedConditions[key] ??= []).push({
        id: row.condition_id,
        regex: row.regex,
        not_regex_nearby: row.not_regex_nearby,
      });
    }
    return matchedConditions;
  }
}

import type { Database as DB } from 'better-sqlite3';

function getActiveReactionTypeIds(
  db: DB,
  url: string,
  timestamp: number,
): number[] {
  return db
    .prepare<[string, number], { reaction_type_id: number }>(
      `SELECT reaction_type_id FROM reaction WHERE resource_version_url = ? AND resource_version_timestamp = ?`,
    )
    .all(url, timestamp)
    .map((r) => r.reaction_type_id);
}

export function setReaction(
  db: DB,
  url: string,
  timestamp: number,
  reactionTypeId: number,
  active: boolean,
): { activeReactionTypeIds: number[] } {
  if (active) {
    db.prepare(
      `INSERT OR IGNORE INTO reaction (reaction_type_id, resource_version_url, resource_version_timestamp) VALUES (?, ?, ?)`,
    ).run(reactionTypeId, url, timestamp);
  } else {
    db.prepare(
      `DELETE FROM reaction WHERE reaction_type_id = ? AND resource_version_url = ? AND resource_version_timestamp = ?`,
    ).run(reactionTypeId, url, timestamp);
  }
  return {
    activeReactionTypeIds: getActiveReactionTypeIds(db, url, timestamp),
  };
}

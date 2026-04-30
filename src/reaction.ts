import type { Database as DB } from 'better-sqlite3';

function getActiveReactionTypeIds(db: DB, bodyDigest: string): number[] {
  return db
    .prepare<[string], { reaction_type_id: number }>(
      `SELECT reaction_type_id FROM reaction WHERE body_digest = ?`,
    )
    .all(bodyDigest)
    .map((r) => r.reaction_type_id);
}

export function setReaction(
  db: DB,
  bodyDigest: string,
  reactionTypeId: number,
  active: boolean,
): { activeReactionTypeIds: number[] } {
  if (active) {
    db.prepare(
      `INSERT OR IGNORE INTO reaction (reaction_type_id, body_digest) VALUES (?, ?)`,
    ).run(reactionTypeId, bodyDigest);
  } else {
    db.prepare(
      `DELETE FROM reaction WHERE reaction_type_id = ? AND body_digest = ?`,
    ).run(reactionTypeId, bodyDigest);
  }
  return { activeReactionTypeIds: getActiveReactionTypeIds(db, bodyDigest) };
}

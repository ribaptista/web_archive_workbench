import type { Condition } from './ConditionCard';

/**
 * Validates all conditions client-side.
 * Returns an error message string, or null if everything is valid.
 */
export function validateConditions(conditions: Condition[]): string | null {
  for (let i = 0; i < conditions.length; i++) {
    const val = conditions[i].regex.trim();
    if (!val) continue;
    try {
      new RegExp(val);
    } catch {
      return `Invalid regex at condition ${i + 1}`;
    }
    const notVal = conditions[i].notRegexNearby.trim();
    if (notVal) {
      try {
        new RegExp(notVal);
      } catch {
        return `Invalid not-nearby regex at condition ${i + 1}`;
      }
    }
  }
  return null;
}

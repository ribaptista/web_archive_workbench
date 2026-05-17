/**
 * Centralized route builders for all app pages.
 * Each function returns a relative URL string ready for router.push().
 */

export function reactionsViewRoute(
  reactionTypeId: number,
  page: number,
  selectedDomains: Set<string>,
): string {
  const u = new URLSearchParams({
    reaction_type_id: String(reactionTypeId),
    page: String(page),
  });
  for (const id of selectedDomains) u.append('domain[]', id);
  return `/reactions_view?${u}`;
}

export function domainErrorsRoute(
  domain: string,
  selectedCodes: Set<string>,
  selectedNames: Set<string>,
): string {
  const u = new URLSearchParams({ domain });
  for (const code of selectedCodes) u.append('error_code[]', code);
  for (const name of selectedNames) u.append('error_name[]', name);
  return `/domain_errors?${u}`;
}

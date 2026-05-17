"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ToggleGroupWithSelectAll } from "@/components/ToggleGroupWithSelectAll";
import { ToggleIconGroup } from "@/components/ToggleIconGroup";
import type { SearchResultsData } from "./types";

export interface AppliedFilters {
  /** Empty array means "no filter" (= all selected; omit from URL). */
  domains: string[];
  /** Empty array means "no filter". */
  conditionIds: number[];
  reactionTypeIds: number[];
}

interface Props {
  data: SearchResultsData;
  loading: boolean;
  invisible: boolean;
  onApply: (filters: AppliedFilters) => void;
}

export function ResultsFilters({ data, loading, invisible, onApply }: Props) {
  const { domains, conditions, reactionTypes, countsByDomain, countsByCondition, countsByReaction } = data;

  const [localDomains, setLocalDomains] = useState<Set<string>>(new Set());
  const [localConditions, setLocalConditions] = useState<Set<number>>(new Set());
  const [localReactions, setLocalReactions] = useState<Set<number>>(new Set());

  // Reseed local state whenever new data arrives.
  useEffect(() => {
    setLocalDomains(
      data.filterDomains.length > 0
        ? new Set(data.filterDomains)
        : new Set(data.domains.map((d) => d.name))
    );
    setLocalConditions(
      data.filterConditionIds.length > 0
        ? new Set(data.filterConditionIds)
        : new Set(data.conditions.map((c) => c.id))
    );
    setLocalReactions(new Set(data.filterReactionTypeIds));
  }, [data]);

  function apply() {
    const allDomainsSelected = domains.every((d) => localDomains.has(d.name));
    const allCondsSelected = conditions.every((c) => localConditions.has(c.id));
    onApply({
      domains: allDomainsSelected ? [] : Array.from(localDomains),
      conditionIds: allCondsSelected ? [] : Array.from(localConditions),
      reactionTypeIds: Array.from(localReactions),
    });
  }

  // `ToggleGroupWithSelectAll` expects string ids; conditions are numeric.
  const conditionItems = useMemo(
    () => conditions.map((c) => ({
      id: String(c.id),
      label: c.regex,
      subtitle: c.not_regex_nearby ? `NOT NEAR ${c.not_regex_nearby}` : undefined,
    })),
    [conditions],
  );
  const conditionCountsByStringId = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [id, n] of Object.entries(countsByCondition)) out[String(id)] = n;
    return out;
  }, [countsByCondition]);
  const localConditionsAsStrings = useMemo(
    () => new Set(Array.from(localConditions, String)),
    [localConditions],
  );

  return (
    <Card className={`mb-4 transition-opacity ${invisible ? "invisible" : ""}`}>
      <CardHeader className="py-2 px-4 font-semibold text-sm">Filter Results</CardHeader>
      <CardContent className={`py-3 space-y-3 transition-opacity ${loading ? "opacity-50 pointer-events-none" : ""}`}>
        {domains.length > 0 && (
          <ToggleGroupWithSelectAll
            label="Domains"
            items={domains.map((d) => ({ id: d.name, label: d.name }))}
            selected={localDomains}
            onChange={setLocalDomains}
            counts={countsByDomain}
          />
        )}

        {conditions.length > 0 && (
          <ToggleGroupWithSelectAll
            label="Conditions"
            items={conditionItems}
            selected={localConditionsAsStrings}
            onChange={(next) => setLocalConditions(new Set(Array.from(next, Number)))}
            counts={conditionCountsByStringId}
          />
        )}

        {reactionTypes.length > 0 && (
          <ToggleIconGroup
            label="Only reacted"
            items={reactionTypes}
            selected={localReactions}
            onChange={setLocalReactions}
            counts={countsByReaction}
          />
        )}

        <Button size="sm" onClick={apply}>Update Filters</Button>
      </CardContent>
    </Card>
  );
}

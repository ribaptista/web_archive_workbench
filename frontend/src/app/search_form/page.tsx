"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroupWithSelectAll } from "@/components/ToggleGroupWithSelectAll";
import { ConditionGroup } from "./ConditionGroup";
import { validateConditions } from "./validateConditions";
import { createSearch, fetchDomains } from "@/lib/api";
import type { Condition } from "./ConditionCard";
import type { Domain } from "@/lib/api";

export default function SearchFormPage() {
  const router = useRouter();
  const [domains, setDomains] = useState<Domain[]>([]);
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(new Set());
  const [conditions, setConditions] = useState<Condition[]>([{ regex: "", notRegexNearby: "" }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDomains()
      .then((loaded) => {
        setDomains(loaded);
        setSelectedDomains(new Set(loaded.map((d) => d.name)));
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const validationError = validateConditions(conditions);
    if (validationError) { setError(validationError); return; }

    setSubmitting(true);
    try {
      const data = await createSearch({ conditions, domainIds: Array.from(selectedDomains) });
      router.push(`/search_results?search_id=${data.searchId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container max-w-5xl py-8 mx-auto px-4">

      <h1 className="text-2xl font-bold mb-6">New Search</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <ConditionGroup value={conditions} onChange={setConditions} />

        <ToggleGroupWithSelectAll
          label="Domains"
          items={domains.map((d) => ({ id: d.name, label: d.name }))}
          selected={selectedDomains}
          onChange={setSelectedDomains}
          renderItem={(item, isSelected, toggle) => (
            <Toggle
              key={item.id}
              size="sm"
              pressed={isSelected}
              onPressedChange={toggle}
              className="border border-input data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              {item.label}
            </Toggle>
          )}
        />

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={submitting}>
          {submitting ? "Running…" : "Run Search"}
        </Button>
      </form>
    </div>
  );
}

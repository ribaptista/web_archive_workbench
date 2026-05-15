"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroupWithSelectAll } from "@/components/ToggleGroupWithSelectAll";

interface Domain {
  name: string;
}

interface Condition {
  regex: string;
  notRegexNearby: string;
}

export default function SearchFormPage() {
  const router = useRouter();
  const [domains, setDomains] = useState<Domain[]>([]);
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(new Set());
  const [conditions, setConditions] = useState<Condition[]>([{ regex: "", notRegexNearby: "" }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/domains/")
      .then((r) => r.json())
      .then((loaded: Domain[]) => {
        setDomains(loaded);
        setSelectedDomains(new Set(loaded.map((d) => d.name)));
      })
      .catch(() => {});
  }, []);

  function addCondition() {
    setConditions((prev) => [...prev, { regex: "", notRegexNearby: "" }]);
  }

  function removeCondition(i: number) {
    setConditions((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateCondition(i: number, field: keyof Condition, value: string) {
    setConditions((prev) =>
      prev.map((c, idx) => (idx === i ? { ...c, [field]: value } : c))
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validate regexes client-side
    for (let i = 0; i < conditions.length; i++) {
      const val = conditions[i].regex.trim();
      if (!val) continue;
      try {
        new RegExp(val);
      } catch {
        setError(`Invalid regex at condition ${i + 1}`);
        return;
      }
      const notVal = conditions[i].notRegexNearby.trim();
      if (notVal) {
        try {
          new RegExp(notVal);
        } catch {
          setError(`Invalid not-nearby regex at condition ${i + 1}`);
          return;
        }
      }
    }

    const body = new URLSearchParams();
    for (const c of conditions) {
      body.append("regex[]", c.regex);
      body.append("not_regex_nearby[]", c.notRegexNearby);
    }
    for (const id of selectedDomains) {
      body.append("cdx_file_id[]", id);
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/searches/", { method: "POST", body });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setError(err.error ?? "Server error");
        return;
      }
      const data = await res.json();
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
        <div>
          <h2 className="text-base font-semibold mb-3">Conditions</h2>
          <div className="space-y-2">
            {conditions.map((c, i) => (
              <Card key={i}>
                <CardContent className="pt-4 space-y-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      Regex (required)
                    </Label>
                    <Input
                      name="regex[]"
                      value={c.regex}
                      onChange={(e) => updateCondition(i, "regex", e.target.value)}
                      placeholder="e.g. foo\w+"
                      required
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      Not nearby (optional)
                    </Label>
                    <Input
                      name="not_regex_nearby[]"
                      value={c.notRegexNearby}
                      onChange={(e) => updateCondition(i, "notRegexNearby", e.target.value)}
                      placeholder="e.g. exclude"
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => removeCondition(i)}
                      disabled={conditions.length === 1}
                    >
                      Remove condition
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={addCondition}
          >
            + Add condition
          </Button>
        </div>

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

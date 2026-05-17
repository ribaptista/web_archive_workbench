"use client";

import { Button } from "@/components/ui/button";
import { ConditionCard } from "./ConditionCard";
import type { Condition } from "./ConditionCard";

interface Props {
  value: Condition[];
  onChange: (conditions: Condition[]) => void;
}

export function ConditionGroup({ value, onChange }: Props) {
  function add() {
    onChange([...value, { regex: "", notRegexNearby: "" }]);
  }

  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  function update(i: number, field: keyof Condition, val: string) {
    onChange(value.map((c, idx) => (idx === i ? { ...c, [field]: val } : c)));
  }

  return (
    <div>
      <h2 className="text-base font-semibold mb-3">Conditions</h2>
      <div className="space-y-2">
        {value.map((c, i) => (
          <ConditionCard
            key={i}
            condition={c}
            onChange={(field, val) => update(i, field, val)}
            onRemove={() => remove(i)}
            removable={value.length > 1}
          />
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" className="mt-2" onClick={add}>
        + Add condition
      </Button>
    </div>
  );
}

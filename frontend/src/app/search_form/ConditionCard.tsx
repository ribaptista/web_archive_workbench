"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export interface Condition {
  regex: string;
  notRegexNearby: string;
}

interface Props {
  condition: Condition;
  onChange: (field: keyof Condition, value: string) => void;
  onRemove: () => void;
  removable: boolean;
}

export function ConditionCard({ condition, onChange, onRemove, removable }: Props) {
  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Regex (required)</Label>
          <Input
            name="regex[]"
            value={condition.regex}
            onChange={(e) => onChange("regex", e.target.value)}
            placeholder="e.g. foo\w+"
            required
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Not nearby (optional)</Label>
          <Input
            name="not_regex_nearby[]"
            value={condition.notRegexNearby}
            onChange={(e) => onChange("notRegexNearby", e.target.value)}
            placeholder="e.g. exclude"
          />
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRemove}
            disabled={!removable}
          >
            Remove condition
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

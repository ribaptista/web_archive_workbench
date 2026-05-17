"use client";

import { Button } from "@/components/ui/button";

interface Item {
  id: string;
  label: string;
  /** Optional second line shown beneath the label, dimmed. */
  subtitle?: string;
}

interface ToggleGroupWithSelectAllProps {
  label: string;
  items: Item[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  counts?: Record<string, number>;
  renderItem?: (item: Item, isSelected: boolean, toggle: () => void) => React.ReactNode;
}

export function ToggleGroupWithSelectAll({
  label,
  items,
  selected,
  onChange,
  counts,
  renderItem,
}: ToggleGroupWithSelectAllProps) {
  if (items.length === 0) return null;

  const allSelected = items.every((item) => selected.has(item.id));
  const noneSelected = items.every((item) => !selected.has(item.id));

  function toggleItem(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-xs font-semibold">{label}</p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            disabled={allSelected}
            onClick={() => onChange(new Set(items.map((i) => i.id)))}
          >
            Select all
          </Button>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            disabled={noneSelected}
            onClick={() => onChange(new Set())}
          >
            Select none
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const isSelected = selected.has(item.id);
          if (renderItem) return renderItem(item, isSelected, () => toggleItem(item.id));
          return (
            <Button
              key={item.id}
              type="button"
              variant={isSelected ? "default" : "outline"}
              size="sm"
              className={item.subtitle ? "h-auto py-1 flex flex-col items-start" : undefined}
              onClick={() => toggleItem(item.id)}
            >
              <span>
                {item.label}
                {counts?.[item.id] !== undefined && (
                  <span className="ml-1 opacity-60 font-normal">({counts[item.id]})</span>
                )}
              </span>
              {item.subtitle && (
                <span
                  className={`font-normal text-xs ${isSelected ? "text-primary-foreground/60" : "text-muted-foreground"}`}
                >
                  {item.subtitle}
                </span>
              )}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

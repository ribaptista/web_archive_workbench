'use client';

import { Button } from '@/components/ui/button';
import { DynamicIcon } from '@/components/ui/dynamic-icon';

export interface ToggleIconItem {
  id: number;
  label: string;
  icon: string;
}

interface Props {
  label?: string;
  items: ToggleIconItem[];
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
  counts?: Record<number, number>;
}

/**
 * A row of multi-select toggle buttons, each prefixed by a `DynamicIcon`.
 * Empty `selected` set means "no filter" — the caller decides what that
 * implies semantically.
 */
export function ToggleIconGroup({
  label,
  items,
  selected,
  onChange,
  counts,
}: Props) {
  if (items.length === 0) return null;

  function toggle(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  return (
    <div>
      {label && <p className="text-xs font-semibold mb-1">{label}</p>}
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const active = selected.has(item.id);
          const count = counts?.[item.id];
          return (
            <Button
              key={item.id}
              type="button"
              variant={active ? 'default' : 'outline'}
              size="sm"
              onClick={() => toggle(item.id)}
            >
              <DynamicIcon name={item.icon} active={active} />
              {item.label}
              {count !== undefined && (
                <span className="ml-1 opacity-60 font-normal text-xs">
                  ({count})
                </span>
              )}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

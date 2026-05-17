"use client";

import { Badge } from "@/components/ui/badge";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export interface CategoryCount {
  name: string;
  count: number;
  subcategories?: { name: string; count: number }[];
}

interface Props {
  label: string;
  total: number;
  variant?: BadgeVariant;
  byCategory?: CategoryCount[];
}

/**
 * A single stat row: label + total badge + optional per-category breakdown.
 * Each category may optionally carry subcategory badges shown beneath it.
 * The breakdown is shown only when there is more than one category.
 */
export function BadgeStatisticsCard({ label, total, variant = "outline", byCategory }: Props) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs text-muted-foreground w-28 shrink-0">{label}</span>
        <Badge variant={variant}>{total}</Badge>
      </div>
      {byCategory && byCategory.length > 0 && (
        <div className="ml-[7.5rem] space-y-1">
          {byCategory.map((c) => (
            <div key={c.name}>
              <Badge variant="secondary" className="text-xs font-normal mb-1">
                {c.name}: {c.count}
              </Badge>
              {c.subcategories && c.subcategories.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {c.subcategories.map((s) => (
                    <Badge key={s.name} variant="outline" className="font-mono text-xs font-normal">
                      {s.name}: {s.count}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

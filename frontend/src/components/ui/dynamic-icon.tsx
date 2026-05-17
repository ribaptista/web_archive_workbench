"use client";

import * as LucideIcons from "lucide-react";

const FILLABLE = new Set(["Heart", "Star", "Bookmark", "ThumbsUp", "ThumbsDown"]);

export function DynamicIcon({ name, active }: { name: string; active: boolean }) {
  const Icon = (LucideIcons as Record<string, unknown>)[name] as
    | React.ElementType
    | undefined;
  if (!Icon) return <span className="text-xs">{name}</span>;
  const fillable = FILLABLE.has(name);
  return (
    <Icon
      size={16}
      fill={fillable && active ? "currentColor" : "none"}
      strokeWidth={fillable && active ? 0 : active ? 2.5 : 1.5}
    />
  );
}

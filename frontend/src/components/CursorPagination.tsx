"use client";

import { Button } from "@/components/ui/button";

interface Props {
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export function CursorPagination({ hasPrev, hasNext, onPrev, onNext }: Props) {
  if (!hasPrev && !hasNext) return null;
  return (
    <div className="flex gap-1">
      <Button variant="outline" size="sm" disabled={!hasPrev} onClick={onPrev}>« Prev</Button>
      <Button variant="outline" size="sm" disabled={!hasNext} onClick={onNext}>Next »</Button>
    </div>
  );
}

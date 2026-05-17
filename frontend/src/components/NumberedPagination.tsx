"use client";

import { Button } from "@/components/ui/button";

interface Props {
  currentPage: number;
  totalPages: number;
  buildPageUrl: (page: number) => string;
  onNavigate: (url: string) => void;
  className?: string;
}

function getPageRange(current: number, total: number): number[] {
  const half = 5;
  let start = Math.max(1, current - half);
  let end = Math.min(total, current + half);
  if (end - start < 10) {
    if (start === 1) end = Math.min(total, start + 10);
    else if (end === total) start = Math.max(1, end - 10);
  }
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export function NumberedPagination({ currentPage, totalPages, buildPageUrl, onNavigate, className }: Props) {
  if (totalPages <= 1) return null;

  return (
    <div className={`flex flex-wrap gap-1 ${className ?? ""}`}>
      <Button
        variant="outline" size="sm"
        disabled={currentPage === 1}
        onClick={() => onNavigate(buildPageUrl(currentPage - 1))}
      >«</Button>
      {getPageRange(currentPage, totalPages).map((p) => (
        <Button
          key={p}
          variant={p === currentPage ? "default" : "outline"}
          size="sm"
          onClick={() => onNavigate(buildPageUrl(p))}
        >{p}</Button>
      ))}
      <Button
        variant="outline" size="sm"
        disabled={currentPage === totalPages}
        onClick={() => onNavigate(buildPageUrl(currentPage + 1))}
      >»</Button>
    </div>
  );
}

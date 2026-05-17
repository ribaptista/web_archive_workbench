import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Returns true when every item in `all` is present in `set`. */
export function allSelected(set: Set<string>, all: string[]): boolean {
  return all.length > 0 && all.every((v) => set.has(v));
}

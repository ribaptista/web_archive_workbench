import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Tailwind class-name combinator. Used by shadcn UI primitives via the
 * conventional `@/lib/utils` import path — do not move this function.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

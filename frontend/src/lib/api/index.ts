/**
 * Central repository for all backend API calls made from the frontend.
 * Each concern is split into its own module; this file re-exports everything
 * so callers can continue to import from '@/lib/api'.
 */

export * from './runs';
export * from './domains';
export * from './resources';
export * from './searches';
export * from './reactions';

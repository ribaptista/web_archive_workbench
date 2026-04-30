import { describe, it, expect } from 'vitest';
import { isExclNear, fileMatches } from './filter-paths';

// --- isExclNear ---

describe('isExclNear', () => {
  it('returns false when excTerm is absent', () => {
    expect(isExclNear('bad', 'hello world', 0, 5)).toBe(false);
  });

  it('returns true when excTerm is on the same line before the match', () => {
    const s = 'bad good';
    expect(isExclNear('bad', s, 4, 8)).toBe(true);
  });

  it('returns true when excTerm is on the same line after the match', () => {
    const s = 'good bad';
    expect(isExclNear('bad', s, 0, 4)).toBe(true);
  });

  it('returns false when excTerm is on a different line before the match', () => {
    const s = 'bad\ngood';
    expect(isExclNear('bad', s, 4, 8)).toBe(false);
  });

  it('returns false when excTerm is on a different line after the match', () => {
    const s = 'good\nbad';
    expect(isExclNear('bad', s, 0, 4)).toBe(false);
  });

  it('returns true when excTerm overlaps the match', () => {
    const s = 'abcdef';
    // match covers index 2-5 ("cde"), excTerm is "cd" at index 2-4
    expect(isExclNear('cd', s, 2, 5)).toBe(true);
  });

  it('handles \\r\\n line endings', () => {
    const s = 'bad\r\ngood';
    expect(isExclNear('bad', s, 5, 9)).toBe(false);
  });

  it('is case-sensitive (operates on pre-lowercased content)', () => {
    const s = 'bad good';
    // excTerm must already be lowercased when passed in
    expect(isExclNear('bad', s, 4, 8)).toBe(true);
    expect(isExclNear('BAD', s, 4, 8)).toBe(false);
  });
});

// --- fileMatches ---

describe('fileMatches', () => {
  it('returns true when include matches and excTerm absent', () => {
    expect(fileMatches('hello', 'bad', 'hello world')).toBe(true);
  });

  it('returns null when include pattern does not match', () => {
    expect(fileMatches('hello', 'bad', 'goodbye world')).toBe(null);
  });

  it('returns false when every match has excTerm on same line', () => {
    expect(fileMatches('hello', 'bad', 'hello bad world')).toBe(false);
  });

  it('returns true when at least one match has no excTerm on same line', () => {
    const content = 'hello bad\nhello good';
    expect(fileMatches('hello', 'bad', content)).toBe(true);
  });

  it('is case-insensitive for the include pattern', () => {
    expect(fileMatches('HELLO', 'bad', 'hello world')).toBe(true);
  });

  it('is case-insensitive for the exclude term', () => {
    expect(fileMatches('hello', 'BAD', 'hello bad world')).toBe(false);
  });

  it('matches across newlines when pattern contains \\n', () => {
    const content = 'start\nhello\nend';
    expect(fileMatches('hello\\nend', 'bad', content)).toBe(true);
  });

  it('excTerm on a different line does not suppress the match', () => {
    const content = 'bad\nhello world';
    expect(fileMatches('hello', 'bad', content)).toBe(true);
  });
});

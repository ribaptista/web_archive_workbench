import { describe, it, expect } from 'vitest';
import { getPathParts } from './tree-node-utils';

describe('getPathParts', () => {
  it('http with single path segment', () => {
    expect(getPathParts('http://example.com/foo')).toEqual([
      'http://example.com',
      '/foo',
    ]);
  });

  it('https with multiple path segments', () => {
    expect(getPathParts('https://example.com/foo/bar/baz')).toEqual([
      'https://example.com',
      '/foo',
      '/bar',
      '/baz',
    ]);
  });

  it('empty path (no trailing slash)', () => {
    expect(getPathParts('https://example.com')).toEqual(['https://example.com']);
  });

  it('root path only', () => {
    expect(getPathParts('https://example.com/')).toEqual([
      'https://example.com',
      '/',
    ]);
  });

  it('query string on root path', () => {
    expect(getPathParts('https://example.com/?q=1')).toEqual([
      'https://example.com',
      '/?q=1',
    ]);
  });

  it('query string on deep path', () => {
    expect(getPathParts('https://example.com/foo/bar?baz=1&x=2')).toEqual([
      'https://example.com',
      '/foo',
      '/bar?baz=1&x=2',
    ]);
  });

  it('query string with no path segments after base', () => {
    expect(getPathParts('https://example.com?q=hello')).toEqual([
      'https://example.com?q=hello',
    ]);
  });

  it('domain with port', () => {
    expect(getPathParts('http://example.com:8080/path/to')).toEqual([
      'http://example.com:8080',
      '/path',
      '/to',
    ]);
  });

  it('domain with port and query string', () => {
    expect(getPathParts('http://localhost:3000/api/v1?token=abc')).toEqual([
      'http://localhost:3000',
      '/api',
      '/v1?token=abc',
    ]);
  });

  it('http (not https)', () => {
    expect(getPathParts('http://example.com/page')).toEqual([
      'http://example.com',
      '/page',
    ]);
  });

  it('mailto scheme (no slashes in authority)', () => {
    expect(getPathParts('mailto:user@example.com')).toEqual([
      'mailto:user@example.com',
    ]);
  });

  it('path with trailing slash', () => {
    expect(getPathParts('https://example.com/foo/bar/')).toEqual([
      'https://example.com',
      '/foo',
      '/bar',
      '/',
    ]);
  });

  it('path segment that is empty string between slashes', () => {
    expect(getPathParts('https://example.com/foo//bar')).toEqual([
      'https://example.com',
      '/foo',
      '/',
      '/bar',
    ]);
  });

  it('throws on invalid URL', () => {
    expect(() => getPathParts('not a url')).toThrow();
  });

  it('multiple question marks — only first is the query delimiter', () => {
    expect(getPathParts('https://example.com/foo/bar?a=1?b=2')).toEqual([
      'https://example.com',
      '/foo',
      '/bar?a=1?b=2',
    ]);
  });
});

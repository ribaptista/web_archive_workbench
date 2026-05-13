import { describe, it, expect } from 'vitest';
import { getPathParts, normalizeUrl } from './tree-node-utils';

describe('getPathParts', () => {
  it('single path segment', () => {
    expect(getPathParts('example.com/foo')).toEqual(['example.com', '/foo']);
  });

  it('multiple path segments', () => {
    expect(getPathParts('example.com/foo/bar/baz')).toEqual([
      'example.com',
      '/foo',
      '/bar',
      '/baz',
    ]);
  });

  it('no path', () => {
    expect(getPathParts('example.com')).toEqual(['example.com']);
  });

  it('root path only', () => {
    expect(getPathParts('example.com/')).toEqual(['example.com', '/']);
  });

  it('query string on root path', () => {
    expect(getPathParts('example.com/?q=1')).toEqual(['example.com', '/?q=1']);
  });

  it('query string on deep path', () => {
    expect(getPathParts('example.com/foo/bar?baz=1&x=2')).toEqual([
      'example.com',
      '/foo',
      '/bar?baz=1&x=2',
    ]);
  });

  it('query string with no path segments after base', () => {
    expect(getPathParts('example.com?q=hello')).toEqual([
      'example.com?q=hello',
    ]);
  });

  it('two path segments', () => {
    expect(getPathParts('example.com/path/to')).toEqual([
      'example.com',
      '/path',
      '/to',
    ]);
  });

  it('localhost with path and query', () => {
    expect(getPathParts('localhost/api/v1?token=abc')).toEqual([
      'localhost',
      '/api',
      '/v1?token=abc',
    ]);
  });

  it('path with trailing slash', () => {
    expect(getPathParts('example.com/foo/bar/')).toEqual([
      'example.com',
      '/foo',
      '/bar',
      '/',
    ]);
  });

  it('path segment that is empty string between slashes', () => {
    expect(getPathParts('example.com/foo//bar')).toEqual([
      'example.com',
      '/foo',
      '/',
      '/bar',
    ]);
  });

  it('multiple question marks — only first is the query delimiter', () => {
    expect(getPathParts('example.com/foo/bar?a=1?b=2')).toEqual([
      'example.com',
      '/foo',
      '/bar?a=1?b=2',
    ]);
  });
});

describe('normalizeUrl', () => {
  it('strips https scheme', () => {
    expect(normalizeUrl('https://example.com/foo')).toBe('example.com/foo');
  });

  it('strips http scheme', () => {
    expect(normalizeUrl('http://example.com/page')).toBe('example.com/page');
  });

  it('strips port', () => {
    expect(normalizeUrl('http://example.com:8080/path/to')).toBe(
      'example.com/path/to',
    );
  });

  it('strips standard port 443', () => {
    expect(normalizeUrl('https://example.com:443/foo')).toBe('example.com/foo');
  });

  it('removes trailing dot from host', () => {
    expect(normalizeUrl('https://example.com./foo/bar')).toBe(
      'example.com/foo/bar',
    );
  });

  it('keeps deep path and query string', () => {
    expect(normalizeUrl('https://example.com/foo/bar?baz=1&x=2')).toBe(
      'example.com/foo/bar?baz=1&x=2',
    );
  });

  it('query on root results in root path preserved', () => {
    expect(normalizeUrl('https://example.com?q=hello')).toBe(
      'example.com/?q=hello',
    );
  });

  it('strips port and removes trailing dot together', () => {
    expect(normalizeUrl('http://example.com.:3000/api')).toBe(
      'example.com/api',
    );
  });

  it('strips www prefix', () => {
    expect(normalizeUrl('https://www.example.com/foo')).toBe('example.com/foo');
  });

  it('strips www2 prefix', () => {
    expect(normalizeUrl('https://www2.example.com/foo')).toBe(
      'example.com/foo',
    );
  });

  it('does not strip non-www subdomain', () => {
    expect(normalizeUrl('https://blog.example.com/foo')).toBe(
      'blog.example.com/foo',
    );
  });

  it('localhost with port', () => {
    expect(normalizeUrl('http://localhost:3000/api/v1?token=abc')).toBe(
      'localhost/api/v1?token=abc',
    );
  });
});

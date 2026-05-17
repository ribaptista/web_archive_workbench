'use client';

import { StatusBadge } from '@/components/StatusBadge';
import { replayUrl } from '@/lib/replay';
import type { Version } from '@/lib/api';

export function VersionRow({ v }: { v: Version }) {
  const ts = String(v.timestamp);
  return (
    <li className="flex items-center gap-2 px-4 py-2 text-sm flex-wrap">
      {v.status === 'ok' || v.status === 'redirect' ? (
        <a
          className="text-primary hover:underline"
          href={replayUrl(v.timestamp, v.url)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {ts}
        </a>
      ) : (
        <span className="text-muted-foreground">{ts}</span>
      )}

      <span
        className="text-muted-foreground text-xs font-mono truncate max-w-xs"
        title={v.url}
      >
        {v.url}
      </span>

      <StatusBadge status={v.status} />

      {v.status === 'redirect' && v.location_original && (
        <span className="text-muted-foreground text-xs">
          →{' '}
          <a
            className="hover:underline"
            href={replayUrl(v.location_timestamp!, v.location_original)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {v.location_original}
          </a>
        </span>
      )}

      {v.status === 'error' && (
        <>
          {v.error_code && (
            <code className="text-xs text-destructive">{v.error_code}</code>
          )}
          {v.error_message && (
            <span
              className="text-muted-foreground text-xs truncate max-w-xs"
              title={v.error_message}
            >
              {v.error_message}
            </span>
          )}
        </>
      )}
    </li>
  );
}

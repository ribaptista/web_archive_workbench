'use client';

import type { ErrorEntry } from '@/lib/api';

function DomainErrorRow({ entry }: { entry: ErrorEntry }) {
  return (
    <>
      {entry.errors.map((e, ei) => (
        <tr
          key={`${entry.url}|${entry.timestamp}|${ei}`}
          className="hover:bg-muted/40"
        >
          {ei === 0 ? (
            <>
              <td
                className="px-3 py-2 break-all max-w-xs align-top"
                rowSpan={entry.errors.length}
              >
                <span className="text-muted-foreground">{entry.url}</span>
              </td>
              <td
                className="px-3 py-2 whitespace-nowrap font-mono text-xs"
                rowSpan={entry.errors.length}
              >
                {entry.timestamp}
              </td>
            </>
          ) : null}
          <td className="px-3 py-2 whitespace-nowrap">
            <code className="text-xs text-destructive">{e.error_code}</code>
          </td>
          <td className="px-3 py-2 whitespace-nowrap text-xs">
            {e.error_name || <span className="text-muted-foreground">—</span>}
          </td>
          <td
            className="px-3 py-2 text-xs text-muted-foreground max-w-sm truncate"
            title={e.error_message}
          >
            {e.error_message}
          </td>
        </tr>
      ))}
    </>
  );
}

export function DomainErrorList({ entries }: { entries: ErrorEntry[] }) {
  if (entries.length === 0)
    return <p className="text-muted-foreground">No errors found.</p>;

  return (
    <div className="border rounded-md overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2 font-semibold">URL</th>
            <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">
              Timestamp
            </th>
            <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">
              Error Code
            </th>
            <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">
              Error Name
            </th>
            <th className="text-left px-3 py-2 font-semibold">Message</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {entries.map((entry) => (
            <DomainErrorRow
              key={`${entry.url}|${entry.timestamp}`}
              entry={entry}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

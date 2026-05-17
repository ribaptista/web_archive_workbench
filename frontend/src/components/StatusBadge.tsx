import { Badge } from '@/components/ui/badge';

const variants: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  done: 'default',
  ok: 'default',
  running: 'secondary',
  redirect: 'secondary',
  pending: 'outline',
  error: 'destructive',
};

/**
 * Renders a colored badge for a textual status. Unknown statuses fall back to
 * the `outline` variant with the raw status string as the label.
 */
export function StatusBadge({ status }: { status: string }) {
  const variant = variants[status] ?? 'outline';
  return <Badge variant={variant}>{status}</Badge>;
}

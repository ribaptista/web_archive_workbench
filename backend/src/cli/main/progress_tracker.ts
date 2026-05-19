import cliProgress from 'cli-progress';
import wrapAnsi from 'wrap-ansi';
import { AgentPool } from '../../http/agent_pool';

export type ProgressStats = {
  total: number;
  metrics: BarMetrics;
};

type BarMetrics = {
  succeeded: number;
  failed: number;
  scanned: number;
  newEntries: number;
};

const AGENTS_REFRESH_MS = 1_000;

/**
 * Pad `text` with trailing spaces so its visible length (newlines excluded)
 * is a multiple of `cols`. Used so that the log message fully overwrites the
 * progress bar previously drawn on the same line (workaround for a
 * cli-progress bug where the bar isn't fully cleared before log output).
 */
function padToColMultiple(text: string, cols: number): string {
  if (cols <= 0) return text;
  const visibleLen = text.length - (text.match(/\n/g)?.length ?? 0);
  const remainder = visibleLen % cols;
  if (remainder === 0) return text;
  return text + ' '.repeat(cols - remainder);
}

export class ProgressTracker {
  private total: number;
  private metrics: BarMetrics = {
    succeeded: 0,
    failed: 0,
    scanned: 0,
    newEntries: 0,
  };

  private multiBar: cliProgress.MultiBar;
  private bar: cliProgress.SingleBar | null = null;
  private agentsBar: cliProgress.SingleBar | null = null;
  private agentsInterval: ReturnType<typeof setInterval> | null = null;
  private readonly pool: AgentPool;

  constructor(total: number, pool: AgentPool) {
    this.total = total;
    this.pool = pool;
    this.multiBar = new cliProgress.MultiBar(
      {
        clearOnComplete: false,
        hideCursor: true,
        forceRedraw: true,
      },
      cliProgress.Presets.shades_classic,
    );
  }

  startProgressBar(): void {
    this.addDownloadsBar();
    this.addAgentsBar();
    this.agentsInterval = setInterval(
      () => this.refreshAgentsBar(),
      AGENTS_REFRESH_MS,
    );
  }

  private addDownloadsBar(): void {
    this.bar = this.multiBar.create(this.total, 0, this.metrics, {
      format:
        '[downloads] |{bar}| {value}/{total} | succeeded: {succeeded} | failed: {failed} | cdx scanned: {scanned} | new: {newEntries} | ETA: {eta_formatted}',
    });
  }

  private addAgentsBar(): void {
    const stats = this.pool.getStats();
    this.agentsBar = this.multiBar.create(
      stats.total,
      stats.idle,
      {
        inflight: stats.inflight,
        recovering: stats.recovering,
      },
      {
        format:
          '[agents]    |{bar}| {value}/{total} idle | inflight: {inflight} | recovering: {recovering}',
      },
    );
  }

  private refreshAgentsBar(): void {
    const s = this.pool.getStats();
    this.agentsBar!.setTotal(s.total);
    this.agentsBar!.update(s.idle, {
      inflight: s.inflight,
      recovering: s.recovering,
    });
  }

  stopProgressBar(): void {
    if (this.agentsInterval !== null) {
      clearInterval(this.agentsInterval);
      this.agentsInterval = null;
    }
    this.multiBar.stop();
  }

  log(msg: string): void {
    const cols = process.stdout.columns ?? 80;
    this.multiBar.log(padToColMultiple(wrapAnsi(msg, cols), cols) + '\n');
  }

  getStats(): ProgressStats {
    return {
      total: this.total,
      metrics: this.metrics,
    };
  }

  onEntriesSynced(scanned: number, newEntries: number): void {
    this.metrics.scanned += scanned;
    this.metrics.newEntries += newEntries;
    if (newEntries > 0) {
      this.total += newEntries;
      this.bar?.setTotal(this.total);
    }
    this.bar?.update(this.metrics);
  }

  pushResult(ok: boolean): void {
    if (ok) this.metrics.succeeded++;
    else this.metrics.failed++;
    this.bar?.increment(this.metrics);
  }
}

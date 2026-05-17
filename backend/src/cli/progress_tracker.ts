import cliProgress from 'cli-progress';

export type ProgressStats = {
  total: number;
  succeeded: number;
  failed: number;
};

export class ProgressTracker {
  private total: number;
  private succeeded = 0;
  private failed = 0;

  private multiBar: cliProgress.MultiBar;
  private bar: cliProgress.SingleBar | null = null;

  constructor(total: number) {
    this.total = total;
    this.multiBar = new cliProgress.MultiBar(
      {
        format:
          'Progress |{bar}| {value}/{total} | succeeded: {succeeded} | failed: {failed} | ETA: {eta_formatted}',
        clearOnComplete: false,
        hideCursor: true,
      },
      cliProgress.Presets.shades_classic,
    );
  }

  startProgressBar(): void {
    this.bar = this.multiBar.create(this.total, 0, {
      succeeded: this.succeeded,
      failed: this.failed,
    });
  }

  stopProgressBar(): void {
    this.multiBar.stop();
  }

  log(msg: string): void {
    this.multiBar.log(msg + '\n');
  }

  getStats(): ProgressStats {
    return {
      total: this.total,
      succeeded: this.succeeded,
      failed: this.failed,
    };
  }

  incrementTotal(count: number): void {
    this.total += count;
    this.bar?.setTotal(this.total);
  }

  pushResult(ok: boolean): void {
    if (ok) this.succeeded++;
    else this.failed++;
    this.bar?.increment({ succeeded: this.succeeded, failed: this.failed });
  }
}

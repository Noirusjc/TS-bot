import { dbLog } from '../utils/logger';

interface QueueTask<T> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

/**
 * A serial async queue that processes one TeamSpeak command at a time,
 * with configurable inter-command delay to respect ServerQuery rate limits.
 */
export class TSCommandQueue {
  private queue: QueueTask<unknown>[] = [];
  private processing = false;
  private readonly delayMs: number;

  /** @param delayMs  Minimum ms between commands (default 200) */
  constructor(delayMs = 200) {
    this.delayMs = delayMs;
  }

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ fn: fn as () => Promise<unknown>, resolve: resolve as (v: unknown) => void, reject });
      if (!this.processing) this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }
    this.processing = true;
    const task = this.queue.shift()!;
    try {
      const result = await task.fn();
      task.resolve(result);
    } catch (err) {
      task.reject(err);
    }
    // Throttle
    await new Promise((r) => setTimeout(r, this.delayMs));
    this.processNext();
  }

  get size(): number {
    return this.queue.length;
  }

  clearQueue(): void {
    for (const task of this.queue) {
      task.reject(new Error('Queue cleared'));
    }
    this.queue = [];
    void dbLog({ eventType: 'TS_QUEUE', message: 'Command queue cleared', level: 'WARN' });
  }
}

export const tsQueue = new TSCommandQueue(250);

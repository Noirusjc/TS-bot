/**
 * A serial async queue that processes one TeamSpeak command at a time,
 * with configurable inter-command delay to respect ServerQuery rate limits.
 */
export declare class TSCommandQueue {
    private queue;
    private processing;
    private readonly delayMs;
    /** @param delayMs  Minimum ms between commands (default 200) */
    constructor(delayMs?: number);
    enqueue<T>(fn: () => Promise<T>): Promise<T>;
    private processNext;
    get size(): number;
    clearQueue(): void;
}
export declare const tsQueue: TSCommandQueue;
//# sourceMappingURL=tsQueue.d.ts.map
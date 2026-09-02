"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tsQueue = exports.TSCommandQueue = void 0;
const logger_1 = require("../utils/logger");
/**
 * A serial async queue that processes one TeamSpeak command at a time,
 * with configurable inter-command delay to respect ServerQuery rate limits.
 */
class TSCommandQueue {
    /** @param delayMs  Minimum ms between commands (default 200) */
    constructor(delayMs = 200) {
        this.queue = [];
        this.processing = false;
        this.delayMs = delayMs;
    }
    enqueue(fn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ fn: fn, resolve: resolve, reject });
            if (!this.processing)
                this.processNext();
        });
    }
    async processNext() {
        if (this.queue.length === 0) {
            this.processing = false;
            return;
        }
        this.processing = true;
        const task = this.queue.shift();
        try {
            const result = await task.fn();
            task.resolve(result);
        }
        catch (err) {
            task.reject(err);
        }
        // Throttle
        await new Promise((r) => setTimeout(r, this.delayMs));
        this.processNext();
    }
    get size() {
        return this.queue.length;
    }
    clearQueue() {
        for (const task of this.queue) {
            task.reject(new Error('Queue cleared'));
        }
        this.queue = [];
        void (0, logger_1.dbLog)({ eventType: 'TS_QUEUE', message: 'Command queue cleared', level: 'WARN' });
    }
}
exports.TSCommandQueue = TSCommandQueue;
exports.tsQueue = new TSCommandQueue(250);
//# sourceMappingURL=tsQueue.js.map
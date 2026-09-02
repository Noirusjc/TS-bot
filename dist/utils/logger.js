"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.winstonLogger = void 0;
exports.initDbLogger = initDbLogger;
exports.dbLog = dbLog;
const winston_1 = __importDefault(require("winston"));
const { combine, timestamp, printf, colorize, errors } = winston_1.default.format;
const logFormat = printf(({ level, message, timestamp: ts, stack }) => {
    return `${ts} [${level.toUpperCase()}] ${stack || message}`;
});
exports.winstonLogger = winston_1.default.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), errors({ stack: true }), logFormat),
    transports: [
        new winston_1.default.transports.Console({
            format: combine(colorize(), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), errors({ stack: true }), logFormat),
        }),
    ],
});
// ─── DB Logger ────────────────────────────────────────────────────────────────
let prismaInstance = null;
function initDbLogger(prisma) {
    prismaInstance = prisma;
}
async function dbLog(opts) {
    // Always log to winston console
    const wLevel = opts.level === 'ERROR' ? 'error' : opts.level === 'WARN' ? 'warn' : 'info';
    exports.winstonLogger.log(wLevel, `[${opts.eventType}] ${opts.message}`);
    if (!prismaInstance)
        return;
    try {
        await prismaInstance.logEntry.create({
            data: {
                level: opts.level ?? 'INFO',
                eventType: opts.eventType,
                status: opts.status ?? 'success',
                message: opts.message,
                clientId: opts.clientId ?? null,
                channelId: opts.channelId ?? null,
                extra: opts.extra ? JSON.stringify(opts.extra) : null,
            },
        });
    }
    catch (err) {
        exports.winstonLogger.warn(`[LOGGER] Failed to write DB log: ${err.message}`);
    }
}
//# sourceMappingURL=logger.js.map
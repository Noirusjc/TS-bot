import winston from 'winston';
import path from 'path';
import { PrismaClient, LogLevel } from '@prisma/client';

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp: ts, stack }) => {
  return `${ts} [${level.toUpperCase()}] ${stack || message}`;
});

export const winstonLogger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), errors({ stack: true }), logFormat),
    }),
  ],
});

// ─── DB Logger ────────────────────────────────────────────────────────────────
let prismaInstance: PrismaClient | null = null;

export function initDbLogger(prisma: PrismaClient) {
  prismaInstance = prisma;
}

export interface DbLogOptions {
  level?: LogLevel;
  eventType: string;
  status?: string;
  message: string;
  clientId?: string;
  channelId?: string;
  extra?: Record<string, unknown>;
}

export async function dbLog(opts: DbLogOptions): Promise<void> {
  // Always log to winston console
  const wLevel = opts.level === 'ERROR' ? 'error' : opts.level === 'WARN' ? 'warn' : 'info';
  winstonLogger.log(wLevel, `[${opts.eventType}] ${opts.message}`);

  if (!prismaInstance) return;

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
  } catch (err) {
    winstonLogger.warn(`[LOGGER] Failed to write DB log: ${(err as Error).message}`);
  }
}

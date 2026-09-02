import winston from 'winston';
import { PrismaClient, LogLevel } from '@prisma/client';
export declare const winstonLogger: winston.Logger;
export declare function initDbLogger(prisma: PrismaClient): void;
export interface DbLogOptions {
    level?: LogLevel;
    eventType: string;
    status?: string;
    message: string;
    clientId?: string;
    channelId?: string;
    extra?: Record<string, unknown>;
}
export declare function dbLog(opts: DbLogOptions): Promise<void>;
//# sourceMappingURL=logger.d.ts.map
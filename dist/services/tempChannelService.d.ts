import { PrismaClient } from '@prisma/client';
export declare function initTempChannelService(prismaClient: PrismaClient): void;
export declare function handleClientMoved(params: {
    clientId: string;
    targetChannelId: string;
    clientUid: string;
    clientNickname: string;
}): Promise<void>;
export declare function handleChannelLeft(channelId: string): Promise<void>;
export declare function handleChannelJoined(channelId: string): Promise<void>;
export declare function runCleanupCycle(): Promise<void>;
export declare function startCleanupScheduler(): Promise<void>;
export declare function stopCleanupScheduler(): void;
//# sourceMappingURL=tempChannelService.d.ts.map
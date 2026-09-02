"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initTempChannelService = initTempChannelService;
exports.handleClientMoved = handleClientMoved;
exports.handleChannelLeft = handleChannelLeft;
exports.handleChannelJoined = handleChannelJoined;
exports.runCleanupCycle = runCleanupCycle;
exports.startCleanupScheduler = startCleanupScheduler;
exports.stopCleanupScheduler = stopCleanupScheduler;
const client_1 = require("@prisma/client");
const tsConnection_1 = require("./tsConnection");
const logger_1 = require("../utils/logger");
const helpers_1 = require("../utils/helpers");
const settings_1 = require("../utils/settings");
let prisma;
// In-memory dedup: prevent same clientId from triggering twice within 5s
const processingClients = new Set();
let cleanupTimer = null;
function initTempChannelService(prismaClient) {
    prisma = prismaClient;
}
// ─── Event Handler: User enters a channel ────────────────────────────────────
async function handleClientMoved(params) {
    const { clientId, targetChannelId, clientUid, clientNickname } = params;
    const enabled = await (0, settings_1.getSetting)('temp_channel_enabled', 'true');
    if (enabled !== 'true')
        return;
    const rule = await prisma.temporaryChannelRule.findFirst({
        where: { enabled: true, sourceChannelId: targetChannelId },
    });
    if (!rule)
        return;
    // Dedup guard
    if (processingClients.has(clientId)) {
        void (0, logger_1.dbLog)({ eventType: 'TEMP_CHANNEL_DEDUP', message: `Duplicate event ignored for client ${clientId}`, level: 'DEBUG' });
        return;
    }
    processingClients.add(clientId);
    setTimeout(() => processingClients.delete(clientId), 5000);
    void (0, logger_1.dbLog)({
        eventType: 'USER_JOINED_CREATE_CHANNEL',
        message: `${clientNickname} joined trigger channel (rule: ${rule.name})`,
        clientId,
        channelId: targetChannelId,
    });
    await createTemporaryChannel({ rule, clientId, clientUid, clientNickname });
}
// ─── Create Channel ───────────────────────────────────────────────────────────
async function createTemporaryChannel(params) {
    const { rule, clientId, clientUid, clientNickname } = params;
    const safeName = (0, helpers_1.sanitizeNickname)(clientNickname);
    const channelName = `${rule.channelNamePrefix}${rule.nameSeparator}${safeName}`;
    const password = rule.passwordEnabled ? (0, helpers_1.generatePassword)(rule.passwordLength, rule.passwordCharset) : null;
    let newChannelId = null;
    try {
        // Create the channel
        const newChannel = await tsConnection_1.tsManager.run(async (ts) => {
            return ts.channelCreate(channelName, {
                channelPassword: password ?? undefined,
                channelMaxclients: rule.maxClients > 0 ? rule.maxClients : undefined,
                channelFlagMaxclientsUnlimited: rule.maxClients <= 0 ? true : undefined,
                channelFlagPermanent: true,
                cpid: rule.parentChannelId ? rule.parentChannelId : undefined,
            });
        });
        if (!newChannel)
            throw new Error('Channel creation returned null (TS disconnected?)');
        newChannelId = newChannel.cid;
        void (0, logger_1.dbLog)({
            eventType: 'TEMP_CHANNEL_CREATED',
            message: `Created "${channelName}" (ID: ${newChannelId}) for ${clientNickname}`,
            clientId,
            channelId: newChannelId,
        });
        // Persist in DB
        const dbChannel = await prisma.temporaryChannel.create({
            data: {
                tsChannelId: newChannelId,
                ruleId: rule.id,
                ownerUid: clientUid,
                ownerNickname: safeName,
                status: client_1.ChannelStatus.ACTIVE,
            },
        });
        // Verify client still online
        const clientInfo = await tsConnection_1.tsManager.run((ts) => ts.getClientById(clientId));
        if (!clientInfo) {
            void (0, logger_1.dbLog)({
                eventType: 'USER_DISCONNECTED_DURING_CREATION',
                message: `Client ${clientId} disconnected before move; cleaning up channel ${newChannelId}`,
                clientId,
                channelId: newChannelId,
                level: 'WARN',
            });
            await safeDeleteChannel(newChannelId, dbChannel.id, 'user disconnected during creation');
            return;
        }
        // Move client to new channel
        const moved = await tsConnection_1.tsManager.run((ts) => ts.clientMove(clientId, newChannelId));
        if (moved !== null) {
            void (0, logger_1.dbLog)({
                eventType: 'USER_MOVED',
                message: `Moved ${clientNickname} to channel ${newChannelId}`,
                clientId,
                channelId: newChannelId,
            });
        }
        // Assign channel group if configured
        if (rule.channelGroupId) {
            try {
                await tsConnection_1.tsManager.run((ts) => ts.setClientChannelGroup(rule.channelGroupId, newChannelId, clientInfo.databaseId));
                void (0, logger_1.dbLog)({
                    eventType: 'CHANNEL_GROUP_ASSIGNED',
                    message: `Assigned channel group ${rule.channelGroupId} to ${clientNickname}`,
                    clientId,
                    channelId: newChannelId,
                });
            }
            catch (err) {
                void (0, logger_1.dbLog)({
                    eventType: 'CHANNEL_GROUP_FAILED',
                    message: `Failed to assign channel group: ${err.message}`,
                    clientId,
                    channelId: newChannelId,
                    level: 'WARN',
                    status: 'error',
                });
            }
        }
        // Send poke message
        await sendPokeMessage({ clientId, clientNickname, channelName, password });
    }
    catch (err) {
        void (0, logger_1.dbLog)({
            eventType: 'TEMP_CHANNEL_CREATE_ERROR',
            message: `Failed to create channel for ${clientNickname}: ${err.message}`,
            clientId,
            level: 'ERROR',
            status: 'error',
        });
        // If channel was created but something after failed, try to clean it up
        if (newChannelId) {
            const dbCh = await prisma.temporaryChannel.findUnique({ where: { tsChannelId: newChannelId } }).catch(() => null);
            if (dbCh)
                await safeDeleteChannel(newChannelId, dbCh.id, 'post-creation error cleanup');
        }
    }
}
// ─── Poke ─────────────────────────────────────────────────────────────────────
async function sendPokeMessage(params) {
    const { clientId, clientNickname, channelName, password } = params;
    const pokeSettings = await (0, settings_1.getPokeSettings)();
    const template = password ? pokeSettings.template : pokeSettings.templateNoPassword;
    const message = (0, helpers_1.fillTemplate)(template, {
        USER_NICKNAME: clientNickname,
        CHANNEL_NAME: channelName,
        CHANNEL_PASSWORD: password ?? '',
    });
    // Send each non-empty line as a separate poke (TS limit ~100 chars/line)
    const lines = message.split('\n').filter((l) => l.trim().length > 0);
    for (const line of lines) {
        try {
            await tsConnection_1.tsManager.run((ts) => ts.clientPoke(clientId, line.slice(0, 100)));
        }
        catch (err) {
            void (0, logger_1.dbLog)({
                eventType: 'POKE_FAILED',
                message: `Poke failed for client ${clientId}: ${err.message}`,
                clientId,
                level: 'WARN',
                status: 'error',
            });
            break;
        }
    }
    void (0, logger_1.dbLog)({
        eventType: 'POKE_SENT',
        message: `Poke sent to ${clientNickname} (password: ${password ? 'yes' : 'no'})`,
        clientId,
    });
}
// ─── Channel Empty Detection ──────────────────────────────────────────────────
async function handleChannelLeft(channelId) {
    const dbChannel = await prisma.temporaryChannel.findUnique({ where: { tsChannelId: channelId } });
    if (!dbChannel || dbChannel.status === client_1.ChannelStatus.DELETED)
        return;
    // Check remaining clients in channel
    const clients = await tsConnection_1.tsManager.run((ts) => ts.clientList({ cid: channelId }));
    if (clients === null)
        return; // TS disconnected, skip
    const realClients = clients.filter((c) => c.type === 0);
    if (realClients.length > 0) {
        // Still has users — ensure active state
        if (dbChannel.status === client_1.ChannelStatus.EMPTY) {
            await prisma.temporaryChannel.update({
                where: { tsChannelId: channelId },
                data: { status: client_1.ChannelStatus.ACTIVE, emptySince: null, deleteAt: null, lastActiveAt: new Date() },
            });
            void (0, logger_1.dbLog)({ eventType: 'CHANNEL_DELETION_CANCELLED', message: `Channel ${channelId} still has users`, channelId });
        }
        return;
    }
    // Channel is empty — schedule deletion
    const rule = await prisma.temporaryChannelRule.findUnique({ where: { id: dbChannel.ruleId } });
    const delaySeconds = rule?.deletionDelay ?? 180;
    const now = new Date();
    const deleteAt = new Date(now.getTime() + delaySeconds * 1000);
    await prisma.temporaryChannel.update({
        where: { tsChannelId: channelId },
        data: { status: client_1.ChannelStatus.EMPTY, emptySince: now, deleteAt },
    });
    void (0, logger_1.dbLog)({
        eventType: 'CHANNEL_BECAME_EMPTY',
        message: `Channel ${channelId} is empty — scheduled deletion at ${deleteAt.toISOString()}`,
        channelId,
    });
}
async function handleChannelJoined(channelId) {
    const dbChannel = await prisma.temporaryChannel.findUnique({ where: { tsChannelId: channelId } });
    if (!dbChannel || dbChannel.status !== client_1.ChannelStatus.EMPTY)
        return;
    await prisma.temporaryChannel.update({
        where: { tsChannelId: channelId },
        data: { status: client_1.ChannelStatus.ACTIVE, emptySince: null, deleteAt: null, lastActiveAt: new Date() },
    });
    void (0, logger_1.dbLog)({
        eventType: 'CHANNEL_DELETION_CANCELLED',
        message: `Channel ${channelId} joined again — deletion cancelled`,
        channelId,
    });
}
// ─── Periodic Cleanup ─────────────────────────────────────────────────────────
async function runCleanupCycle() {
    const now = new Date();
    const due = await prisma.temporaryChannel.findMany({
        where: { status: client_1.ChannelStatus.EMPTY, deleteAt: { lte: now } },
    });
    for (const ch of due) {
        await safeDeleteChannel(ch.tsChannelId, ch.id, 'empty for deletion delay period');
    }
}
async function startCleanupScheduler() {
    await recoverChannelsOnStartup();
    cleanupTimer = setInterval(async () => {
        try {
            await runCleanupCycle();
        }
        catch (err) {
            void (0, logger_1.dbLog)({ eventType: 'CLEANUP_ERROR', message: `Cleanup error: ${err.message}`, level: 'ERROR', status: 'error' });
        }
    }, 30000);
}
function stopCleanupScheduler() {
    if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
    }
}
// ─── Startup Recovery ─────────────────────────────────────────────────────────
async function recoverChannelsOnStartup() {
    void (0, logger_1.dbLog)({ eventType: 'APP_STARTUP_RECOVERY', message: 'Recovering tracked channels on startup...', level: 'INFO' });
    const channels = await prisma.temporaryChannel.findMany({
        where: { status: { in: [client_1.ChannelStatus.ACTIVE, client_1.ChannelStatus.EMPTY] } },
    });
    for (const ch of channels) {
        const tsChannel = await tsConnection_1.tsManager.run((ts) => ts.getChannelById(ch.tsChannelId));
        if (!tsChannel) {
            // Channel gone from TS — mark deleted
            await prisma.temporaryChannel.update({ where: { id: ch.id }, data: { status: client_1.ChannelStatus.DELETED } });
            continue;
        }
        // Past deadline — delete now
        if (ch.deleteAt && ch.deleteAt <= new Date()) {
            await safeDeleteChannel(ch.tsChannelId, ch.id, 'past deletion deadline on restart');
        }
    }
    void (0, logger_1.dbLog)({ eventType: 'APP_STARTUP_RECOVERY', message: 'Channel recovery complete', level: 'INFO' });
}
// ─── Safe Delete ──────────────────────────────────────────────────────────────
async function safeDeleteChannel(tsChannelId, dbId, reason) {
    try {
        await tsConnection_1.tsManager.run((ts) => ts.channelDelete(tsChannelId, true));
        void (0, logger_1.dbLog)({ eventType: 'CHANNEL_DELETED', message: `Deleted channel ${tsChannelId} — ${reason}`, channelId: tsChannelId });
    }
    catch (err) {
        void (0, logger_1.dbLog)({
            eventType: 'CHANNEL_DELETE_FAILED',
            message: `Failed to delete channel ${tsChannelId}: ${err.message}`,
            channelId: tsChannelId, level: 'WARN', status: 'error',
        });
    }
    try {
        await prisma.temporaryChannel.update({
            where: { id: dbId },
            data: { status: client_1.ChannelStatus.DELETED, deleteAt: null, emptySince: null },
        });
    }
    catch { /* already deleted */ }
}
//# sourceMappingURL=tempChannelService.js.map
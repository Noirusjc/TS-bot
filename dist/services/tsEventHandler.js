"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTSEvents = registerTSEvents;
const logger_1 = require("../utils/logger");
const tempChannelService_1 = require("./tempChannelService");
/**
 * Register all TeamSpeak event listeners.
 * Called each time a (re)connection is established.
 */
async function registerTSEvents(ts) {
    try {
        await ts.registerEvent('server');
        await ts.registerEvent('channel', '0'); // 0 = all channels
        await ts.registerEvent('textserver');
    }
    catch (err) {
        void (0, logger_1.dbLog)({
            eventType: 'TS_EVENT_REGISTER_FAILED',
            message: `Failed to register TS events: ${err.message}`,
            level: 'ERROR',
            status: 'error',
        });
        return;
    }
    void (0, logger_1.dbLog)({ eventType: 'TS_EVENTS_REGISTERED', message: 'TeamSpeak events registered' });
    // ─── Client Moved Between Channels ────────────────────────────────────────
    ts.on('clientmoved', async (event) => {
        const client = event.client;
        const channel = event.channel;
        // Skip ServerQuery clients (type 1)
        if (client.type === 1)
            return;
        try {
            // User moved INTO a channel — check if it's a trigger channel
            await (0, tempChannelService_1.handleClientMoved)({
                clientId: client.clid,
                targetChannelId: channel.cid,
                clientUid: client.uniqueIdentifier ?? '',
                clientNickname: client.nickname ?? 'Unknown',
            });
            // Also: check if destination channel is a managed empty channel
            await (0, tempChannelService_1.handleChannelJoined)(channel.cid);
        }
        catch (err) {
            void (0, logger_1.dbLog)({
                eventType: 'EVENT_HANDLER_ERROR',
                message: `clientmoved handler error: ${err.message}`,
                level: 'ERROR',
                status: 'error',
            });
        }
    });
    // ─── Client Disconnected / Left Server ────────────────────────────────────
    ts.on('clientdisconnect', async (event) => {
        // The raw event has cfid (from channel id) in event.event
        const fromChannelId = event.event?.cfid;
        if (!fromChannelId)
            return;
        // Skip query client disconnects (type check unavailable here, use channel check)
        try {
            await (0, tempChannelService_1.handleChannelLeft)(fromChannelId);
        }
        catch (err) {
            void (0, logger_1.dbLog)({
                eventType: 'EVENT_HANDLER_ERROR',
                message: `clientdisconnect handler error: ${err.message}`,
                level: 'ERROR',
                status: 'error',
            });
        }
    });
    // ─── Client Connected / Joined Server ─────────────────────────────────────
    ts.on('clientconnect', async (event) => {
        const client = event.client;
        if (!client || client.type === 1)
            return;
        try {
            await (0, tempChannelService_1.handleChannelJoined)(client.cid);
            // Also check if this is a trigger channel join
            await (0, tempChannelService_1.handleClientMoved)({
                clientId: client.clid,
                targetChannelId: client.cid,
                clientUid: client.uniqueIdentifier ?? '',
                clientNickname: client.nickname ?? 'Unknown',
            });
        }
        catch (err) {
            void (0, logger_1.dbLog)({
                eventType: 'EVENT_HANDLER_ERROR',
                message: `clientconnect handler error: ${err.message}`,
                level: 'ERROR',
                status: 'error',
            });
        }
    });
}
//# sourceMappingURL=tsEventHandler.js.map
import { TeamSpeak, ClientMovedEvent, ClientDisconnectEvent, ClientConnectEvent } from 'ts3-nodejs-library';
import { dbLog } from '../utils/logger';
import { handleClientMoved, handleChannelLeft, handleChannelJoined } from './tempChannelService';

/**
 * Register all TeamSpeak event listeners.
 * Called each time a (re)connection is established.
 */
export async function registerTSEvents(ts: TeamSpeak): Promise<void> {
  try {
    await ts.registerEvent('server');
    await ts.registerEvent('channel', '0'); // 0 = all channels
    await ts.registerEvent('textserver');
  } catch (err) {
    void dbLog({
      eventType: 'TS_EVENT_REGISTER_FAILED',
      message: `Failed to register TS events: ${(err as Error).message}`,
      level: 'ERROR',
      status: 'error',
    });
    return;
  }

  void dbLog({ eventType: 'TS_EVENTS_REGISTERED', message: 'TeamSpeak events registered' });

  // ─── Client Moved Between Channels ────────────────────────────────────────
  ts.on('clientmoved', async (event: ClientMovedEvent) => {
    const client = event.client;
    const channel = event.channel;

    // Skip ServerQuery clients (type 1)
    if (client.type === 1) return;

    try {
      // User moved INTO a channel — check if it's a trigger channel
      await handleClientMoved({
        clientId: client.clid,
        targetChannelId: channel.cid,
        clientUid: client.uniqueIdentifier ?? '',
        clientNickname: client.nickname ?? 'Unknown',
      });
      // Also: check if destination channel is a managed empty channel
      await handleChannelJoined(channel.cid);
    } catch (err) {
      void dbLog({
        eventType: 'EVENT_HANDLER_ERROR',
        message: `clientmoved handler error: ${(err as Error).message}`,
        level: 'ERROR',
        status: 'error',
      });
    }
  });

  // ─── Client Disconnected / Left Server ────────────────────────────────────
  ts.on('clientdisconnect', async (event: ClientDisconnectEvent) => {
    // The raw event has cfid (from channel id) in event.event
    const fromChannelId = event.event?.cfid;
    if (!fromChannelId) return;

    // Skip query client disconnects (type check unavailable here, use channel check)
    try {
      await handleChannelLeft(fromChannelId);
    } catch (err) {
      void dbLog({
        eventType: 'EVENT_HANDLER_ERROR',
        message: `clientdisconnect handler error: ${(err as Error).message}`,
        level: 'ERROR',
        status: 'error',
      });
    }
  });

  // ─── Client Connected / Joined Server ─────────────────────────────────────
  ts.on('clientconnect', async (event: ClientConnectEvent) => {
    const client = event.client;
    if (!client || client.type === 1) return;

    try {
      await handleChannelJoined(client.cid);
      // Also check if this is a trigger channel join
      await handleClientMoved({
        clientId: client.clid,
        targetChannelId: client.cid,
        clientUid: client.uniqueIdentifier ?? '',
        clientNickname: client.nickname ?? 'Unknown',
      });
    } catch (err) {
      void dbLog({
        eventType: 'EVENT_HANDLER_ERROR',
        message: `clientconnect handler error: ${(err as Error).message}`,
        level: 'ERROR',
        status: 'error',
      });
    }
  });
}

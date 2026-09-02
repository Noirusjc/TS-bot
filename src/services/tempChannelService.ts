import { PrismaClient, TemporaryChannelRule, ChannelStatus } from '@prisma/client';
import { tsManager } from './tsConnection';
import { dbLog } from '../utils/logger';
import { generatePassword, sanitizeNickname, fillTemplate } from '../utils/helpers';
import { getPokeSettings, getSetting } from '../utils/settings';

let prisma: PrismaClient;

// In-memory dedup: prevent same clientId from triggering twice within 5s
const processingClients = new Set<string>();

let cleanupTimer: NodeJS.Timeout | null = null;

export function initTempChannelService(prismaClient: PrismaClient) {
  prisma = prismaClient;
}

// ─── Event Handler: User enters a channel ────────────────────────────────────

export async function handleClientMoved(params: {
  clientId: string;
  targetChannelId: string;
  clientUid: string;
  clientNickname: string;
}): Promise<void> {
  const { clientId, targetChannelId, clientUid, clientNickname } = params;

  const enabled = await getSetting('temp_channel_enabled', 'true');
  if (enabled !== 'true') return;

  const rule = await prisma.temporaryChannelRule.findFirst({
    where: { enabled: true, sourceChannelId: targetChannelId },
  });
  if (!rule) return;

  // Dedup guard
  if (processingClients.has(clientId)) {
    void dbLog({ eventType: 'TEMP_CHANNEL_DEDUP', message: `Duplicate event ignored for client ${clientId}`, level: 'DEBUG' });
    return;
  }
  processingClients.add(clientId);
  setTimeout(() => processingClients.delete(clientId), 5000);

  void dbLog({
    eventType: 'USER_JOINED_CREATE_CHANNEL',
    message: `${clientNickname} joined trigger channel (rule: ${rule.name})`,
    clientId,
    channelId: targetChannelId,
  });

  await createTemporaryChannel({ rule, clientId, clientUid, clientNickname });
}

// ─── Create Channel ───────────────────────────────────────────────────────────

async function createTemporaryChannel(params: {
  rule: TemporaryChannelRule;
  clientId: string;
  clientUid: string;
  clientNickname: string;
}): Promise<void> {
  const { rule, clientId, clientUid, clientNickname } = params;

  const safeName = sanitizeNickname(clientNickname);
  const channelName = `${rule.channelNamePrefix}${rule.nameSeparator}${safeName}`;
  const password = rule.passwordEnabled ? generatePassword(rule.passwordLength, rule.passwordCharset) : null;

  let newChannelId: string | null = null;

  try {
    // Create the channel
    const newChannel = await tsManager.run(async (ts) => {
      return ts.channelCreate(channelName, {
        channelPassword: password ?? undefined,
        channelMaxclients: rule.maxClients > 0 ? rule.maxClients : undefined,
        channelFlagMaxclientsUnlimited: rule.maxClients <= 0 ? true : undefined,
        channelFlagPermanent: true,
        cpid: rule.parentChannelId ? rule.parentChannelId : undefined,
      });
    });

    if (!newChannel) throw new Error('Channel creation returned null (TS disconnected?)');

    newChannelId = newChannel.cid;

    void dbLog({
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
        status: ChannelStatus.ACTIVE,
      },
    });

    // Verify client still online
    const clientInfo = await tsManager.run((ts) => ts.getClientById(clientId));
    if (!clientInfo) {
      void dbLog({
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
    const moved = await tsManager.run((ts) => ts.clientMove(clientId, newChannelId!));
    if (moved !== null) {
      void dbLog({
        eventType: 'USER_MOVED',
        message: `Moved ${clientNickname} to channel ${newChannelId}`,
        clientId,
        channelId: newChannelId,
      });
    }

    // Assign channel group if configured
    if (rule.channelGroupId) {
      try {
        await tsManager.run((ts) =>
          ts.setClientChannelGroup(rule.channelGroupId!, newChannelId!, clientInfo.databaseId)
        );
        void dbLog({
          eventType: 'CHANNEL_GROUP_ASSIGNED',
          message: `Assigned channel group ${rule.channelGroupId} to ${clientNickname}`,
          clientId,
          channelId: newChannelId,
        });
      } catch (err) {
        void dbLog({
          eventType: 'CHANNEL_GROUP_FAILED',
          message: `Failed to assign channel group: ${(err as Error).message}`,
          clientId,
          channelId: newChannelId,
          level: 'WARN',
          status: 'error',
        });
      }
    }

    // Send poke message
    await sendPokeMessage({ clientId, clientNickname, channelName, password });

  } catch (err) {
    void dbLog({
      eventType: 'TEMP_CHANNEL_CREATE_ERROR',
      message: `Failed to create channel for ${clientNickname}: ${(err as Error).message}`,
      clientId,
      level: 'ERROR',
      status: 'error',
    });
    // If channel was created but something after failed, try to clean it up
    if (newChannelId) {
      const dbCh = await prisma.temporaryChannel.findUnique({ where: { tsChannelId: newChannelId } }).catch(() => null);
      if (dbCh) await safeDeleteChannel(newChannelId, dbCh.id, 'post-creation error cleanup');
    }
  }
}

// ─── Poke ─────────────────────────────────────────────────────────────────────

async function sendPokeMessage(params: {
  clientId: string;
  clientNickname: string;
  channelName: string;
  password: string | null;
}): Promise<void> {
  const { clientId, clientNickname, channelName, password } = params;
  const pokeSettings = await getPokeSettings();
  const template = password ? pokeSettings.template : pokeSettings.templateNoPassword;

  const message = fillTemplate(template, {
    USER_NICKNAME: clientNickname,
    CHANNEL_NAME: channelName,
    CHANNEL_PASSWORD: password ?? '',
  });

  // Send each non-empty line as a separate poke (TS limit ~100 chars/line)
  const lines = message.split('\n').filter((l) => l.trim().length > 0);
  for (const line of lines) {
    try {
      await tsManager.run((ts) => ts.clientPoke(clientId, line.slice(0, 100)));
    } catch (err) {
      void dbLog({
        eventType: 'POKE_FAILED',
        message: `Poke failed for client ${clientId}: ${(err as Error).message}`,
        clientId,
        level: 'WARN',
        status: 'error',
      });
      break;
    }
  }

  void dbLog({
    eventType: 'POKE_SENT',
    message: `Poke sent to ${clientNickname} (password: ${password ? 'yes' : 'no'})`,
    clientId,
  });
}

// ─── Channel Empty Detection ──────────────────────────────────────────────────

export async function handleChannelLeft(channelId: string): Promise<void> {
  const dbChannel = await prisma.temporaryChannel.findUnique({ where: { tsChannelId: channelId } });
  if (!dbChannel || dbChannel.status === ChannelStatus.DELETED) return;

  // Check remaining clients in channel
  const clients = await tsManager.run((ts) => ts.clientList({ cid: channelId } as never));
  if (clients === null) return; // TS disconnected, skip

  const realClients = clients.filter((c) => c.type === 0);

  if (realClients.length > 0) {
    // Still has users — ensure active state
    if (dbChannel.status === ChannelStatus.EMPTY) {
      await prisma.temporaryChannel.update({
        where: { tsChannelId: channelId },
        data: { status: ChannelStatus.ACTIVE, emptySince: null, deleteAt: null, lastActiveAt: new Date() },
      });
      void dbLog({ eventType: 'CHANNEL_DELETION_CANCELLED', message: `Channel ${channelId} still has users`, channelId });
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
    data: { status: ChannelStatus.EMPTY, emptySince: now, deleteAt },
  });

  void dbLog({
    eventType: 'CHANNEL_BECAME_EMPTY',
    message: `Channel ${channelId} is empty — scheduled deletion at ${deleteAt.toISOString()}`,
    channelId,
  });
}

export async function handleChannelJoined(channelId: string): Promise<void> {
  const dbChannel = await prisma.temporaryChannel.findUnique({ where: { tsChannelId: channelId } });
  if (!dbChannel || dbChannel.status !== ChannelStatus.EMPTY) return;

  await prisma.temporaryChannel.update({
    where: { tsChannelId: channelId },
    data: { status: ChannelStatus.ACTIVE, emptySince: null, deleteAt: null, lastActiveAt: new Date() },
  });

  void dbLog({
    eventType: 'CHANNEL_DELETION_CANCELLED',
    message: `Channel ${channelId} joined again — deletion cancelled`,
    channelId,
  });
}

// ─── Periodic Cleanup ─────────────────────────────────────────────────────────

export async function runCleanupCycle(): Promise<void> {
  const now = new Date();
  const due = await prisma.temporaryChannel.findMany({
    where: { status: ChannelStatus.EMPTY, deleteAt: { lte: now } },
  });

  for (const ch of due) {
    await safeDeleteChannel(ch.tsChannelId, ch.id, 'empty for deletion delay period');
  }
}

export async function startCleanupScheduler(): Promise<void> {
  await recoverChannelsOnStartup();
  cleanupTimer = setInterval(async () => {
    try { await runCleanupCycle(); } catch (err) {
      void dbLog({ eventType: 'CLEANUP_ERROR', message: `Cleanup error: ${(err as Error).message}`, level: 'ERROR', status: 'error' });
    }
  }, 30_000);
}

export function stopCleanupScheduler(): void {
  if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
}

// ─── Startup Recovery ─────────────────────────────────────────────────────────

async function recoverChannelsOnStartup(): Promise<void> {
  void dbLog({ eventType: 'APP_STARTUP_RECOVERY', message: 'Recovering tracked channels on startup...', level: 'INFO' });

  const channels = await prisma.temporaryChannel.findMany({
    where: { status: { in: [ChannelStatus.ACTIVE, ChannelStatus.EMPTY] } },
  });

  for (const ch of channels) {
    const tsChannel = await tsManager.run((ts) => ts.getChannelById(ch.tsChannelId));

    if (!tsChannel) {
      // Channel gone from TS — mark deleted
      await prisma.temporaryChannel.update({ where: { id: ch.id }, data: { status: ChannelStatus.DELETED } });
      continue;
    }

    // Past deadline — delete now
    if (ch.deleteAt && ch.deleteAt <= new Date()) {
      await safeDeleteChannel(ch.tsChannelId, ch.id, 'past deletion deadline on restart');
    }
  }

  void dbLog({ eventType: 'APP_STARTUP_RECOVERY', message: 'Channel recovery complete', level: 'INFO' });
}

// ─── Safe Delete ──────────────────────────────────────────────────────────────

async function safeDeleteChannel(tsChannelId: string, dbId: number, reason: string): Promise<void> {
  try {
    await tsManager.run((ts) => ts.channelDelete(tsChannelId, true));
    void dbLog({ eventType: 'CHANNEL_DELETED', message: `Deleted channel ${tsChannelId} — ${reason}`, channelId: tsChannelId });
  } catch (err) {
    void dbLog({
      eventType: 'CHANNEL_DELETE_FAILED',
      message: `Failed to delete channel ${tsChannelId}: ${(err as Error).message}`,
      channelId: tsChannelId, level: 'WARN', status: 'error',
    });
  }

  try {
    await prisma.temporaryChannel.update({
      where: { id: dbId },
      data: { status: ChannelStatus.DELETED, deleteAt: null, emptySince: null },
    });
  } catch { /* already deleted */ }
}

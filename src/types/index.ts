// ─── Shared Types ─────────────────────────────────────────────────────────────

export type BotStatus = 'starting' | 'running' | 'setup_required' | 'degraded' | 'error';
export type TSConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'reconnecting' | 'not_configured';

export interface StatusPayload {
  botStatus: BotStatus;
  tsStatus: TSConnectionStatus;
  setupComplete: boolean;
  uptime: number;
  activeChannels: number;
  createdToday: number;
  deletedToday: number;
  clockEnabled: boolean;
  dateEnabled: boolean;
}

export interface TempChannelRulePayload {
  id?: number;
  name: string;
  enabled: boolean;
  sourceChannelId: string;
  parentChannelId: string | null;
  channelNamePrefix: string;
  nameSeparator: string;
  passwordEnabled: boolean;
  passwordLength: number;
  passwordCharset: string;
  maxClients: number;
  channelGroupId: string | null;
  deletionDelay: number;
}

export interface ClockDateSettings {
  clockEnabled: boolean;
  clockChannelId: string;
  clockFormat: string;
  clockUpdateInterval: number;
  dateEnabled: boolean;
  dateChannelId: string;
  dateFormat: string;
  dateUpdateInterval: number;
}

export interface PokeSettings {
  template: string;
  templateNoPassword: string;
}

export interface LogFilter {
  level?: string;
  eventType?: string;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface SetupPayload {
  // TeamSpeak
  tsHost: string;
  tsQueryPort: number;
  tsQueryUsername: string;
  tsQueryPassword: string;
  tsVirtualServerId: number;
  tsBotNickname?: string;
  // Admin account
  adminUsername: string;
  adminPassword: string;
  // Temp channel (optional basic config)
  tempChannelEnabled: boolean;
  sourceChannelId?: string;
  parentChannelId?: string;
  channelNamePrefix?: string;
  channelGroupId?: string;
  // Optional clock/date
  clockChannelId?: string;
  dateChannelId?: string;
}

// Express session augmentation
declare module 'express-session' {
  interface SessionData {
    userId: number;
    username: string;
    loginAt: number;
  }
}

import { PrismaClient } from '@prisma/client';
import { ClockDateSettings, PokeSettings } from '../types';
import type { TSConfig } from './config';
export declare function initSettings(prisma: PrismaClient): void;
export declare function getSetting(key: string, fallback?: string): Promise<string>;
export declare function setSetting(key: string, value: string): Promise<void>;
export declare function setSettings(pairs: Record<string, string>): Promise<void>;
/**
 * Returns true when the first-time setup wizard has been completed.
 * The flag is stored in the settings table as setup_complete=true.
 */
export declare function isSetupComplete(): Promise<boolean>;
export declare function markSetupComplete(): Promise<void>;
/**
 * Load TeamSpeak connection config from the database.
 * Returns null when setup has not been completed yet.
 */
export declare function getTSConfig(): Promise<TSConfig | null>;
export declare function saveTSConfig(cfg: TSConfig): Promise<void>;
export declare function getClockDateSettings(): Promise<ClockDateSettings>;
export declare function getPokeSettings(): Promise<PokeSettings>;
export declare function ensureDefaultSettings(): Promise<void>;
//# sourceMappingURL=settings.d.ts.map
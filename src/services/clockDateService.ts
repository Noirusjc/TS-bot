import moment from 'moment-timezone';
import jMoment from 'jalali-moment';
import { tsManager } from './tsConnection';
import { dbLog } from '../utils/logger';
import { getClockDateSettings } from '../utils/settings';

// Cache last sent values to avoid redundant TS renames
let lastClockValue = '';
let lastDateValue = '';

let clockTimer: NodeJS.Timeout | null = null;
let dateTimer: NodeJS.Timeout | null = null;

// ─── Formatters ───────────────────────────────────────────────────────────────

export function formatIranClock(format: string): string {
  return moment().tz('Asia/Tehran').format(format);
}

export function formatIranDate(format: string): string {
  // Convert Gregorian tokens to Jalali tokens
  const jalaliFormat = format
    .replace(/YYYY/g, 'jYYYY')
    .replace(/MM/g, 'jMM')
    .replace(/DD/g, 'jDD');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (jMoment as any)().locale('fa').tz('Asia/Tehran').format(jalaliFormat);
}

// ─── Updaters ─────────────────────────────────────────────────────────────────

async function updateClock(): Promise<void> {
  const settings = await getClockDateSettings();
  if (!settings.clockEnabled || !settings.clockChannelId) return;

  const newValue = formatIranClock(settings.clockFormat);
  if (newValue === lastClockValue) return;

  const result = await tsManager.run((ts) =>
    ts.channelEdit(settings.clockChannelId, { channelName: newValue })
  );

  if (result !== null) {
    lastClockValue = newValue;
    void dbLog({ eventType: 'CLOCK_UPDATED', message: `Clock → ${newValue}`, channelId: settings.clockChannelId });
  }
}

async function updateDate(): Promise<void> {
  const settings = await getClockDateSettings();
  if (!settings.dateEnabled || !settings.dateChannelId) return;

  const newValue = formatIranDate(settings.dateFormat);
  if (newValue === lastDateValue) return;

  const result = await tsManager.run((ts) =>
    ts.channelEdit(settings.dateChannelId, { channelName: newValue })
  );

  if (result !== null) {
    lastDateValue = newValue;
    void dbLog({ eventType: 'DATE_UPDATED', message: `Date → ${newValue}`, channelId: settings.dateChannelId });
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

export async function startClockDateService(): Promise<void> {
  stopClockDateService();
  const settings = await getClockDateSettings();

  if (settings.clockEnabled && settings.clockChannelId) {
    const ms = Math.max(settings.clockUpdateInterval, 10) * 1000;
    await updateClock().catch(() => { /* ignore first-run error */ });
    clockTimer = setInterval(async () => {
      try { await updateClock(); } catch { /* ignore */ }
    }, ms);
    void dbLog({ eventType: 'CLOCK_SERVICE_STARTED', message: `Clock updater started (${settings.clockUpdateInterval}s interval)` });
  }

  if (settings.dateEnabled && settings.dateChannelId) {
    const ms = Math.max(settings.dateUpdateInterval, 10) * 1000;
    await updateDate().catch(() => { /* ignore first-run error */ });
    dateTimer = setInterval(async () => {
      try { await updateDate(); } catch { /* ignore */ }
    }, ms);
    void dbLog({ eventType: 'DATE_SERVICE_STARTED', message: `Date updater started (${settings.dateUpdateInterval}s interval)` });
  }
}

export function stopClockDateService(): void {
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  if (dateTimer)  { clearInterval(dateTimer);  dateTimer  = null; }
  lastClockValue = '';
  lastDateValue  = '';
}

/** Preview helpers for the API */
export function previewClock(format: string): string {
  try { return formatIranClock(format); } catch { return 'Invalid format'; }
}

export function previewDate(format: string): string {
  try { return formatIranDate(format); } catch { return 'Invalid format'; }
}

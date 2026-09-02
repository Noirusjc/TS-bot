"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatIranClock = formatIranClock;
exports.formatIranDate = formatIranDate;
exports.startClockDateService = startClockDateService;
exports.stopClockDateService = stopClockDateService;
exports.previewClock = previewClock;
exports.previewDate = previewDate;
const moment_timezone_1 = __importDefault(require("moment-timezone"));
const jalali_moment_1 = __importDefault(require("jalali-moment"));
const tsConnection_1 = require("./tsConnection");
const logger_1 = require("../utils/logger");
const settings_1 = require("../utils/settings");
// Cache last sent values to avoid redundant TS renames
let lastClockValue = '';
let lastDateValue = '';
let clockTimer = null;
let dateTimer = null;
// ─── Formatters ───────────────────────────────────────────────────────────────
function formatIranClock(format) {
    return (0, moment_timezone_1.default)().tz('Asia/Tehran').format(format);
}
function formatIranDate(format) {
    // Convert Gregorian tokens to Jalali tokens
    const jalaliFormat = format
        .replace(/YYYY/g, 'jYYYY')
        .replace(/MM/g, 'jMM')
        .replace(/DD/g, 'jDD');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return jalali_moment_1.default().locale('fa').tz('Asia/Tehran').format(jalaliFormat);
}
// ─── Updaters ─────────────────────────────────────────────────────────────────
async function updateClock() {
    const settings = await (0, settings_1.getClockDateSettings)();
    if (!settings.clockEnabled || !settings.clockChannelId)
        return;
    const newValue = formatIranClock(settings.clockFormat);
    if (newValue === lastClockValue)
        return;
    const result = await tsConnection_1.tsManager.run((ts) => ts.channelEdit(settings.clockChannelId, { channelName: newValue }));
    if (result !== null) {
        lastClockValue = newValue;
        void (0, logger_1.dbLog)({ eventType: 'CLOCK_UPDATED', message: `Clock → ${newValue}`, channelId: settings.clockChannelId });
    }
}
async function updateDate() {
    const settings = await (0, settings_1.getClockDateSettings)();
    if (!settings.dateEnabled || !settings.dateChannelId)
        return;
    const newValue = formatIranDate(settings.dateFormat);
    if (newValue === lastDateValue)
        return;
    const result = await tsConnection_1.tsManager.run((ts) => ts.channelEdit(settings.dateChannelId, { channelName: newValue }));
    if (result !== null) {
        lastDateValue = newValue;
        void (0, logger_1.dbLog)({ eventType: 'DATE_UPDATED', message: `Date → ${newValue}`, channelId: settings.dateChannelId });
    }
}
// ─── Scheduler ────────────────────────────────────────────────────────────────
async function startClockDateService() {
    stopClockDateService();
    const settings = await (0, settings_1.getClockDateSettings)();
    if (settings.clockEnabled && settings.clockChannelId) {
        const ms = Math.max(settings.clockUpdateInterval, 10) * 1000;
        await updateClock().catch(() => { });
        clockTimer = setInterval(async () => {
            try {
                await updateClock();
            }
            catch { /* ignore */ }
        }, ms);
        void (0, logger_1.dbLog)({ eventType: 'CLOCK_SERVICE_STARTED', message: `Clock updater started (${settings.clockUpdateInterval}s interval)` });
    }
    if (settings.dateEnabled && settings.dateChannelId) {
        const ms = Math.max(settings.dateUpdateInterval, 10) * 1000;
        await updateDate().catch(() => { });
        dateTimer = setInterval(async () => {
            try {
                await updateDate();
            }
            catch { /* ignore */ }
        }, ms);
        void (0, logger_1.dbLog)({ eventType: 'DATE_SERVICE_STARTED', message: `Date updater started (${settings.dateUpdateInterval}s interval)` });
    }
}
function stopClockDateService() {
    if (clockTimer) {
        clearInterval(clockTimer);
        clockTimer = null;
    }
    if (dateTimer) {
        clearInterval(dateTimer);
        dateTimer = null;
    }
    lastClockValue = '';
    lastDateValue = '';
}
/** Preview helpers for the API */
function previewClock(format) {
    try {
        return formatIranClock(format);
    }
    catch {
        return 'Invalid format';
    }
}
function previewDate(format) {
    try {
        return formatIranDate(format);
    }
    catch {
        return 'Invalid format';
    }
}
//# sourceMappingURL=clockDateService.js.map
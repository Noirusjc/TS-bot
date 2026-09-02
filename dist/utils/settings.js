"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSettings = initSettings;
exports.getSetting = getSetting;
exports.setSetting = setSetting;
exports.setSettings = setSettings;
exports.isSetupComplete = isSetupComplete;
exports.markSetupComplete = markSetupComplete;
exports.getTSConfig = getTSConfig;
exports.saveTSConfig = saveTSConfig;
exports.getClockDateSettings = getClockDateSettings;
exports.getPokeSettings = getPokeSettings;
exports.ensureDefaultSettings = ensureDefaultSettings;
let prismaInstance = null;
function initSettings(prisma) {
    prismaInstance = prisma;
}
// ─── Generic get/set ─────────────────────────────────────────────────────────
async function getSetting(key, fallback = '') {
    if (!prismaInstance)
        return fallback;
    const row = await prismaInstance.setting.findUnique({ where: { key } });
    return row?.value ?? fallback;
}
async function setSetting(key, value) {
    if (!prismaInstance)
        throw new Error('Settings not initialized — DB not connected yet');
    await prismaInstance.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
    });
}
async function setSettings(pairs) {
    for (const [key, value] of Object.entries(pairs)) {
        await setSetting(key, value);
    }
}
// ─── Setup state ─────────────────────────────────────────────────────────────
/**
 * Returns true when the first-time setup wizard has been completed.
 * The flag is stored in the settings table as setup_complete=true.
 */
async function isSetupComplete() {
    const val = await getSetting('setup_complete', 'false');
    return val === 'true';
}
async function markSetupComplete() {
    await setSetting('setup_complete', 'true');
}
// ─── TeamSpeak credentials (stored in DB, not env) ───────────────────────────
/**
 * Load TeamSpeak connection config from the database.
 * Returns null when setup has not been completed yet.
 */
async function getTSConfig() {
    const [host, port, username, password, vsId, nickname] = await Promise.all([
        getSetting('ts_host', ''),
        getSetting('ts_query_port', '10011'),
        getSetting('ts_query_username', ''),
        getSetting('ts_query_password', ''),
        getSetting('ts_virtual_server_id', '1'),
        getSetting('ts_bot_nickname', 'TS3-Bot'),
    ]);
    if (!host || !username || !password)
        return null;
    return {
        host,
        queryPort: parseInt(port, 10) || 10011,
        username,
        password,
        virtualServerId: parseInt(vsId, 10) || 1,
        botNickname: nickname || 'TS3-Bot',
    };
}
async function saveTSConfig(cfg) {
    await setSettings({
        ts_host: cfg.host,
        ts_query_port: String(cfg.queryPort),
        ts_query_username: cfg.username,
        ts_query_password: cfg.password,
        ts_virtual_server_id: String(cfg.virtualServerId),
        ts_bot_nickname: cfg.botNickname,
    });
}
// ─── Clock / Date settings ───────────────────────────────────────────────────
async function getClockDateSettings() {
    const [clockEnabled, clockChannelId, clockFormat, clockUpdateInterval, dateEnabled, dateChannelId, dateFormat, dateUpdateInterval,] = await Promise.all([
        getSetting('clock_enabled', 'false'),
        getSetting('clock_channel_id', ''),
        getSetting('clock_format', '🕒 ساعت ایران: HH:mm'),
        getSetting('clock_update_interval', '60'),
        getSetting('date_enabled', 'false'),
        getSetting('date_channel_id', ''),
        getSetting('date_format', '📅 تاریخ: YYYY/MM/DD'),
        getSetting('date_update_interval', '60'),
    ]);
    return {
        clockEnabled: clockEnabled === 'true',
        clockChannelId,
        clockFormat,
        clockUpdateInterval: parseInt(clockUpdateInterval, 10) || 60,
        dateEnabled: dateEnabled === 'true',
        dateChannelId,
        dateFormat,
        dateUpdateInterval: parseInt(dateUpdateInterval, 10) || 60,
    };
}
// ─── Poke settings ────────────────────────────────────────────────────────────
const DEFAULT_POKE_PASS = `[color=#00FF88][b]╔══════════════════════╗[/b][/color]
[color=#00FF88][b]   ✓ CHANNEL CREATED[/b][/color]
[color=#00FF88][b]╚══════════════════════╝[/b][/color]
[color=#FFFFFF]👤 Owner:[/color] [color=#00BFFF]{USER_NICKNAME}[/color]
[color=#FFFFFF]🔐 Password:[/color] [color=#FFD700][b]{CHANNEL_PASSWORD}[/b][/color]
[color=#AAAAAA]Your temporary channel is ready.[/color]`;
const DEFAULT_POKE_NOPASS = `[color=#00FF88][b]╔══════════════════════╗[/b][/color]
[color=#00FF88][b]   ✓ CHANNEL CREATED[/b][/color]
[color=#00FF88][b]╚══════════════════════╝[/b][/color]
[color=#FFFFFF]👤 Owner:[/color] [color=#00BFFF]{USER_NICKNAME}[/color]
[color=#FFFFFF]📢 Channel:[/color] [color=#FFD700][b]{CHANNEL_NAME}[/b][/color]
[color=#AAAAAA]Your temporary channel is ready.[/color]`;
async function getPokeSettings() {
    const [template, templateNoPassword] = await Promise.all([
        getSetting('poke_template', DEFAULT_POKE_PASS),
        getSetting('poke_template_no_password', DEFAULT_POKE_NOPASS),
    ]);
    return { template, templateNoPassword };
}
// ─── Ensure defaults exist (called on every startup) ─────────────────────────
async function ensureDefaultSettings() {
    if (!prismaInstance)
        throw new Error('Settings not initialized');
    const defaults = {
        temp_channel_enabled: 'true',
        clock_enabled: 'false',
        clock_channel_id: '',
        clock_format: '🕒 ساعت ایران: HH:mm',
        clock_update_interval: '60',
        date_enabled: 'false',
        date_channel_id: '',
        date_format: '📅 تاریخ: YYYY/MM/DD',
        date_update_interval: '60',
        poke_template: DEFAULT_POKE_PASS,
        poke_template_no_password: DEFAULT_POKE_NOPASS,
        setup_complete: 'false',
    };
    for (const [key, value] of Object.entries(defaults)) {
        // Only insert if missing — never overwrite existing values
        const existing = await prismaInstance.setting.findUnique({ where: { key } });
        if (!existing) {
            await prismaInstance.setting.create({ data: { key, value } });
        }
    }
}
//# sourceMappingURL=settings.js.map
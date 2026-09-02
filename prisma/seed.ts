import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEFAULT_POKE_TEMPLATE = `[color=#00FF88][b]╔══════════════════════╗[/b][/color]
[color=#00FF88][b]   ✓ CHANNEL CREATED[/b][/color]
[color=#00FF88][b]╚══════════════════════╝[/b][/color]
[color=#FFFFFF]👤 Owner:[/color] [color=#00BFFF]{USER_NICKNAME}[/color]
[color=#FFFFFF]🔐 Password:[/color] [color=#FFD700][b]{CHANNEL_PASSWORD}[/b][/color]
[color=#AAAAAA]Your temporary channel is ready.[/color]`;

const DEFAULT_POKE_TEMPLATE_NO_PASS = `[color=#00FF88][b]╔══════════════════════╗[/b][/color]
[color=#00FF88][b]   ✓ CHANNEL CREATED[/b][/color]
[color=#00FF88][b]╚══════════════════════╝[/b][/color]
[color=#FFFFFF]👤 Owner:[/color] [color=#00BFFF]{USER_NICKNAME}[/color]
[color=#FFFFFF]📢 Channel:[/color] [color=#FFD700][b]{CHANNEL_NAME}[/b][/color]
[color=#AAAAAA]Your temporary channel is ready.[/color]`;

async function main() {
  console.log('🌱 Seeding database...');

  // Create default admin user from env vars
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.adminUser.upsert({
    where: { username },
    update: { passwordHash },
    create: { username, passwordHash },
  });
  console.log(`✅ Admin user created: ${username}`);

  // Default settings
  const defaultSettings = [
    { key: 'temp_channel_enabled', value: 'true' },
    { key: 'clock_enabled', value: 'false' },
    { key: 'clock_channel_id', value: '' },
    { key: 'clock_format', value: '🕒 ساعت ایران: HH:mm' },
    { key: 'clock_update_interval', value: '60' },
    { key: 'date_enabled', value: 'false' },
    { key: 'date_channel_id', value: '' },
    { key: 'date_format', value: '📅 تاریخ: YYYY/MM/DD' },
    { key: 'date_update_interval', value: '60' },
    { key: 'poke_template', value: DEFAULT_POKE_TEMPLATE },
    { key: 'poke_template_no_password', value: DEFAULT_POKE_TEMPLATE_NO_PASS },
  ];

  for (const setting of defaultSettings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: {},
      create: setting,
    });
  }
  console.log('✅ Default settings created');

  // Default temporary channel rule (placeholder IDs — admin must configure via panel)
  const existingRule = await prisma.temporaryChannelRule.findFirst();
  if (!existingRule) {
    await prisma.temporaryChannelRule.create({
      data: {
        name: 'Default Rule',
        enabled: false, // disabled until admin configures source channel ID
        sourceChannelId: '0',
        parentChannelId: null,
        channelNamePrefix: 'Channel',
        nameSeparator: ' | ',
        passwordEnabled: false,
        passwordLength: 8,
        maxClients: -1,
        channelGroupId: null,
        deletionDelay: 180,
      },
    });
    console.log('✅ Default temporary channel rule created (disabled — configure via panel)');
  }

  console.log('🌱 Seed complete.');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

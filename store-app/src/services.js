// Things that talk to the phone or the outside world:
// daily reminder notification, Telegram alert and backup, backup files.

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { openDatabaseAsync } from 'expo-sqlite';
import {
  DATABASE_NAME,
  exportData,
  importData,
  isShelbyBackup,
  listExpiringBatches,
  listProducts,
  migrateDbIfNeeded,
} from './db';
import { expiryStatus, nowTimestamp, plural, prettyTimestamp, toISODate } from './dates';

// ---------- Settings (saved on this phone) ----------

const SETTING_KEYS = {
  botToken: 'tg_bot_token',
  chatId: 'tg_chat_id',
  reminderOn: 'reminder_on',
  reminderHour: 'reminder_hour',
  lastBackup: 'last_backup',
  autoBackupOn: 'auto_backup_on',
  lastTelegramBackup: 'last_telegram_backup',
  storeCode: 'store_code',
};

export async function loadSettings() {
  const pairs = await AsyncStorage.multiGet(Object.values(SETTING_KEYS));
  const stored = Object.fromEntries(pairs);
  return {
    botToken: stored[SETTING_KEYS.botToken] ?? '',
    chatId: stored[SETTING_KEYS.chatId] ?? '',
    reminderOn: stored[SETTING_KEYS.reminderOn] === 'true',
    reminderHour: parseInt(stored[SETTING_KEYS.reminderHour] ?? '8', 10),
    lastBackup: stored[SETTING_KEYS.lastBackup] ?? '',
    autoBackupOn: stored[SETTING_KEYS.autoBackupOn] === 'true',
    lastTelegramBackup: stored[SETTING_KEYS.lastTelegramBackup] ?? '',
    storeCode: stored[SETTING_KEYS.storeCode] ?? '',
  };
}

export async function saveSettings(changes) {
  const pairs = Object.entries(changes).map(([name, value]) => [SETTING_KEYS[name], String(value)]);
  await AsyncStorage.multiSet(pairs);
}

// ---------- Shared Telegram settings (online) ----------
//
// Phones that enter the same store code share one bot token and chat ID. They
// are kept in Supabase, behind two database functions that need the code; the
// app's public key cannot read the settings table directly.

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I mix-ups
export const MIN_STORE_CODE_LENGTH = 8;

export function cleanStoreCode(code) {
  return code.trim().toUpperCase();
}

// A random code like "SHB-7K2P-9QXM-4D" (about 60 bits), hard to guess.
export function generateStoreCode() {
  const pick = () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
  const group = (n) => Array.from({ length: n }, pick).join('');
  return `SHB-${group(4)}-${group(4)}-${group(2)}`;
}

async function callSharedSettings(fn, body) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Online sharing is not set up in this version of Shelby.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new Error('Could not go online. Check your internet connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(json?.message || 'The online server refused the request.');
  return json;
}

// Saves this phone's Telegram settings online under the store code.
export async function uploadSharedTelegram(storeCode, botToken, chatId) {
  await callSharedSettings('save_telegram_settings', {
    store_code: cleanStoreCode(storeCode),
    bot_token: botToken.trim(),
    chat_id: chatId.trim(),
  });
}

// Returns { botToken, chatId } saved online for the store code, or null.
export async function downloadSharedTelegram(storeCode) {
  const rows = await callSharedSettings('get_telegram_settings', { store_code: cleanStoreCode(storeCode) });
  if (!rows?.length) return null;
  return { botToken: rows[0].bot_token, chatId: rows[0].chat_id };
}

// Picks up changes made on another phone (e.g. a new bot token). Quietly does
// nothing when offline or when this phone has no store code.
export async function refreshSharedTelegram() {
  const { storeCode, botToken, chatId } = await loadSettings();
  if (!storeCode) return false;
  try {
    const shared = await downloadSharedTelegram(storeCode);
    if (!shared || (shared.botToken === botToken && shared.chatId === chatId)) return false;
    await saveSettings({ botToken: shared.botToken, chatId: shared.chatId });
    return true;
  } catch {
    return false;
  }
}

// ---------- What needs attention ----------

export async function getAttentionSummary(db) {
  const batches = await listExpiringBatches(db);
  const products = await listProducts(db);
  const expired = batches.filter((b) => expiryStatus(b.expiry_date).key === 'expired');
  const expiringSoon = batches.filter((b) => ['critical', 'warning'].includes(expiryStatus(b.expiry_date).key));
  const lowStock = products.filter((p) => p.stock <= p.low_stock);
  return { expired, expiringSoon, lowStock };
}

// ---------- Daily reminder ----------

// Expo Go can't load expo-notifications (it crashes on import) or run
// background tasks, so those only work in the installed app (APK).
const isInstalledApp = Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
export const remindersAvailable = isInstalledApp;
const Notifications = isInstalledApp ? require('expo-notifications') : null;

Notifications?.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Android locks a channel's sound once created, so the old silent "daily-check"
// channel can never gain sound. A new id makes Android create a fresh channel.
const REMINDER_CHANNEL = 'daily-check-v2';

export async function askNotificationPermission() {
  if (!Notifications) return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

// Re-schedules the daily reminder with up-to-date numbers. Called on app start
// and after stock changes, so the message reflects the latest data.
export async function refreshDailyReminder(db) {
  if (!Notifications) return;
  const settings = await loadSettings();
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!settings.reminderOn) return;

  const { expired, expiringSoon, lowStock } = await getAttentionSummary(db);
  const parts = [];
  if (expired.length) parts.push(`${expired.length} expired`);
  if (expiringSoon.length) parts.push(`${expiringSoon.length} expiring soon`);
  if (lowStock.length) parts.push(`${lowStock.length} low on stock`);
  const body = parts.length
    ? `${parts.join(', ')}. Open Shelby to check.`
    : 'Time for your daily check of expiry dates and stock.';

  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL, {
    name: 'Daily stock check',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
  });
  await Notifications.scheduleNotificationAsync({
    content: { title: 'Shelby daily check', body, sound: 'default' },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: settings.reminderHour,
      minute: 0,
      channelId: REMINDER_CHANNEL,
    },
  });
}

// ---------- Telegram ----------

// Calls one Telegram Bot API method. `body` is JSON data, or FormData when
// uploading a file. Gives up after `timeoutMs` so a bad connection never hangs.
async function telegramRequest(botToken, method, body, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const isUpload = body instanceof FormData;
  let json;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: isUpload ? undefined : { 'Content-Type': 'application/json' },
      body: isUpload ? body : JSON.stringify(body),
      signal: controller.signal,
    });
    json = await res.json();
  } catch (e) {
    console.warn(`Telegram ${method} failed:`, e?.message ?? e);
    throw new Error('Could not reach Telegram. Check your internet connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  if (!json.ok) throw new Error(explainTelegramError(json));
  return json.result;
}

// Turns Telegram's technical error into something a store owner can act on.
function explainTelegramError({ error_code: code, description = '' }) {
  const text = description.toLowerCase();
  if (code === 401 || code === 404) return 'The bot token is wrong. Copy it again from @BotFather.';
  if (text.includes('chat not found')) return 'The chat ID is wrong, or the bot was not added to the group.';
  if (code === 403) return 'The bot cannot post in that chat. Add the bot to the group first.';
  return description || 'Telegram refused the message.';
}

async function loadTelegramSettings() {
  const { botToken, chatId } = await loadSettings();
  if (!botToken.trim() || !chatId.trim()) {
    throw new Error('Set up Telegram first: add the bot token and chat ID in Telegram settings.');
  }
  return { botToken: botToken.trim(), chatId: chatId.trim() };
}

// Finds the newest chat the bot has seen a message in, preferring groups.
// Used to fill in the chat ID after staff send /start in their group.
export async function findLatestChat(botToken) {
  if (!botToken) throw new Error('Add the bot token first.');
  const updates = await telegramRequest(botToken, 'getUpdates', {});
  const chats = updates
    .map((update) => (update.message ?? update.my_chat_member ?? update.channel_post)?.chat)
    .filter(Boolean)
    .reverse();
  const chat = chats.find((c) => c.type !== 'private') ?? chats[0];
  if (!chat) {
    throw new Error('No message found yet. Send /start in your staff group, wait a few seconds, then try again.');
  }
  return { id: chat.id, title: chat.title ?? chat.first_name ?? 'this chat' };
}

export async function sendTelegramAlert(db) {
  const { botToken, chatId } = await loadTelegramSettings();
  const { expired, expiringSoon, lowStock } = await getAttentionSummary(db);
  if (expired.length + expiringSoon.length + lowStock.length === 0) return false;

  const lines = ['🏪 Shelby stock alert'];
  const batchLine = (b) => `• ${b.name} x${b.quantity} — ${expiryStatus(b.expiry_date).label} (${b.expiry_date})`;
  if (expired.length) lines.push('', `❌ Expired (${expired.length})`, ...expired.map(batchLine));
  if (expiringSoon.length) lines.push('', `⚠️ Expiring soon (${expiringSoon.length})`, ...expiringSoon.map(batchLine));
  if (lowStock.length) {
    lines.push('', `📦 Low stock (${lowStock.length})`, ...lowStock.map((p) => `• ${p.name} — ${p.stock} left`));
  }
  await telegramRequest(botToken, 'sendMessage', { chat_id: chatId, text: lines.join('\n') });
  return true;
}

// ---------- Backup ----------

const BACKUP_FILE_PREFIX = 'shelby-backup-';

// Writes all data to a JSON file in the app's cache and returns it.
async function writeBackupFile(db) {
  const data = await exportData(db);
  const file = new File(Paths.cache, `${BACKUP_FILE_PREFIX}${toISODate(new Date())}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(data));
  return { file, data };
}

// Opens the share menu so the backup can be saved to Google Drive, etc.
export async function shareBackup(db) {
  const { file } = await writeBackupFile(db);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Save Shelby backup' });
  await saveSettings({ lastBackup: toISODate(new Date()) });
}

// Sends the backup file to the Telegram chat and pins it, so another phone can
// restore it with "Restore from Telegram".
export async function sendBackupToTelegram(db) {
  const { botToken, chatId } = await loadTelegramSettings();
  const { file, data } = await writeBackupFile(db);
  const activeProducts = data.products.filter((p) => !p.archived).length;
  const pieces = data.batches.reduce((sum, b) => sum + b.quantity, 0);

  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('disable_notification', 'true');
  form.append(
    'caption',
    `💾 Shelby backup — ${prettyTimestamp(nowTimestamp())}\n` +
      `${plural(activeProducts, 'product')} · ${pieces} pcs in stock\n` +
      'To use it on another phone: Shelby → More → Restore from Telegram.'
  );
  // Expo's fetch uploads expo-file-system File objects directly (not { uri }).
  form.append('document', file);
  const message = await telegramRequest(botToken, 'sendDocument', form, 60000);

  // Pinning lets another phone find the newest backup. It needs the bot to be
  // allowed to pin messages; the backup is still sent if it isn't.
  let pinned = true;
  try {
    await telegramRequest(botToken, 'pinChatMessage', {
      chat_id: chatId,
      message_id: message.message_id,
      disable_notification: true,
    });
  } catch {
    pinned = false;
  }

  const sentAt = nowTimestamp();
  await saveSettings({ lastTelegramBackup: sentAt, lastBackup: sentAt.slice(0, 10) });
  return { pinned };
}

// Sends today's backup to Telegram if automatic backup is on and it hasn't been
// sent yet today. Errors are ignored here; the next try will send it.
let dailyBackupInProgress = null;

export function sendDailyBackupIfDue(db) {
  // App start and "app came back to the screen" can fire together; send once.
  dailyBackupInProgress ??= sendDailyBackup(db).finally(() => {
    dailyBackupInProgress = null;
  });
  return dailyBackupInProgress;
}

async function sendDailyBackup(db) {
  await refreshSharedTelegram();
  const settings = await loadSettings();
  const alreadySentToday = settings.lastTelegramBackup.slice(0, 10) === toISODate(new Date());
  if (!settings.autoBackupOn || alreadySentToday) return;
  if (!settings.botToken.trim() || !settings.chatId.trim()) return;
  try {
    await sendBackupToTelegram(db);
  } catch {
    // No internet or Telegram not reachable — try again later.
  }
}

// Downloads the backup pinned in the Telegram chat. Returns the parsed backup.
export async function downloadBackupFromTelegram() {
  const { botToken, chatId } = await loadTelegramSettings();
  const chat = await telegramRequest(botToken, 'getChat', { chat_id: chatId });
  const document = chat.pinned_message?.document;
  if (!document?.file_name?.startsWith(BACKUP_FILE_PREFIX)) {
    throw new Error(
      'No Shelby backup is pinned in this chat. In Telegram, download the newest backup file, ' +
        'then use "Restore from file".'
    );
  }
  const { file_path: filePath } = await telegramRequest(botToken, 'getFile', { file_id: document.file_id });
  let backup = null;
  try {
    const res = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
    backup = await res.json();
  } catch {
    throw new Error('Could not download the backup. Check your internet connection and try again.');
  }
  if (!isShelbyBackup(backup)) throw new Error('The pinned file is not a Shelby backup.');
  return backup;
}

// Lets the user pick a backup file. Returns the parsed backup, or null if cancelled.
export async function pickBackup() {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (result.canceled) return null;
  const text = await new File(result.assets[0].uri).text();
  let backup = null;
  try {
    backup = JSON.parse(text);
  } catch {
    // Not JSON at all; reported below.
  }
  if (!isShelbyBackup(backup)) throw new Error('This file is not a Shelby backup.');
  return backup;
}

// ---------- Automatic backup while the app is closed ----------

// Android runs this roughly every 12 hours, even when Shelby is closed. The
// exact time is up to Android (it saves battery). Not available in Expo Go.
const BACKUP_TASK = 'shelby-telegram-backup';
const TaskManager = isInstalledApp ? require('expo-task-manager') : null;
const BackgroundTask = isInstalledApp ? require('expo-background-task') : null;

TaskManager?.defineTask(BACKUP_TASK, async () => {
  try {
    const db = await openDatabaseAsync(DATABASE_NAME);
    await migrateDbIfNeeded(db);
    await sendDailyBackupIfDue(db);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export const autoBackupAvailable = isInstalledApp;

// Turns the background backup on or off to match the setting.
export async function syncAutoBackupTask() {
  if (!BackgroundTask) return;
  const { autoBackupOn } = await loadSettings();
  const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKUP_TASK);
  if (autoBackupOn && !isRegistered) {
    await BackgroundTask.registerTaskAsync(BACKUP_TASK, { minimumInterval: 12 * 60 });
  } else if (!autoBackupOn && isRegistered) {
    await BackgroundTask.unregisterTaskAsync(BACKUP_TASK);
  }
}

export { importData };

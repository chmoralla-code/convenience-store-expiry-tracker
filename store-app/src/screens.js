// The four main tabs: Expiry, Stock, History, More.

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  SectionList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CATEGORIES,
  findProductByBarcode,
  getReport,
  listExpiringBatches,
  listMovements,
  listProducts,
  removeBatch,
  WASTE_TYPES,
} from './db';
import { useData } from './data';
import {
  CRITICAL_DAYS,
  expiryStatus,
  plural,
  prettyDate,
  prettyISODate,
  prettyTimestamp,
  WARNING_DAYS,
} from './dates';
import {
  BarcodeScanner,
  Chips,
  FilterTiles,
  PrimaryButton,
  SecondaryButton,
  Sheet,
} from './components';
import { MovementRow, stockLevel, useSheets } from './sheets';
import { UpdateSection } from './UpdateSection';
import {
  askNotificationPermission,
  cleanStoreCode,
  downloadBackupFromTelegram,
  downloadSharedTelegram,
  findLatestChat,
  generateStoreCode,
  importData,
  loadSettings,
  MIN_STORE_CODE_LENGTH,
  pickBackup,
  refreshDailyReminder,
  remindersAvailable,
  saveSettings,
  sendBackupToTelegram,
  sendDailyBackupIfDue,
  sendTelegramAlert,
  shareBackup,
  syncAutoBackupTask,
  uploadSharedTelegram,
} from './services';
import { COLORS, formatMoney, INK, MUTED, TELEGRAM_BLUE, ui } from './theme';

function ScreenHeader({ title, subtitle }) {
  return (
    <View style={ui.header}>
      <View style={styles.brand}>
        <Image
          source={require('../assets/shelby-logo.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="Shelby"
        />
        <View style={{ flexShrink: 1 }}>
          <Text style={ui.screenTitle}>{title}</Text>
          {subtitle ? <Text style={ui.screenSubtitle}>{subtitle}</Text> : null}
        </View>
      </View>
    </View>
  );
}

// Reloads `load()` whenever the data changes; returns [data, refreshing, onRefresh].
function useLoader(load, initial) {
  const { version } = useData();
  const [data, setData] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    load().then(setData);
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  async function onRefresh() {
    setRefreshing(true);
    setData(await load());
    setRefreshing(false);
  }
  return [data, refreshing, onRefresh];
}

// ---------- Expiry ----------

const EXPIRY_TILES = [
  { key: 'expired', label: 'Expired', color: 'expired' },
  { key: 'critical', label: `0–${CRITICAL_DAYS} days`, color: 'critical' },
  { key: 'warning', label: `${CRITICAL_DAYS + 1}–${WARNING_DAYS} days`, color: 'warning' },
  { key: 'all', label: 'All dated', color: 'all' },
];

const EXPIRY_EMPTY = {
  all: 'No stock with expiry dates yet.\nTap "Receive stock" to add a delivery.',
  expired: 'Nothing has expired. 🎉',
  critical: `Nothing expires in the next ${CRITICAL_DAYS} days.`,
  warning: `Nothing expires in ${CRITICAL_DAYS + 1}–${WARNING_DAYS} days.`,
};

export function ExpiryScreen() {
  const { db, bump } = useData();
  const sheets = useSheets();
  const [filter, setFilter] = useState('all');
  const [batches, refreshing, onRefresh] = useLoader(() => listExpiringBatches(db), []);

  const counts = useMemo(() => {
    const result = { expired: 0, critical: 0, warning: 0, all: batches.length };
    for (const batch of batches) {
      const key = expiryStatus(batch.expiry_date).key;
      if (key in result) result[key]++;
    }
    return result;
  }, [batches]);

  const visible = filter === 'all' ? batches : batches.filter((b) => expiryStatus(b.expiry_date).key === filter);

  function throwOut(batch) {
    Alert.alert('Throw out expired stock?', `${batch.quantity} × ${batch.name} will be recorded as expired.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Throw out',
        style: 'destructive',
        onPress: async () => {
          await removeBatch(db, batch.id, 'expired');
          bump();
        },
      },
    ]);
  }

  function renderBatch({ item: batch }) {
    const status = expiryStatus(batch.expiry_date);
    const color = COLORS[status.key];
    return (
      <Pressable
        style={[ui.card, { borderLeftColor: color.main }]}
        onPress={() => sheets.push({ kind: 'product', productId: batch.product_id })}
      >
        <View style={ui.cardInfo}>
          <Text style={ui.cardTitle}>{batch.name}</Text>
          <Text style={[ui.cardStatus, { color: color.main }]}>{status.label}</Text>
          <Text style={ui.cardMeta}>
            {prettyISODate(batch.expiry_date)} · {batch.category}
          </Text>
        </View>
        <View style={styles.cardSide}>
          <Text style={styles.qtyBig}>{batch.quantity}</Text>
          <Text style={styles.qtyUnit}>pcs</Text>
          {status.key === 'expired' ? (
            <Pressable onPress={() => throwOut(batch)} hitSlop={8} style={{ marginTop: 6 }}>
              <Text style={ui.dangerText}>Throw out</Text>
            </Pressable>
          ) : null}
        </View>
      </Pressable>
    );
  }

  return (
    <View style={ui.screen}>
      <ScreenHeader title="Expiry dates" subtitle={`Today is ${prettyDate(new Date())}`} />
      <FilterTiles tiles={EXPIRY_TILES} counts={counts} value={filter} onChange={setFilter} />
      <FlatList
        data={visible}
        keyExtractor={(b) => String(b.id)}
        renderItem={renderBatch}
        contentContainerStyle={ui.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={ui.empty}>{EXPIRY_EMPTY[filter]}</Text>}
      />
      <View style={ui.bottomBar}>
        <PrimaryButton label="＋ Receive stock" onPress={() => sheets.push({ kind: 'receive' })} />
      </View>
    </View>
  );
}

// ---------- Stock ----------

const STOCK_TILES = [
  { key: 'all', label: 'All products', color: 'all' },
  { key: 'low', label: 'Low stock', color: 'critical' },
  { key: 'out', label: 'Out of stock', color: 'expired' },
];

export function StockScreen() {
  const { db } = useData();
  const sheets = useSheets();
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [scanning, setScanning] = useState(false);
  const [products, refreshing, onRefresh] = useLoader(() => listProducts(db), []);

  const counts = useMemo(() => {
    const result = { all: products.length, low: 0, out: 0 };
    for (const product of products) {
      const key = stockLevel(product).key;
      if (key in result) result[key]++;
    }
    return result;
  }, [products]);

  const cleanQuery = query.trim().toLowerCase();
  const visible = products.filter((product) => {
    const matchesFilter = filter === 'all' || stockLevel(product).key === filter;
    const matchesSearch =
      !cleanQuery || product.name.toLowerCase().includes(cleanQuery) || product.barcode === query.trim();
    return matchesFilter && matchesSearch;
  });

  const sections = useMemo(() => {
    const order = new Map(CATEGORIES.map((c, i) => [c, i]));
    const groups = new Map();
    for (const product of visible) {
      const cat = product.category || 'Other';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(product);
    }
    return [...groups.entries()]
      .sort((a, b) => {
        const ai = order.has(a[0]) ? order.get(a[0]) : 999;
        const bi = order.has(b[0]) ? order.get(b[0]) : 999;
        if (ai !== bi) return ai - bi;
        return a[0].localeCompare(b[0]);
      })
      .map(([title, data]) => ({ title, data }));
  }, [visible]);

  async function onScanned(barcode) {
    setScanning(false);
    const product = await findProductByBarcode(db, barcode);
    if (product) {
      sheets.push({ kind: 'product', productId: product.id });
      return;
    }
    Alert.alert('New barcode', 'No product has this barcode yet. Add it as a new product?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Add product', onPress: () => sheets.push({ kind: 'form', barcode }) },
    ]);
  }

  function renderProduct({ item: product }) {
    const level = stockLevel(product);
    return (
      <Pressable
        style={[ui.card, { borderLeftColor: level.key === 'ok' ? '#d0d5dc' : level.color }]}
        onPress={() => sheets.push({ kind: 'product', productId: product.id })}
      >
        <View style={ui.cardInfo}>
          <Text style={ui.cardTitle}>{product.name}</Text>
          <Text style={ui.cardMeta}>
            {product.category} · {formatMoney(product.sell_price)}
          </Text>
          {product.next_expiry ? (
            <Text style={ui.cardMeta}>Next expiry {prettyISODate(product.next_expiry)}</Text>
          ) : null}
        </View>
        <View style={styles.cardSide}>
          <Text style={[styles.qtyBig, { color: level.color }]}>{product.stock}</Text>
          <Text style={[styles.qtyUnit, { color: level.color }]}>{level.label}</Text>
        </View>
      </Pressable>
    );
  }

  let emptyText = 'No products yet.\nTap "New product" to add your first one.';
  if (products.length > 0) emptyText = cleanQuery ? 'No product matches your search.' : 'Nothing here. 👍';

  return (
    <View style={ui.screen}>
      <ScreenHeader title="Stock" subtitle={plural(products.length, 'product')} />
      <FilterTiles tiles={STOCK_TILES} counts={counts} value={filter} onChange={setFilter} />
      <View style={[ui.row, styles.searchRow]}>
        <TextInput
          style={[ui.input, { flex: 1 }]}
          placeholder="🔍 Search products"
          value={query}
          onChangeText={setQuery}
        />
        <Pressable style={styles.scanBtn} onPress={() => setScanning(true)} accessibilityLabel="Scan barcode">
          <Text style={styles.scanBtnText}>Scan</Text>
        </Pressable>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(p) => String(p.id)}
        renderItem={renderProduct}
        renderSectionHeader={({ section }) => (
          <View style={styles.categoryHeader}>
            <Text style={styles.categoryTitle}>{section.title}</Text>
            <Text style={styles.categoryCount}>{section.data.length}</Text>
          </View>
        )}
        contentContainerStyle={ui.listContent}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={ui.empty}>{emptyText}</Text>}
      />
      <View style={ui.bottomBar}>
        <PrimaryButton label="＋ New product" onPress={() => sheets.push({ kind: 'form' })} />
      </View>
      <BarcodeScanner visible={scanning} onClose={() => setScanning(false)} onScanned={onScanned} />
    </View>
  );
}

// ---------- History ----------

const HISTORY_FILTERS = [
  ['all', 'All', null],
  ['received', 'Received', ['received']],
  ['sold', 'Sold', ['sold']],
  ['waste', 'Waste', WASTE_TYPES],
  ['other', 'Other', ['own_use', 'returned', 'count']],
];
const PAGE_SIZE = 100;

export function HistoryScreen() {
  const { db, version } = useData();
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [movements, setMovements] = useState([]);

  const types = HISTORY_FILTERS.find(([key]) => key === filter)[2];
  useEffect(() => {
    listMovements(db, { types, limit }).then(setMovements);
  }, [db, version, filter, limit]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={ui.screen}>
      <ScreenHeader title="History" subtitle="Every stock change, newest first" />
      <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
        <Chips
          options={HISTORY_FILTERS.map(([key, label]) => [key, label])}
          value={filter}
          onChange={(key) => {
            setFilter(key);
            setLimit(PAGE_SIZE);
          }}
        />
      </View>
      <FlatList
        data={movements}
        keyExtractor={(m) => String(m.id)}
        renderItem={({ item }) => <MovementRow movement={item} />}
        contentContainerStyle={[ui.listContent, styles.historyList]}
        ListEmptyComponent={<Text style={ui.empty}>Nothing recorded yet.</Text>}
        ListFooterComponent={
          movements.length >= limit ? (
            <View style={{ flexDirection: 'row', marginTop: 12 }}>
              <SecondaryButton label="Show more" onPress={() => setLimit(limit + PAGE_SIZE)} />
            </View>
          ) : null
        }
      />
    </View>
  );
}

// ---------- More: reports, reorder list, reminder, Telegram, backup ----------

function StatRow({ label, value, color }) {
  return (
    <View style={ui.statRow}>
      <Text style={ui.statLabel}>{label}</Text>
      <Text style={[ui.statValue, color && { color }]}>{value}</Text>
    </View>
  );
}

const REMINDER_HOURS = [
  [7, '7 AM'],
  [8, '8 AM'],
  [9, '9 AM'],
  [12, '12 PM'],
  [18, '6 PM'],
];

export function MoreScreen() {
  const { db, version, bump } = useData();
  const [report, setReport] = useState(null);
  const [reorder, setReorder] = useState([]);
  const [settings, setSettings] = useState(null);
  const [telegramOpen, setTelegramOpen] = useState(false);
  const [busy, setBusy] = useState(null); // which backup button is working, or null

  useEffect(() => {
    getReport(db).then(setReport);
    listProducts(db).then((products) => setReorder(products.filter((p) => p.stock <= p.low_stock)));
    loadSettings().then(setSettings);
  }, [db, version]);

  async function updateReminder(changes) {
    if (changes.reminderOn && !remindersAvailable) {
      Alert.alert('Not available here', 'The daily reminder works in the installed Shelby app, not in Expo Go.');
      return;
    }
    if (changes.reminderOn) {
      const allowed = await askNotificationPermission();
      if (!allowed) {
        Alert.alert('Notifications are off', 'Allow notifications for Shelby in your phone settings first.');
        return;
      }
    }
    await saveSettings(changes);
    setSettings({ ...settings, ...changes });
    await refreshDailyReminder(db);
  }

  function shareReorderList() {
    const lines = reorder.map((p) => `• ${p.name} — ${p.stock} left`);
    Share.share({ message: `🛒 Shelby reorder list\n${lines.join('\n')}` });
  }

  // Runs a backup action, showing `busyLabel` on its button meanwhile.
  async function runBackupAction(busyLabel, action, errorTitle) {
    setBusy(busyLabel);
    try {
      await action();
    } catch (e) {
      Alert.alert(errorTitle, e.message);
    } finally {
      setBusy(null);
      setSettings(await loadSettings());
    }
  }

  function saveToFile() {
    runBackupAction('file', () => shareBackup(db), 'Backup failed');
  }

  function sendToTelegramNow() {
    runBackupAction(
      'telegram',
      async () => {
        const { pinned } = await sendBackupToTelegram(db);
        Alert.alert(
          'Backup sent ✅',
          pinned
            ? 'Saved in your Telegram chat.'
            : 'Sent, but not pinned. Make the bot a group admin.'
        );
      },
      'Could not send backup'
    );
  }

  async function setAutoBackup(on) {
    if (on && (!settings.botToken.trim() || !settings.chatId.trim())) {
      Alert.alert('Set up Telegram first');
      setTelegramOpen(true);
      return;
    }
    await saveSettings({ autoBackupOn: on });
    setSettings({ ...settings, autoBackupOn: on });
    await syncAutoBackupTask();
    if (on) runBackupAction('telegram', () => sendDailyBackupIfDue(db), 'Could not send backup');
  }

  // Asks before replacing this phone's data with `backup`.
  function confirmRestore(backup) {
    const productCount = backup.products.filter((p) => !p.archived).length;
    const backupDate = backup.exported_at ? prettyDate(new Date(backup.exported_at)) : 'an unknown date';
    Alert.alert(
      'Replace all data?',
      `Backup from ${backupDate} (${plural(productCount, 'product')}). This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace',
          style: 'destructive',
          onPress: async () => {
            try {
              await importData(db, backup);
              bump();
              Alert.alert('Restored ✅', 'Your backup has been loaded.');
            } catch (e) {
              Alert.alert('Restore failed', e.message);
            }
          },
        },
      ]
    );
  }

  function restoreFromFile() {
    runBackupAction(
      'restore-file',
      async () => {
        const backup = await pickBackup();
        if (backup) confirmRestore(backup);
      },
      'Restore failed'
    );
  }

  function restoreFromTelegram() {
    runBackupAction(
      'restore-telegram',
      async () => confirmRestore(await downloadBackupFromTelegram()),
      'Restore failed'
    );
  }

  const telegramReady = !!(settings?.botToken.trim() && settings?.chatId.trim());

  function sendAlert() {
    runBackupAction(
      'alert',
      async () => {
        const sent = await sendTelegramAlert(db);
        if (sent) Alert.alert('Sent ✅', 'Check your Telegram.');
        else Alert.alert('All good 🎉', 'Nothing is expiring or low on stock.');
      },
      'Could not send'
    );
  }

  function chooseBackup() {
    Alert.alert('Back up', 'Where do you want to save it?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'File', onPress: saveToFile },
      ...(telegramReady ? [{ text: 'Telegram', onPress: sendToTelegramNow }] : []),
    ]);
  }

  function chooseRestore() {
    Alert.alert('Restore', 'This replaces all data on this phone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'From file', onPress: restoreFromFile },
      ...(telegramReady ? [{ text: 'From Telegram', onPress: restoreFromTelegram }] : []),
    ]);
  }

  if (!report || !settings) return <View style={ui.screen} />;
  const { stock, month, expiringValue } = report;
  const wasteUnits = WASTE_TYPES.reduce((sum, t) => sum + (month[t]?.units ?? 0), 0);
  const wasteValue = WASTE_TYPES.reduce((sum, t) => sum + (month[t]?.sales ?? 0), 0);

  return (
    <View style={ui.screen}>
      <ScreenHeader title="More" subtitle="Reports and settings" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4 }}>
        <View style={ui.section}>
          <Text style={ui.sectionTitle}>This month</Text>
          <StatRow
            label="Sold"
            value={`${month.sold?.units ?? 0} pcs · ${formatMoney(month.sold?.sales)}`}
          />
          <StatRow label="Received" value={`${month.received?.units ?? 0} pcs`} />
          <StatRow
            label="Wasted (damaged + expired)"
            value={`${wasteUnits} pcs · ${formatMoney(wasteValue)}`}
            color={wasteUnits > 0 ? COLORS.expired.main : null}
          />
        </View>

        <View style={ui.section}>
          <Text style={ui.sectionTitle}>Stock right now</Text>
          <StatRow label="Products" value={stock.product_count} />
          <StatRow label="Pieces in stock" value={stock.units} />
          <StatRow label="Value of stock" value={formatMoney(stock.sell_value)} />
          <StatRow
            label={`Expired or expiring in ${WARNING_DAYS} days`}
            value={formatMoney(expiringValue)}
            color={expiringValue > 0 ? COLORS.critical.main : null}
          />
        </View>

        <View style={ui.section}>
          <Text style={ui.sectionTitle}>🛒 Reorder list ({reorder.length})</Text>
          {reorder.length === 0 ? <Text style={ui.hint}>Nothing is low on stock. 👍</Text> : null}
          {reorder.map((p) => (
            <View key={p.id} style={ui.statRow}>
              <Text style={ui.statLabel}>{p.name}</Text>
              <Text style={[ui.statValue, { color: stockLevel(p).color }]}>{p.stock} left</Text>
            </View>
          ))}
          {reorder.length > 0 ? (
            <View style={{ flexDirection: 'row', marginTop: 10 }}>
              <SecondaryButton label="Share list" onPress={shareReorderList} />
            </View>
          ) : null}
        </View>

        <View style={ui.section}>
          <View style={[ui.row, { justifyContent: 'space-between' }]}>
            <Text style={[ui.sectionTitle, { marginBottom: 0 }]}>⏰ Daily reminder</Text>
            <Switch value={settings.reminderOn} onValueChange={(on) => updateReminder({ reminderOn: on })} />
          </View>
          <Text style={ui.hint}>A notification on this phone every day.</Text>
          {settings.reminderOn ? (
            <View style={{ marginTop: 10 }}>
              <Chips
                options={REMINDER_HOURS}
                value={settings.reminderHour}
                onChange={(hour) => updateReminder({ reminderHour: hour })}
              />
            </View>
          ) : null}
        </View>

        <View style={ui.section}>
          <Text style={ui.sectionTitle}>✈️ Telegram</Text>
          <Text style={[ui.hint, telegramReady && ui.hintGood]}>
            {telegramReady ? 'Connected ✅' : 'Not set up yet.'}
          </Text>
          <View style={[ui.row, { marginTop: 10 }]}>
            {telegramReady ? (
              <>
                <PrimaryButton
                  label={busy === 'alert' ? 'Sending…' : 'Send alert'}
                  color={TELEGRAM_BLUE}
                  onPress={sendAlert}
                  disabled={busy !== null}
                />
                <SecondaryButton label="Settings" onPress={() => setTelegramOpen(true)} />
              </>
            ) : (
              <PrimaryButton label="Set up Telegram" color={TELEGRAM_BLUE} onPress={() => setTelegramOpen(true)} />
            )}
          </View>
        </View>

        <View style={ui.section}>
          <Text style={ui.sectionTitle}>💾 Backup</Text>
          <Text style={[ui.hint, !settings.lastBackup && ui.hintBad]}>
            {settings.lastTelegramBackup
              ? `Last backup: ${prettyTimestamp(settings.lastTelegramBackup)}`
              : settings.lastBackup
                ? `Last backup: ${prettyISODate(settings.lastBackup)}`
                : 'No backup yet.'}
          </Text>
          <View style={[ui.row, styles.switchRow]}>
            <Text style={styles.switchLabel}>Auto backup to Telegram</Text>
            <Switch value={settings.autoBackupOn} onValueChange={setAutoBackup} />
          </View>
          <View style={[ui.row, { marginTop: 12 }]}>
            <PrimaryButton
              label={busy === 'telegram' || busy === 'file' ? 'Saving…' : 'Back up'}
              onPress={chooseBackup}
              disabled={busy !== null}
            />
            <SecondaryButton
              label={busy?.startsWith('restore') ? 'Loading…' : 'Restore'}
              onPress={chooseRestore}
              disabled={busy !== null}
            />
          </View>
        </View>
        <UpdateSection />
      </ScrollView>

      <TelegramSheet
        visible={telegramOpen}
        onClose={() => {
          setTelegramOpen(false);
          loadSettings().then(setSettings);
        }}
      />
    </View>
  );
}

function TelegramSheet({ visible, onClose }) {
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [storeCode, setStoreCode] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(null); // which button is working, or null

  useEffect(() => {
    if (!visible) return;
    setShowToken(false);
    loadSettings().then((s) => {
      setBotToken(s.botToken);
      setChatId(s.chatId);
      setStoreCode(s.storeCode);
    });
  }, [visible]);

  const code = cleanStoreCode(storeCode);
  const codeIsValid = code.length >= MIN_STORE_CODE_LENGTH;

  async function run(label, action, errorTitle) {
    setBusy(label);
    try {
      await action();
    } catch (e) {
      Alert.alert(errorTitle, e.message);
    } finally {
      setBusy(null);
    }
  }

  function save() {
    run('save', async () => {
      if (code && !codeIsValid) {
        throw new Error('Store code is too short. Tap "New" to make one.');
      }
      await saveSettings({ botToken: botToken.trim(), chatId: chatId.trim(), storeCode: code });
      if (code && botToken.trim() && chatId.trim()) {
        await uploadSharedTelegram(code, botToken, chatId);
        Alert.alert('Saved ✅', 'Other phones can use the store code.');
      } else {
        Alert.alert('Saved ✅');
      }
      onClose();
    }, 'Could not save');
  }

  function loadFromCode() {
    run('load', async () => {
      if (!codeIsValid) throw new Error('Type the store code first.');
      const shared = await downloadSharedTelegram(code);
      if (!shared) throw new Error('Store code not found. Check it and try again.');
      setBotToken(shared.botToken);
      setChatId(shared.chatId);
      await saveSettings({ ...shared, storeCode: code });
      Alert.alert('Loaded ✅');
    }, 'Could not load');
  }

  function findChat() {
    run('find', async () => {
      const chat = await findLatestChat(botToken.trim());
      setChatId(String(chat.id));
      await saveSettings({ botToken: botToken.trim(), chatId: String(chat.id) });
      Alert.alert('Found ✅', chat.title);
    }, 'Chat not found');
  }

  return (
    <Sheet
      visible={visible}
      title="Telegram settings"
      onClose={onClose}
      footer={<PrimaryButton label={busy === 'save' ? 'Saving…' : 'Save'} onPress={save} disabled={!!busy} />}
    >
      <View style={styles.helpBox}>
        <Text style={styles.helpStep}>1. Make a bot with @BotFather</Text>
        <Text style={styles.helpStep}>2. Add the bot to your group as admin</Text>
        <Text style={styles.helpStep}>3. Send /start in the group</Text>
      </View>

      <Text style={ui.label}>Bot token</Text>
      <View style={ui.row}>
        <TextInput
          style={[ui.input, { flex: 1 }]}
          placeholder="Paste token"
          value={botToken}
          onChangeText={setBotToken}
          secureTextEntry={!showToken}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable style={styles.eyeBtn} onPress={() => setShowToken(!showToken)} hitSlop={6}>
          <Text style={styles.eyeText}>{showToken ? 'Hide' : 'Show'}</Text>
        </Pressable>
      </View>

      <Text style={ui.label}>Chat ID</Text>
      <View style={ui.row}>
        <TextInput
          style={[ui.input, { flex: 1 }]}
          placeholder="Tap Find"
          value={chatId}
          onChangeText={setChatId}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable
          style={[styles.scanBtn, (busy || !botToken.trim()) && ui.btnDisabled]}
          onPress={findChat}
          disabled={!!busy || !botToken.trim()}
        >
          <Text style={styles.scanBtnText}>{busy === 'find' ? '…' : 'Find'}</Text>
        </Pressable>
      </View>

      <Text style={ui.label}>Store code</Text>
      <View style={ui.row}>
        <TextInput
          style={[ui.input, { flex: 1 }]}
          placeholder="SHB-XXXX-XXXX-XX"
          value={storeCode}
          onChangeText={setStoreCode}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <Pressable style={styles.eyeBtn} onPress={() => setStoreCode(generateStoreCode())} hitSlop={6}>
          <Text style={styles.eyeText}>New</Text>
        </Pressable>
      </View>
      <Text style={ui.hint}>Same code = same settings on every phone.</Text>
      <View style={[ui.row, { marginTop: 10 }]}>
        <SecondaryButton
          label={busy === 'load' ? 'Loading…' : 'Load from code'}
          onPress={loadFromCode}
          disabled={!!busy}
        />
      </View>
    </Sheet>
  );
}

// ---------- Tab bar ----------

export const TABS = [
  { key: 'expiry', label: 'Expiry', icon: '⏰', Screen: ExpiryScreen },
  { key: 'stock', label: 'Stock', icon: '📦', Screen: StockScreen },
  { key: 'history', label: 'History', icon: '🕘', Screen: HistoryScreen },
  { key: 'more', label: 'More', icon: '📊', Screen: MoreScreen },
];

export function TabBar({ value, onChange }) {
  return (
    <SafeAreaView edges={['bottom']} style={styles.tabBar}>
      {TABS.map((tab) => {
        const isActive = tab.key === value;
        return (
          <Pressable
            key={tab.key}
            style={styles.tab}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
          >
            <Text style={[styles.tabIcon, !isActive && styles.tabIconInactive]}>{tab.icon}</Text>
            <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  logo: { width: 76, height: 44 },
  cardSide: { alignItems: 'center', minWidth: 64 },
  qtyBig: { fontSize: 24, fontWeight: 'bold', color: INK },
  qtyUnit: { fontSize: 12, color: MUTED, textAlign: 'center' },
  searchRow: { paddingHorizontal: 16, marginBottom: 10 },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#eef2f7',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginTop: 6,
    marginBottom: 6,
  },
  categoryTitle: { fontSize: 14, fontWeight: 'bold', color: INK, textTransform: 'uppercase', letterSpacing: 0.5 },
  categoryCount: { fontSize: 13, fontWeight: '600', color: MUTED },
  scanBtn: {
    backgroundColor: COLORS.all.main,
    borderRadius: 10,
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  scanBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  historyList: { backgroundColor: '#fff', marginHorizontal: 16, paddingHorizontal: 12, borderRadius: 12 },
  helpBox: { backgroundColor: '#f4f6f8', borderRadius: 10, padding: 12, gap: 6 },
  helpStep: { fontSize: 14, color: '#444' },
  eyeBtn: {
    borderWidth: 1,
    borderColor: '#bbb',
    borderRadius: 10,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  eyeText: { fontSize: 15, fontWeight: '600', color: COLORS.all.main },
  switchRow: { justifyContent: 'space-between', marginTop: 12 },
  switchLabel: { fontSize: 16, fontWeight: '600', color: INK, flexShrink: 1 },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e2e6ea',
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  tabIcon: { fontSize: 22 },
  tabIconInactive: { opacity: 0.45 },
  tabLabel: { fontSize: 12, color: MUTED, marginTop: 2 },
  tabLabelActive: { color: COLORS.all.main, fontWeight: 'bold' },
});

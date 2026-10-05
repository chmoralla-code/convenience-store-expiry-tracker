import { useEffect, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './lib/supabase';

// How many days ahead count as "warning" / "critical".
const WARNING_DAYS = 7;
const CRITICAL_DAYS = 3;

const CATEGORIES = ['Dairy', 'Snacks', 'Drinks', 'Frozen', 'Canned', 'Other'];

// Whole days from today until a YYYY-MM-DD date (negative = already expired).
function daysLeft(expiryDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = expiryDate.split('-').map(Number);
  const expiry = new Date(y, m - 1, d);
  return Math.round((expiry - today) / 86400000);
}

function toISODate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

function statusOf(item) {
  const left = daysLeft(item.expiry_date);
  if (left < 0) return { key: 'expired', label: `Expired ${Math.abs(left)}d ago`, style: styles.badgeExpired };
  if (left === 0) return { key: 'critical', label: 'Expires today', style: styles.badgeCritical };
  if (left <= CRITICAL_DAYS)
    return { key: 'critical', label: `${left}d left`, style: styles.badgeCritical };
  if (left <= WARNING_DAYS) return { key: 'warning', label: `${left}d left`, style: styles.badgeWarning };
  return { key: 'fresh', label: `${left}d left`, style: styles.badgeFresh };
}

export default function App() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all'); // all | attention | expired

  // Add-item form
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [expiry, setExpiry] = useState('');
  const [category, setCategory] = useState('Snacks');
  const [saving, setSaving] = useState(false);

  // Telegram settings (saved on this phone only)
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [sending, setSending] = useState(false);

  async function loadItems() {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('expiry_date', { ascending: true });
    if (!error) setItems(data ?? []);
  }

  useEffect(() => {
    (async () => {
      try {
        await loadItems();
        const saved = await AsyncStorage.multiGet(['tg_bot_token', 'tg_chat_id']);
        if (saved[0][1]) setBotToken(saved[0][1]);
        if (saved[1][1]) setChatId(saved[1][1]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    await loadItems();
    setRefreshing(false);
  }

  function quickDate(daysAhead) {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    setExpiry(toISODate(d));
  }

  async function addItem() {
    const cleanName = name.trim();
    if (!cleanName) {
      alert('Type the item name first.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry.trim())) {
      alert('Expiry date must look like 2026-10-20.');
      return;
    }
    const qty = Math.max(1, parseInt(quantity, 10) || 1);
    setSaving(true);
    const { error } = await supabase.from('products').insert({
      name: cleanName,
      quantity: qty,
      expiry_date: expiry.trim(),
      category,
    });
    setSaving(false);
    if (error) {
      alert('Could not save: ' + error.message);
      return;
    }
    setName('');
    setQuantity('1');
    setExpiry('');
    await loadItems();
  }

  async function changeQty(item, delta) {
    if (item.quantity + delta <= 0) return removeItem(item);
    const { error } = await supabase
      .from('products')
      .update({ quantity: item.quantity + delta })
      .eq('id', item.id);
    if (!error) await loadItems();
  }

  async function removeItem(item) {
    const { error } = await supabase.from('products').delete().eq('id', item.id);
    if (!error) await loadItems();
  }

  const counts = useMemo(() => {
    let expired = 0;
    let critical = 0;
    let warning = 0;
    for (const item of items) {
      const s = statusOf(item).key;
      if (s === 'expired') expired++;
      else if (s === 'critical') critical++;
      else if (s === 'warning') warning++;
    }
    return { expired, critical, warning, total: items.length };
  }, [items]);

  const visible = useMemo(() => {
    if (filter === 'expired') return items.filter((i) => statusOf(i).key === 'expired');
    if (filter === 'attention')
      return items.filter((i) => ['expired', 'critical', 'warning'].includes(statusOf(i).key));
    return items;
  }, [items, filter]);

  async function saveTelegramSettings() {
    await AsyncStorage.multiSet([
      ['tg_bot_token', botToken.trim()],
      ['tg_chat_id', chatId.trim()],
    ]);
    alert('Telegram settings saved on this phone.');
  }

  async function sendTelegramAlert() {
    if (!botToken.trim() || !chatId.trim()) {
      alert('Add your bot token and chat ID below first.');
      return;
    }
    const flagged = items.filter((i) =>
      ['expired', 'critical', 'warning'].includes(statusOf(i).key)
    );
    if (flagged.length === 0) {
      alert('Nothing near expiry — no alert to send. 🎉');
      return;
    }
    const lines = flagged.map((i) => {
      const s = statusOf(i);
      return `• ${i.name} x${i.quantity} — ${s.label} (${i.expiry_date})`;
    });
    const text =
      `⚠️ Expiry alert (${flagged.length} item${flagged.length > 1 ? 's' : ''})\n` +
      lines.join('\n');
    setSending(true);
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken.trim()}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId.trim(), text }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.description || 'Telegram refused the message');
      alert('Alert sent to Telegram. ✅');
    } catch (e) {
      alert('Could not send: ' + e.message);
    } finally {
      setSending(false);
    }
  }

  function renderItem({ item }) {
    const s = statusOf(item);
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.itemName}>{item.name}</Text>
            <Text style={styles.itemMeta}>
              x{item.quantity} · {item.category} · exp {item.expiry_date}
            </Text>
          </View>
          <View style={[styles.badge, s.style]}>
            <Text style={styles.badgeText}>{s.label}</Text>
          </View>
        </View>
        <View style={styles.cardActions}>
          <Pressable style={styles.qtyBtn} onPress={() => changeQty(item, -1)}>
            <Text style={styles.qtyText}>−</Text>
          </Pressable>
          <Pressable style={styles.qtyBtn} onPress={() => changeQty(item, 1)}>
            <Text style={styles.qtyText}>+</Text>
          </Pressable>
          <Pressable style={styles.deleteBtn} onPress={() => removeItem(item)}>
            <Text style={styles.deleteText}>Remove</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" />
        <Text>Loading stock…</Text>
        <StatusBar style="auto" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>🏪 Store Expiry Tracker</Text>

      <View style={styles.summary}>
        <View style={styles.summaryBox}>
          <Text style={styles.summaryNum}>{counts.total}</Text>
          <Text>Items</Text>
        </View>
        <View style={[styles.summaryBox, counts.expired > 0 && styles.summaryBad]}>
          <Text style={styles.summaryNum}>{counts.expired}</Text>
          <Text>Expired</Text>
        </View>
        <View style={[styles.summaryBox, counts.critical > 0 && styles.summaryBad]}>
          <Text style={styles.summaryNum}>{counts.critical}</Text>
          <Text>Critical</Text>
        </View>
        <View style={styles.summaryBox}>
          <Text style={styles.summaryNum}>{counts.warning}</Text>
          <Text>Warning</Text>
        </View>
      </View>

      <View style={styles.form}>
        <Text style={styles.sectionTitle}>Add item</Text>
        <TextInput
          style={styles.input}
          placeholder="Item name (e.g. Fresh milk 1L)"
          value={name}
          onChangeText={setName}
        />
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.qtyInput]}
            placeholder="Qty"
            keyboardType="number-pad"
            value={quantity}
            onChangeText={setQuantity}
          />
          <TextInput
            style={[styles.input, styles.dateInput]}
            placeholder="Expiry YYYY-MM-DD"
            value={expiry}
            onChangeText={setExpiry}
          />
        </View>
        <View style={styles.row}>
          {[3, 7, 14, 30].map((d) => (
            <Pressable key={d} style={styles.quickBtn} onPress={() => quickDate(d)}>
              <Text style={styles.quickText}>+{d}d</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.chips}>
          {CATEGORIES.map((c) => (
            <Pressable
              key={c}
              style={[styles.chip, category === c && styles.chipActive]}
              onPress={() => setCategory(c)}
            >
              <Text style={category === c ? styles.chipTextActive : styles.chipText}>{c}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={styles.addBtn} onPress={addItem} disabled={saving}>
          <Text style={styles.addText}>{saving ? 'Saving…' : 'Add to inventory'}</Text>
        </Pressable>
      </View>

      <View style={styles.filters}>
        {[
          ['all', 'All'],
          ['attention', 'Needs attention'],
          ['expired', 'Expired'],
        ].map(([key, label]) => (
          <Pressable
            key={key}
            style={[styles.filterBtn, filter === key && styles.filterActive]}
            onPress={() => setFilter(key)}
          >
            <Text style={filter === key ? styles.filterTextActive : styles.filterText}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={visible}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>No items here. Add one above. 👆</Text>}
      />

      <View style={styles.telegram}>
        <Text style={styles.sectionTitle}>Telegram alerts</Text>
        <TextInput
          style={styles.input}
          placeholder="Bot token (from BotFather)"
          value={botToken}
          onChangeText={setBotToken}
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          placeholder="Chat ID (group or channel)"
          value={chatId}
          onChangeText={setChatId}
          autoCapitalize="none"
        />
        <View style={styles.row}>
          <Pressable style={styles.tgBtn} onPress={saveTelegramSettings}>
            <Text style={styles.tgText}>Save</Text>
          </Pressable>
          <Pressable style={styles.sendBtn} onPress={sendTelegramAlert} disabled={sending}>
            <Text style={styles.tgText}>{sending ? 'Sending…' : 'Send alert now'}</Text>
          </Pressable>
        </View>
      </View>

      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f8', padding: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 8 },
  summary: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  summaryBox: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 8,
    alignItems: 'center',
  },
  summaryBad: { borderWidth: 2, borderColor: '#e74c3c' },
  summaryNum: { fontSize: 20, fontWeight: 'bold' },
  form: { backgroundColor: '#fff', borderRadius: 12, padding: 10, marginBottom: 10 },
  sectionTitle: { fontWeight: 'bold', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  row: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  qtyInput: { flex: 1 },
  dateInput: { flex: 3 },
  quickBtn: {
    flex: 1,
    backgroundColor: '#eaf0ff',
    borderRadius: 8,
    padding: 8,
    alignItems: 'center',
  },
  quickText: { color: '#2f62c4', fontWeight: 'bold' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { borderWidth: 1, borderColor: '#bbb', borderRadius: 16, paddingVertical: 5, paddingHorizontal: 10 },
  chipActive: { backgroundColor: '#2f62c4', borderColor: '#2f62c4' },
  chipText: { color: '#333' },
  chipTextActive: { color: '#fff', fontWeight: 'bold' },
  addBtn: { backgroundColor: '#27ae60', borderRadius: 10, padding: 12, alignItems: 'center' },
  addText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  filters: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  filterBtn: { flex: 1, borderRadius: 8, padding: 8, alignItems: 'center', backgroundColor: '#e2e6ea' },
  filterActive: { backgroundColor: '#2f62c4' },
  filterText: { color: '#333' },
  filterTextActive: { color: '#fff', fontWeight: 'bold' },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 10, marginBottom: 8 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemName: { fontSize: 16, fontWeight: 'bold' },
  itemMeta: { color: '#666', marginTop: 2 },
  badge: { borderRadius: 8, paddingVertical: 5, paddingHorizontal: 8 },
  badgeText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  badgeExpired: { backgroundColor: '#c0392b' },
  badgeCritical: { backgroundColor: '#e67e22' },
  badgeWarning: { backgroundColor: '#d4a017' },
  badgeFresh: { backgroundColor: '#27ae60' },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  qtyBtn: { backgroundColor: '#eaf0ff', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 16 },
  qtyText: { fontSize: 18, fontWeight: 'bold', color: '#2f62c4' },
  deleteBtn: { marginLeft: 'auto', justifyContent: 'center', paddingHorizontal: 8 },
  deleteText: { color: '#c0392b', fontWeight: 'bold' },
  empty: { textAlign: 'center', color: '#777', marginTop: 20 },
  telegram: { backgroundColor: '#fff', borderRadius: 12, padding: 10, marginTop: 8 },
  tgBtn: { flex: 1, backgroundColor: '#7f8c8d', borderRadius: 10, padding: 10, alignItems: 'center' },
  sendBtn: { flex: 2, backgroundColor: '#229ED9', borderRadius: 10, padding: 10, alignItems: 'center' },
  tgText: { color: '#fff', fontWeight: 'bold' },
});

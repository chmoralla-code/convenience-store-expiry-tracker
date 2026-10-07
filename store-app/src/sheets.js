// Full-screen sheets for working with one product. They are shown one at a
// time from a stack (see SheetsContext in App.js), so "Receive" opened from a
// product's page returns to that page when done.

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  archiveProduct,
  CATEGORIES,
  findProductByBarcode,
  getProduct,
  listBatches,
  listMovements,
  listProducts,
  MOVEMENT_TYPES,
  NOT_EXPIRED_ONLY,
  receiveStock,
  removeBatch,
  removeStock,
  REMOVE_REASONS,
  saveProduct,
  setCountedStock,
} from './db';
import { useData } from './data';
import { expiryStatus, prettyISODate, prettyTimestamp } from './dates';
import {
  BarcodeScanner,
  Chips,
  ExpiryField,
  isExpiryFieldValid,
  parseWholeNumber,
  PrimaryButton,
  QuantityInput,
  SecondaryButton,
  Sheet,
} from './components';
import { COLORS, formatMoney, INK, MUTED, ui } from './theme';

export const SheetsContext = createContext(null);

export function useSheets() {
  return useContext(SheetsContext);
}

// Stock level of a product: out | low | ok.
export function stockLevel(product) {
  if (product.stock <= 0) return { key: 'out', label: 'Out of stock', color: COLORS.expired.main };
  if (product.stock <= product.low_stock) return { key: 'low', label: 'Low stock', color: COLORS.critical.main };
  return { key: 'ok', label: 'In stock', color: COLORS.fresh.main };
}

export function SheetRouter({ sheet }) {
  if (!sheet) return null;
  // Each opened sheet has a unique id, so reopening the same kind starts fresh.
  switch (sheet.kind) {
    case 'product':
      return <ProductSheet key={sheet.id} productId={sheet.productId} />;
    case 'form':
      return <ProductFormSheet key={sheet.id} {...sheet} />;
    case 'receive':
      return <ReceiveSheet key={sheet.id} productId={sheet.productId} />;
    case 'remove':
      return <RemoveSheet key={sheet.id} productId={sheet.productId} />;
    case 'count':
      return <CountSheet key={sheet.id} productId={sheet.productId} />;
    default:
      return null;
  }
}

// ---------- Shared pieces ----------

function useProduct(productId) {
  const { db, version } = useData();
  const [product, setProduct] = useState(null);
  useEffect(() => {
    if (productId) getProduct(db, productId).then(setProduct);
  }, [db, productId, version]);
  return product;
}

export function MovementRow({ movement, showName = true }) {
  const type = MOVEMENT_TYPES[movement.type] ?? { label: movement.type };
  const isIn = movement.quantity > 0;
  return (
    <View style={styles.movement}>
      <Text style={[styles.movementQty, { color: isIn ? COLORS.fresh.main : COLORS.expired.main }]}>
        {isIn ? '+' : '−'}
        {Math.abs(movement.quantity)}
      </Text>
      <View style={{ flex: 1 }}>
        {showName ? <Text style={styles.movementName}>{movement.name}</Text> : null}
        <Text style={styles.movementMeta}>
          {type.label} · {prettyTimestamp(movement.created_at)}
        </Text>
        {movement.note ? <Text style={styles.movementNote}>{movement.note}</Text> : null}
      </View>
    </View>
  );
}

// Search box + scan button + matching products. Used when no product is chosen yet.
function ProductPicker({ onPick, onCreate }) {
  const { db, version } = useData();
  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState('');
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    listProducts(db).then(setProducts);
  }, [db, version]);

  const cleanQuery = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!cleanQuery) return products.slice(0, 30);
    return products
      .filter((p) => p.name.toLowerCase().includes(cleanQuery) || p.barcode === query.trim())
      .slice(0, 30);
  }, [products, cleanQuery, query]);

  async function onScanned(barcode) {
    setScanning(false);
    const product = await findProductByBarcode(db, barcode);
    if (product) {
      onPick(product.id);
      return;
    }
    Alert.alert('New barcode', 'No product has this barcode yet. Add it as a new product?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Add product', onPress: () => onCreate({ barcode }) },
    ]);
  }

  return (
    <View>
      <Text style={ui.label}>Which product?</Text>
      <View style={ui.row}>
        <TextInput
          style={[ui.input, { flex: 1 }]}
          placeholder="Type a name…"
          value={query}
          onChangeText={setQuery}
          autoFocus
        />
        <Pressable style={styles.scanBtn} onPress={() => setScanning(true)} accessibilityLabel="Scan barcode">
          <Text style={styles.scanBtnText}>Scan</Text>
        </Pressable>
      </View>

      <View style={{ marginTop: 12 }}>
        {matches.map((product) => (
          <Pressable key={product.id} style={styles.pickRow} onPress={() => onPick(product.id)}>
            <Text style={styles.pickName}>{product.name}</Text>
            <Text style={styles.pickStock}>{product.stock} in stock</Text>
          </Pressable>
        ))}
        {matches.length === 0 ? (
          <Text style={ui.hint}>
            {products.length === 0 ? 'No products yet.' : 'No product matches that name.'}
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', marginTop: 16 }}>
        <SecondaryButton
          label={cleanQuery ? `＋ New product "${query.trim()}"` : '＋ New product'}
          onPress={() => onCreate({ name: query.trim() })}
        />
      </View>

      <BarcodeScanner visible={scanning} onClose={() => setScanning(false)} onScanned={onScanned} />
    </View>
  );
}

// ---------- Product page ----------

function ProductSheet({ productId }) {
  const { db, version, bump } = useData();
  const sheets = useSheets();
  const product = useProduct(productId);
  const [batches, setBatches] = useState([]);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    listBatches(db, productId).then(setBatches);
    listMovements(db, { productId, limit: 15 }).then(setHistory);
  }, [db, productId, version]);

  function throwOut(batch) {
    Alert.alert(
      'Throw out expired stock?',
      `${batch.quantity} × ${product.name} will be removed and recorded as expired.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Throw out',
          style: 'destructive',
          onPress: async () => {
            await removeBatch(db, batch.id, 'expired');
            bump();
          },
        },
      ]
    );
  }

  if (!product) return <Sheet visible title="Product" onClose={sheets.pop} />;
  const level = stockLevel(product);

  return (
    <Sheet visible title={product.name} onClose={sheets.pop}>
      <View style={styles.stockBox}>
        <Text style={[styles.stockNumber, { color: level.color }]}>{product.stock}</Text>
        <Text style={[styles.stockLabel, { color: level.color }]}>{level.label}</Text>
        <Text style={styles.stockMeta}>
          Low-stock warning at {product.low_stock} · {product.category}
        </Text>
        <Text style={styles.stockMeta}>
          Sells for {formatMoney(product.sell_price)}
        </Text>
        {product.barcode ? <Text style={styles.stockMeta}>Barcode {product.barcode}</Text> : null}
      </View>

      <View style={styles.actionGrid}>
        <PrimaryButton
          label="＋ Receive"
          onPress={() => sheets.push({ kind: 'receive', productId })}
        />
        <PrimaryButton
          label="− Remove"
          color={COLORS.critical.main}
          onPress={() => sheets.push({ kind: 'remove', productId })}
          disabled={product.stock <= 0}
        />
      </View>
      <View style={[styles.actionGrid, { marginTop: 10 }]}>
        <SecondaryButton label="Count stock" onPress={() => sheets.push({ kind: 'count', productId })} />
        <SecondaryButton label="Edit details" onPress={() => sheets.push({ kind: 'form', productId })} />
      </View>

      <Text style={ui.label}>Stock by expiry date</Text>
      {batches.length === 0 ? <Text style={ui.hint}>No stock.</Text> : null}
      {batches.map((batch) => {
        const status = batch.expiry_date ? expiryStatus(batch.expiry_date) : null;
        const color = status ? COLORS[status.key].main : MUTED;
        return (
          <View key={batch.id} style={[styles.batchRow, { borderLeftColor: color }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.batchQty}>{batch.quantity} {batch.quantity === 1 ? 'pc' : 'pcs'}</Text>
              <Text style={[styles.batchExpiry, { color }]}>
                {batch.expiry_date
                  ? `${status.label} · ${prettyISODate(batch.expiry_date)}`
                  : 'No expiry date'}
              </Text>
            </View>
            {status?.key === 'expired' ? (
              <Pressable onPress={() => throwOut(batch)} hitSlop={8}>
                <Text style={ui.dangerText}>Throw out</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}

      <Text style={ui.label}>Recent changes</Text>
      {history.length === 0 ? <Text style={ui.hint}>Nothing yet.</Text> : null}
      {history.map((movement) => (
        <MovementRow key={movement.id} movement={movement} showName={false} />
      ))}
    </Sheet>
  );
}

// ---------- Add / edit product ----------

function ProductFormSheet({ productId, name: presetName = '', barcode: presetBarcode = '', then }) {
  const { db, bump } = useData();
  const sheets = useSheets();
  const existing = useProduct(productId);

  const [name, setName] = useState(presetName);
  // Barcode, price and low-stock level have no fields: a barcode is saved
  // when the product is created from a scan, and existing values are kept
  // when editing.
  const [barcode, setBarcode] = useState(presetBarcode);
  const [category, setCategory] = useState('Other');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!existing) return;
    setName(existing.name);
    setBarcode(existing.barcode ?? '');
    setCategory(existing.category);
  }, [existing]);

  const canSave = name.trim() !== '' && !saving;

  async function save() {
    setSaving(true);
    try {
      const id = await saveProduct(db, {
        id: productId,
        name,
        barcode,
        category,
        sell_price: existing?.sell_price ?? 0,
        cost_price: existing?.cost_price ?? 0,
        low_stock: existing?.low_stock ?? 5,
      });
      bump();
      if (then === 'receive') sheets.replaceTop({ kind: 'receive', productId: id });
      else if (then === 'remove') sheets.replaceTop({ kind: 'remove', productId: id });
      else if (!productId) sheets.replaceTop({ kind: 'product', productId: id });
      else sheets.pop();
    } catch (e) {
      Alert.alert('Could not save', e.message);
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    Alert.alert(
      'Delete product?',
      `"${existing.name}" and its stock will be removed from the lists. Its history is kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await archiveProduct(db, productId);
            bump();
            sheets.closeAll();
          },
        },
      ]
    );
  }

  return (
    <Sheet
      visible
      title={productId ? 'Edit product' : 'New product'}
      onClose={sheets.pop}
      footer={<PrimaryButton label={saving ? 'Saving…' : 'Save product'} onPress={save} disabled={!canSave} />}
    >
      <Text style={ui.label}>Name</Text>
      <TextInput
        style={ui.input}
        placeholder="e.g. Coke 1.5L"
        value={name}
        onChangeText={setName}
        autoFocus={!productId && !presetName}
      />

      <Text style={ui.label}>Category</Text>
      <Chips options={CATEGORIES.map((c) => [c, c])} value={category} onChange={setCategory} />

      {productId && existing ? (
        <Pressable style={{ marginTop: 28, alignSelf: 'center' }} onPress={confirmDelete}>
          <Text style={ui.dangerText}>Delete this product</Text>
        </Pressable>
      ) : null}

    </Sheet>
  );
}

// ---------- Receive stock ----------

function ReceiveSheet({ productId: initialProductId }) {
  const { db, bump } = useData();
  const sheets = useSheets();
  const [productId, setProductId] = useState(initialProductId);
  const product = useProduct(productId);
  const [quantity, setQuantity] = useState('1');
  const [expiry, setExpiry] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const qty = parseWholeNumber(quantity);
  const canSave = product && qty > 0 && isExpiryFieldValid(expiry.trim()) && !saving;

  async function save() {
    setSaving(true);
    try {
      const cleanExpiry = expiry.trim();
      await receiveStock(db, productId, qty, cleanExpiry, note);
      bump();
      Alert.alert('Stock added ✅', `+${qty} ${product.name}`, [
        { text: 'Add another item', onPress: () => sheets.replaceTop({ kind: 'receive' }) },
        { text: 'Done', onPress: sheets.pop },
      ]);
    } catch (e) {
      Alert.alert('Could not save', e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!productId) {
    return (
      <Sheet visible title="Receive stock" onClose={sheets.pop}>
        <ProductPicker
          onPick={setProductId}
          onCreate={(preset) => sheets.replaceTop({ kind: 'form', ...preset, then: 'receive' })}
        />
      </Sheet>
    );
  }

  return (
    <Sheet
      visible
      title="Receive stock"
      onClose={sheets.pop}
      footer={<PrimaryButton label={saving ? 'Saving…' : 'Add to stock'} onPress={save} disabled={!canSave} />}
    >
      <Text style={styles.productHeading}>{product?.name ?? ''}</Text>
      {product ? <Text style={ui.hint}>Now in stock: {product.stock}</Text> : null}

      <Text style={ui.label}>1. How many arrived?</Text>
      <QuantityInput value={quantity} onChange={setQuantity} />

      <Text style={ui.label}>2. When does it expire?</Text>
      <ExpiryField value={expiry} onChange={setExpiry} />

      <Text style={ui.label}>3. Note (optional)</Text>
      <TextInput
        style={ui.input}
        placeholder="e.g. supplier or receipt number"
        value={note}
        onChangeText={setNote}
      />
    </Sheet>
  );
}

// ---------- Remove stock ----------

const REASON_HELP = {
  sold: 'Sold to customers (e.g. end-of-day count of what was sold).',
  damaged: 'Broken, opened or spoiled — counted as waste.',
  expired: 'Past its expiry date and thrown out — counted as waste.',
  own_use: 'Used by the store or staff.',
  returned: 'Sent back to the supplier.',
};

function RemoveSheet({ productId: initialProductId }) {
  const { db, bump } = useData();
  const sheets = useSheets();
  const [productId, setProductId] = useState(initialProductId);
  const product = useProduct(productId);
  const [reason, setReason] = useState('sold');
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const qty = parseWholeNumber(quantity);
  // Expired stock can't be sold or used; it can only be thrown out or returned.
  const expiredExcluded = product && NOT_EXPIRED_ONLY.includes(reason) ? product.expired_stock : 0;
  const available = product ? product.stock - expiredExcluded : 0;
  const tooMany = product && qty > available;
  const canSave = product && qty > 0 && !tooMany && !saving;

  async function save() {
    setSaving(true);
    try {
      await removeStock(db, productId, qty, reason, note);
      bump();
      sheets.pop();
    } catch (e) {
      Alert.alert('Could not save', e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!productId) {
    return (
      <Sheet visible title="Remove stock" onClose={sheets.pop}>
        <ProductPicker
          onPick={setProductId}
          onCreate={(preset) => sheets.replaceTop({ kind: 'form', ...preset, then: 'remove' })}
        />
      </Sheet>
    );
  }

  return (
    <Sheet
      visible
      title="Remove stock"
      onClose={sheets.pop}
      footer={
        <PrimaryButton
          label={saving ? 'Saving…' : 'Remove from stock'}
          color={COLORS.critical.main}
          onPress={save}
          disabled={!canSave}
        />
      }
    >
      <Text style={styles.productHeading}>{product?.name ?? ''}</Text>
      {product ? <Text style={ui.hint}>Now in stock: {product.stock}</Text> : null}

      <Text style={ui.label}>1. Why?</Text>
      <Chips
        options={REMOVE_REASONS.map((r) => [r, MOVEMENT_TYPES[r].label])}
        value={reason}
        onChange={setReason}
      />
      <Text style={ui.hint}>{REASON_HELP[reason]}</Text>

      <Text style={ui.label}>2. How many?</Text>
      <QuantityInput value={quantity} onChange={setQuantity} />
      {tooMany ? (
        <Text style={[ui.hint, ui.hintBad]}>
          {expiredExcluded > 0
            ? `Only ${available} can be ${reason === 'sold' ? 'sold' : 'used'}. ${expiredExcluded} expired — throw them out instead.`
            : `Only ${available} in stock.`}
        </Text>
      ) : (
        <Text style={ui.hint}>Taken from the stock that expires first.</Text>
      )}

      <Text style={ui.label}>3. Note (optional)</Text>
      <TextInput style={ui.input} placeholder="Anything to remember" value={note} onChangeText={setNote} />
    </Sheet>
  );
}

// ---------- Count stock ----------

function CountSheet({ productId }) {
  const { db, bump } = useData();
  const sheets = useSheets();
  const product = useProduct(productId);
  const [counted, setCounted] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (product && counted === null) setCounted(String(product.stock));
  }, [product, counted]);

  const countedNumber = parseWholeNumber(counted ?? '');
  const difference = product && !Number.isNaN(countedNumber) ? countedNumber - product.stock : 0;
  const canSave = product && !Number.isNaN(countedNumber) && !saving;

  async function save() {
    setSaving(true);
    try {
      await setCountedStock(db, productId, countedNumber);
      bump();
      sheets.pop();
    } catch (e) {
      Alert.alert('Could not save', e.message);
    } finally {
      setSaving(false);
    }
  }

  let differenceText = 'Matches what Shelby has. 👍';
  if (difference > 0) differenceText = `${difference} more than Shelby has — they will be added.`;
  if (difference < 0) differenceText = `${-difference} fewer than Shelby has — they will be removed.`;

  return (
    <Sheet
      visible
      title="Count stock"
      onClose={sheets.pop}
      footer={<PrimaryButton label={saving ? 'Saving…' : 'Save count'} onPress={save} disabled={!canSave} />}
    >
      <Text style={styles.productHeading}>{product?.name ?? ''}</Text>
      <Text style={ui.hint}>Shelby has: {product?.stock ?? '…'}</Text>

      <Text style={ui.label}>How many are really on the shelf?</Text>
      {counted !== null ? <QuantityInput value={counted} onChange={setCounted} min={0} /> : null}
      <Text style={[ui.hint, difference !== 0 && { color: INK, fontWeight: '600' }]}>{differenceText}</Text>
      <Text style={ui.hint}>
        Use this after counting the shelf. For new deliveries use "Receive" so the expiry date is saved.
      </Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scanBtn: {
    backgroundColor: COLORS.all.main,
    borderRadius: 10,
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  scanBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  pickRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  pickName: { fontSize: 16, color: INK, flex: 1 },
  pickStock: { fontSize: 14, color: MUTED },
  productHeading: { fontSize: 22, fontWeight: 'bold', color: INK },

  stockBox: { alignItems: 'center', paddingVertical: 8, marginBottom: 16 },
  stockNumber: { fontSize: 48, fontWeight: 'bold' },
  stockLabel: { fontSize: 17, fontWeight: 'bold', marginBottom: 6 },
  stockMeta: { fontSize: 14, color: MUTED, marginTop: 2, textAlign: 'center' },
  actionGrid: { flexDirection: 'row', gap: 10 },

  batchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fb',
    borderRadius: 10,
    borderLeftWidth: 5,
    padding: 10,
    marginBottom: 8,
  },
  batchQty: { fontSize: 16, fontWeight: 'bold', color: INK },
  batchExpiry: { fontSize: 14, marginTop: 2 },

  movement: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  movementQty: { fontSize: 18, fontWeight: 'bold', minWidth: 48, textAlign: 'right' },
  movementName: { fontSize: 16, fontWeight: '600', color: INK },
  movementMeta: { fontSize: 14, color: MUTED, marginTop: 2 },
  movementNote: { fontSize: 14, color: '#444', marginTop: 2, fontStyle: 'italic' },
});

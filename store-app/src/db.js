// On-phone inventory database (expo-sqlite).
//
// products  — what the store sells (name, barcode, prices, low-stock level)
// batches   — stock on hand; one row per delivery so each can have its own expiry date
// movements — history of every stock change (received, sold, damaged, ...)
//
// Stock of a product = sum of its batch quantities. Stock going out is always
// taken from the batch that expires first ("first expiry, first out").

import { daysFromToday, startOfMonthTimestamp, toISODate, WARNING_DAYS } from './dates';

export const DATABASE_NAME = 'shelby.db';
const DATABASE_VERSION = 2;

export const CATEGORIES = ['Drinks', 'Snacks', 'Dairy', 'Frozen', 'Canned', 'Bread', 'Toiletries', 'Other'];

// Every kind of stock change. sign: +1 adds stock, -1 removes it, 0 can be either.
export const MOVEMENT_TYPES = {
  received: { label: 'Received', sign: 1 },
  sold: { label: 'Sold', sign: -1 },
  damaged: { label: 'Damaged', sign: -1 },
  expired: { label: 'Expired (thrown out)', sign: -1 },
  own_use: { label: 'Used in store', sign: -1 },
  returned: { label: 'Returned to supplier', sign: -1 },
  count: { label: 'Stock count fix', sign: 0 },
};

// Reasons staff can pick when taking stock out.
export const REMOVE_REASONS = ['sold', 'damaged', 'expired', 'own_use', 'returned'];
export const WASTE_TYPES = ['damaged', 'expired'];

const NOW = "datetime('now', 'localtime')";

export async function migrateDbIfNeeded(db) {
  const row = await db.getFirstAsync('PRAGMA user_version');
  const currentVersion = row?.user_version ?? 0;
  if (currentVersion >= DATABASE_VERSION) return;

  if (currentVersion === 0) {
    await db.execAsync(`
      PRAGMA journal_mode = 'wal';
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        barcode TEXT,
        category TEXT NOT NULL DEFAULT 'Other',
        cost_price REAL NOT NULL DEFAULT 0,
        sell_price REAL NOT NULL DEFAULT 0,
        low_stock INTEGER NOT NULL DEFAULT 5,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (${NOW})
      );
      CREATE INDEX IF NOT EXISTS products_barcode_idx ON products (barcode);
      CREATE TABLE IF NOT EXISTS batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity >= 0),
        expiry_date TEXT,
        received_at TEXT NOT NULL DEFAULT (${NOW})
      );
      CREATE INDEX IF NOT EXISTS batches_product_idx ON batches (product_id);
      CREATE INDEX IF NOT EXISTS batches_expiry_idx ON batches (expiry_date);
      CREATE TABLE IF NOT EXISTS movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_cost REAL NOT NULL DEFAULT 0,
        unit_price REAL NOT NULL DEFAULT 0,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (${NOW})
      );
      CREATE INDEX IF NOT EXISTS movements_created_idx ON movements (created_at);
    `);
  }
  if (currentVersion < 2) {
    // Version 1 could split one product's stock into several batches with the
    // same expiry date; combine them.
    await mergeDuplicateBatches(db);
  }
  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}

// Combines batches of the same product with the same expiry date (or both
// without one) into a single batch.
async function mergeDuplicateBatches(db) {
  await db.execAsync(`
    UPDATE batches SET quantity = (
      SELECT SUM(other.quantity) FROM batches other
      WHERE other.product_id = batches.product_id AND other.expiry_date IS batches.expiry_date
    )
    WHERE id IN (SELECT MIN(id) FROM batches GROUP BY product_id, expiry_date);
    DELETE FROM batches WHERE id NOT IN (SELECT MIN(id) FROM batches GROUP BY product_id, expiry_date);
  `);
}

// ---------- Products ----------

// All active products with their current stock and nearest expiry date.
export function listProducts(db) {
  return db.getAllAsync(`
    SELECT p.*, COALESCE(SUM(b.quantity), 0) AS stock, MIN(b.expiry_date) AS next_expiry
    FROM products p
    LEFT JOIN batches b ON b.product_id = p.id AND b.quantity > 0
    WHERE p.archived = 0
    GROUP BY p.id
    ORDER BY p.name COLLATE NOCASE
  `);
}

// A product with its stock, and how much of that stock has already expired.
export function getProduct(db, productId) {
  return db.getFirstAsync(
    `SELECT p.*,
       COALESCE((SELECT SUM(quantity) FROM batches WHERE product_id = p.id), 0) AS stock,
       COALESCE((SELECT SUM(quantity) FROM batches
                 WHERE product_id = p.id AND expiry_date < ?), 0) AS expired_stock
     FROM products p WHERE p.id = ?`,
    toISODate(new Date()),
    productId
  );
}

export function findProductByBarcode(db, barcode) {
  return db.getFirstAsync(
    'SELECT * FROM products WHERE barcode = ? AND archived = 0 LIMIT 1',
    barcode
  );
}

// Creates the product when it has no id, otherwise updates it. Returns the id.
export async function saveProduct(db, product) {
  const barcode = product.barcode?.trim() || null;
  if (barcode) {
    const sameBarcode = await findProductByBarcode(db, barcode);
    if (sameBarcode && sameBarcode.id !== product.id) {
      throw new Error(`This barcode already belongs to "${sameBarcode.name}".`);
    }
  }
  const values = [
    product.name.trim(),
    barcode,
    product.category,
    product.cost_price,
    product.sell_price,
    product.low_stock,
  ];
  if (product.id) {
    await db.runAsync(
      `UPDATE products SET name = ?, barcode = ?, category = ?, cost_price = ?, sell_price = ?, low_stock = ?
       WHERE id = ?`,
      ...values,
      product.id
    );
    return product.id;
  }
  const result = await db.runAsync(
    `INSERT INTO products (name, barcode, category, cost_price, sell_price, low_stock)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ...values
  );
  return result.lastInsertRowId;
}

// Hides a product from every list. Its history is kept.
export async function archiveProduct(db, productId) {
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('UPDATE products SET archived = 1 WHERE id = ?', productId);
    await txn.runAsync('DELETE FROM batches WHERE product_id = ?', productId);
  });
}

// ---------- Batches ----------

export function listBatches(db, productId) {
  return db.getAllAsync(
    `SELECT * FROM batches WHERE product_id = ? AND quantity > 0
     ORDER BY expiry_date IS NULL, expiry_date, id`,
    productId
  );
}

// Every batch with an expiry date, soonest first, for the Expiry screen.
export function listExpiringBatches(db) {
  return db.getAllAsync(`
    SELECT b.*, p.name, p.category
    FROM batches b JOIN products p ON p.id = b.product_id
    WHERE p.archived = 0 AND b.quantity > 0 AND b.expiry_date IS NOT NULL
    ORDER BY b.expiry_date, p.name COLLATE NOCASE
  `);
}

// ---------- Stock changes ----------

async function logMovement(txn, product, type, quantity, note) {
  await txn.runAsync(
    `INSERT INTO movements (product_id, type, quantity, unit_cost, unit_price, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    product.id,
    type,
    quantity,
    product.cost_price,
    product.sell_price,
    note?.trim() || null
  );
}

// Takes `quantity` out of the product's batches, soonest expiry first.
// Reasons where the items go to customers or are used, so expired stock must
// never be taken for them.
export const NOT_EXPIRED_ONLY = ['sold', 'own_use'];

async function takeFromBatches(txn, productId, quantity, { skipExpired = false } = {}) {
  const batches = await txn.getAllAsync(
    `SELECT id, quantity FROM batches
     WHERE product_id = ? AND quantity > 0 ${skipExpired ? 'AND (expiry_date IS NULL OR expiry_date >= ?)' : ''}
     ORDER BY expiry_date IS NULL, expiry_date, id`,
    ...(skipExpired ? [productId, toISODate(new Date())] : [productId])
  );
  const available = batches.reduce((sum, b) => sum + b.quantity, 0);
  if (available < quantity) {
    throw new Error(skipExpired ? `Only ${available} in stock that has not expired.` : `Only ${available} in stock.`);
  }
  let remaining = quantity;
  for (const batch of batches) {
    if (remaining === 0) break;
    const taken = Math.min(batch.quantity, remaining);
    remaining -= taken;
    if (taken === batch.quantity) {
      await txn.runAsync('DELETE FROM batches WHERE id = ?', batch.id);
    } else {
      await txn.runAsync('UPDATE batches SET quantity = quantity - ? WHERE id = ?', taken, batch.id);
    }
  }
}

// Adds stock to the batch with the same expiry date (or no expiry), or starts a new batch.
async function addToBatch(txn, productId, quantity, expiryDate) {
  const sameDate = await txn.getFirstAsync(
    'SELECT id FROM batches WHERE product_id = ? AND expiry_date IS ? LIMIT 1',
    productId,
    expiryDate
  );
  if (sameDate) {
    await txn.runAsync('UPDATE batches SET quantity = quantity + ? WHERE id = ?', quantity, sameDate.id);
  } else {
    await txn.runAsync(
      'INSERT INTO batches (product_id, quantity, expiry_date) VALUES (?, ?, ?)',
      productId,
      quantity,
      expiryDate
    );
  }
}

export async function receiveStock(db, productId, quantity, expiryDate, note) {
  await db.withExclusiveTransactionAsync(async (txn) => {
    const product = await txn.getFirstAsync('SELECT * FROM products WHERE id = ?', productId);
    await addToBatch(txn, productId, quantity, expiryDate || null);
    await logMovement(txn, product, 'received', quantity, note);
  });
}

export async function removeStock(db, productId, quantity, type, note) {
  await db.withExclusiveTransactionAsync(async (txn) => {
    const product = await txn.getFirstAsync('SELECT * FROM products WHERE id = ?', productId);
    await takeFromBatches(txn, productId, quantity, { skipExpired: NOT_EXPIRED_ONLY.includes(type) });
    await logMovement(txn, product, type, -quantity, note);
  });
}

// Throws out one whole batch (used for expired stock).
export async function removeBatch(db, batchId, type) {
  await db.withExclusiveTransactionAsync(async (txn) => {
    const batch = await txn.getFirstAsync('SELECT * FROM batches WHERE id = ?', batchId);
    if (!batch) return;
    const product = await txn.getFirstAsync('SELECT * FROM products WHERE id = ?', batch.product_id);
    await txn.runAsync('DELETE FROM batches WHERE id = ?', batchId);
    await logMovement(txn, product, type, -batch.quantity, null);
  });
}

// Sets stock to what staff actually counted on the shelf.
export async function setCountedStock(db, productId, countedQuantity) {
  await db.withExclusiveTransactionAsync(async (txn) => {
    const product = await txn.getFirstAsync('SELECT * FROM products WHERE id = ?', productId);
    const row = await txn.getFirstAsync(
      'SELECT COALESCE(SUM(quantity), 0) AS stock FROM batches WHERE product_id = ?',
      productId
    );
    const difference = countedQuantity - row.stock;
    if (difference === 0) return;
    if (difference < 0) {
      await takeFromBatches(txn, productId, -difference);
    } else {
      await addToBatch(txn, productId, difference, null);
    }
    await logMovement(txn, product, 'count', difference, `Counted ${countedQuantity}`);
  });
}

// ---------- History ----------

export function listMovements(db, { productId = null, types = null, limit = 100 } = {}) {
  const where = [];
  const params = [];
  if (productId) {
    where.push('m.product_id = ?');
    params.push(productId);
  }
  if (types) {
    where.push(`m.type IN (${types.map(() => '?').join(', ')})`);
    params.push(...types);
  }
  return db.getAllAsync(
    `SELECT m.*, p.name FROM movements m JOIN products p ON p.id = m.product_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY m.created_at DESC, m.id DESC LIMIT ?`,
    ...params,
    limit
  );
}

// ---------- Reports ----------

export async function getReport(db) {
  const stock = await db.getFirstAsync(`
    SELECT
      (SELECT COUNT(*) FROM products WHERE archived = 0) AS product_count,
      COALESCE(SUM(b.quantity), 0) AS units,
      COALESCE(SUM(b.quantity * p.cost_price), 0) AS cost_value,
      COALESCE(SUM(b.quantity * p.sell_price), 0) AS sell_value
    FROM batches b JOIN products p ON p.id = b.product_id
    WHERE p.archived = 0
  `);
  const monthRows = await db.getAllAsync(
    `SELECT type, SUM(ABS(quantity)) AS units, SUM(ABS(quantity) * unit_cost) AS cost,
            SUM(ABS(quantity) * unit_price) AS sales
     FROM movements WHERE created_at >= ? GROUP BY type`,
    startOfMonthTimestamp()
  );
  const month = {};
  for (const row of monthRows) month[row.type] = row;
  // Valued at selling price: products have no cost field anymore.
  const soonValue = await db.getFirstAsync(
    `SELECT COALESCE(SUM(b.quantity * p.sell_price), 0) AS value
     FROM batches b JOIN products p ON p.id = b.product_id
     WHERE p.archived = 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <= ?`,
    daysFromToday(WARNING_DAYS)
  );
  return { stock, month, expiringValue: soonValue.value };
}

// ---------- Backup ----------

export async function exportData(db) {
  return {
    app: 'shelby',
    version: DATABASE_VERSION,
    exported_at: new Date().toISOString(),
    products: await db.getAllAsync('SELECT * FROM products'),
    batches: await db.getAllAsync('SELECT * FROM batches'),
    movements: await db.getAllAsync('SELECT * FROM movements'),
  };
}

// Only these columns are read from a backup file.
const BACKUP_COLUMNS = {
  products: ['id', 'name', 'barcode', 'category', 'cost_price', 'sell_price', 'low_stock', 'archived', 'created_at'],
  batches: ['id', 'product_id', 'quantity', 'expiry_date', 'received_at'],
  movements: ['id', 'product_id', 'type', 'quantity', 'unit_cost', 'unit_price', 'note', 'created_at'],
};

async function insertRows(txn, table, rows) {
  for (const row of rows) {
    const columns = BACKUP_COLUMNS[table].filter((c) => row[c] !== undefined);
    await txn.runAsync(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      ...columns.map((c) => row[c])
    );
  }
}

export function isShelbyBackup(backup) {
  return (
    backup?.app === 'shelby' &&
    Array.isArray(backup.products) &&
    Array.isArray(backup.batches) &&
    Array.isArray(backup.movements)
  );
}

// Replaces everything on this phone with the backup's contents.
export async function importData(db, backup) {
  if (!isShelbyBackup(backup)) throw new Error('This file is not a Shelby backup.');
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync('DELETE FROM movements; DELETE FROM batches; DELETE FROM products;');
    await insertRows(txn, 'products', backup.products);
    await insertRows(txn, 'batches', backup.batches);
    await insertRows(txn, 'movements', backup.movements);
    await mergeDuplicateBatches(txn);
  });
}

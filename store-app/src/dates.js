// Date helpers. Dates are stored as local "YYYY-MM-DD" strings and
// timestamps as local "YYYY-MM-DD HH:MM:SS" strings (SQLite localtime).

// How many days ahead count as "warning" / "critical".
export const WARNING_DAYS = 7;
export const CRITICAL_DAYS = 3;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseISODate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Whole days from today until a YYYY-MM-DD date (negative = already expired).
export function daysLeft(expiryDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((parseISODate(expiryDate) - today) / 86400000);
}

export function toISODate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

export function daysFromToday(daysAhead) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return toISODate(date);
}

// "Tue, Oct 20, 2026"
export function prettyDate(date) {
  return `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

export function prettyISODate(isoDate) {
  return prettyDate(parseISODate(isoDate));
}

// "Oct 5, 9:30 AM" from a "YYYY-MM-DD HH:MM:SS" timestamp.
export function prettyTimestamp(timestamp) {
  const [datePart, timePart = '00:00'] = timestamp.split(' ');
  const date = parseISODate(datePart);
  const [hour, minute] = timePart.split(':').map(Number);
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? 'AM' : 'PM';
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

// True only for real calendar dates like 2026-10-20 (rejects 2026-02-31).
export function isValidISODate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// Expiry status of a YYYY-MM-DD date: key is expired | critical | warning | fresh.
export function expiryStatus(expiryDate) {
  const left = daysLeft(expiryDate);
  if (left < 0) {
    const ago = Math.abs(left);
    return { key: 'expired', label: ago === 1 ? 'Expired yesterday' : `Expired ${ago} days ago` };
  }
  if (left === 0) return { key: 'critical', label: 'Expires today' };
  if (left === 1) return { key: 'critical', label: 'Expires tomorrow' };
  if (left <= CRITICAL_DAYS) return { key: 'critical', label: `Expires in ${left} days` };
  if (left <= WARNING_DAYS) return { key: 'warning', label: `Expires in ${left} days` };
  return { key: 'fresh', label: `Expires in ${left} days` };
}

// Current local time as "YYYY-MM-DD HH:MM:SS", the same format SQLite stores.
export function nowTimestamp() {
  const now = new Date();
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
  return `${toISODate(now)} ${time}`;
}

// First day of the current month as a timestamp, for "this month" reports.
export function startOfMonthTimestamp() {
  const now = new Date();
  return `${toISODate(new Date(now.getFullYear(), now.getMonth(), 1))} 00:00:00`;
}

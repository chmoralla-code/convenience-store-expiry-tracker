import { StyleSheet } from 'react-native';

// One color set per status, used by tiles, card stripes and labels.
export const COLORS = {
  expired: { main: '#d63031', soft: '#fdecea' },
  critical: { main: '#e67e22', soft: '#fdf1e6' },
  warning: { main: '#c99a06', soft: '#fdf7e0' },
  fresh: { main: '#27ae60', soft: '#e8f6ee' },
  all: { main: '#2f62c4', soft: '#eaf0ff' },
};

export const INK = '#1d2433';
export const MUTED = '#777';
export const BACKGROUND = '#f4f6f8';
export const TELEGRAM_BLUE = '#229ED9';

export function formatMoney(amount) {
  const [whole, cents] = Number(amount || 0).toFixed(2).split('.');
  return `₱${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BACKGROUND },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  screenTitle: { fontSize: 24, fontWeight: 'bold', color: INK },
  screenSubtitle: { fontSize: 14, color: '#666', marginTop: 2 },

  tiles: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  tile: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tileNum: { fontSize: 24, fontWeight: 'bold' },
  tileLabel: { fontSize: 12, color: '#444', marginTop: 2, textAlign: 'center' },

  listContent: { paddingHorizontal: 16, paddingBottom: 16, flexGrow: 1 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderLeftWidth: 6,
    borderLeftColor: '#d0d5dc',
    padding: 12,
    marginBottom: 10,
    gap: 10,
  },
  cardInfo: { flex: 1 },
  cardTitle: { fontSize: 17, fontWeight: 'bold', color: INK },
  cardStatus: { fontSize: 15, fontWeight: '600', marginTop: 2 },
  cardMeta: { fontSize: 13, color: MUTED, marginTop: 4 },
  empty: { textAlign: 'center', color: MUTED, fontSize: 16, marginTop: 40, lineHeight: 24 },

  bottomBar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: BACKGROUND,
    borderTopWidth: 1,
    borderTopColor: '#e2e6ea',
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: COLORS.fresh.main,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 17 },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#bbb',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  secondaryBtnText: { fontSize: 16, fontWeight: '600', color: '#333' },
  dangerText: { color: COLORS.expired.main, fontSize: 15, fontWeight: '600' },
  btnDisabled: { opacity: 0.45 },

  label: { fontSize: 16, fontWeight: 'bold', color: INK, marginTop: 16, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  hint: { fontSize: 14, color: MUTED, marginTop: 6 },
  hintGood: { color: COLORS.fresh.main, fontWeight: '600' },
  hintBad: { color: COLORS.expired.main },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: '#bbb',
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  chipActive: { backgroundColor: COLORS.all.main, borderColor: COLORS.all.main },
  chipText: { color: '#333', fontSize: 15 },
  chipTextActive: { color: '#fff', fontWeight: 'bold', fontSize: 15 },

  section: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12 },
  sectionTitle: { fontSize: 17, fontWeight: 'bold', color: INK, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  statLabel: { fontSize: 15, color: '#444' },
  statValue: { fontSize: 15, fontWeight: 'bold', color: INK },
});

import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { COLORS, INK, ui } from './theme';
import { daysFromToday, daysLeft, isValidISODate, plural, prettyISODate } from './dates';

// How much of `viewRef` the on-screen keyboard covers. With Android edge-to-edge
// the window no longer shrinks for the keyboard, so sheets make room themselves.
// Measuring the overlap (instead of assuming it) also works where the window
// does shrink, e.g. in Expo Go.
function useKeyboardOverlap(viewRef) {
  const [overlap, setOverlap] = useState(0);
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (event) => {
      viewRef.current?.measureInWindow((x, y, width, height) => {
        setOverlap(Math.max(0, y + height - event.endCoordinates.screenY));
      });
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setOverlap(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [viewRef]);
  return overlap;
}

// Full-screen sheet with a title bar, a close button and an optional footer.
export function Sheet({ visible, title, onClose, children, footer }) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.sheet}>
          <SheetContent title={title} onClose={onClose} footer={footer}>
            {children}
          </SheetContent>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

function SheetContent({ title, onClose, children, footer }) {
  const containerRef = useRef(null);
  const keyboardOverlap = useKeyboardOverlap(containerRef);
  return (
    <View ref={containerRef} style={[styles.sheet, { paddingBottom: keyboardOverlap }]}>
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle} numberOfLines={1}>
          {title}
        </Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
    </View>
  );
}

export function PrimaryButton({ label, onPress, disabled, color }) {
  return (
    <Pressable
      style={[ui.primaryBtn, color && { backgroundColor: color }, disabled && ui.btnDisabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={ui.primaryBtnText}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({ label, onPress, disabled }) {
  return (
    <Pressable style={[ui.secondaryBtn, disabled && ui.btnDisabled]} onPress={onPress} disabled={disabled}>
      <Text style={ui.secondaryBtnText}>{label}</Text>
    </Pressable>
  );
}

// Row of pill buttons; `options` is a list of [value, label].
export function Chips({ options, value, onChange }) {
  return (
    <View style={ui.chips}>
      {options.map(([optionValue, label]) => {
        const isSelected = optionValue === value;
        return (
          <Pressable
            key={String(optionValue)}
            style={[ui.chip, isSelected && ui.chipActive]}
            onPress={() => onChange(optionValue)}
          >
            <Text style={isSelected ? ui.chipTextActive : ui.chipText}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Coloured count tiles that double as filters.
export function FilterTiles({ tiles, counts, value, onChange }) {
  return (
    <View style={ui.tiles}>
      {tiles.map((tile) => {
        const color = COLORS[tile.color];
        const isSelected = value === tile.key;
        return (
          <Pressable
            key={tile.key}
            style={[ui.tile, { backgroundColor: color.soft }, isSelected && { borderColor: color.main }]}
            onPress={() => onChange(tile.key)}
          >
            <Text style={[ui.tileNum, { color: color.main }]}>{counts[tile.key] ?? 0}</Text>
            <Text style={ui.tileLabel}>{tile.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Whole number from a text field; returns NaN for anything that isn't digits.
export function parseWholeNumber(text) {
  return /^\d+$/.test(String(text).trim()) ? parseInt(text, 10) : NaN;
}

// Big − [number] + control. The number can also be typed.
export function QuantityInput({ value, onChange, min = 1 }) {
  const number = parseWholeNumber(value);
  const step = (delta) => onChange(String(Math.max(min, (Number.isNaN(number) ? min : number) + delta)));
  return (
    <View style={styles.stepper}>
      <Pressable style={styles.stepBtn} onPress={() => step(-1)} accessibilityLabel="One less">
        <Text style={styles.stepText}>−</Text>
      </Pressable>
      <TextInput
        style={styles.stepInput}
        value={value}
        onChangeText={(text) => onChange(text.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        selectTextOnFocus
        maxLength={6}
      />
      <Pressable style={styles.stepBtn} onPress={() => step(1)} accessibilityLabel="One more">
        <Text style={styles.stepText}>+</Text>
      </Pressable>
    </View>
  );
}

const QUICK_DATES = [
  [1, 'Tomorrow'],
  [3, '3 days'],
  [7, '1 week'],
  [14, '2 weeks'],
  [30, '1 month'],
  [90, '3 months'],
];

// Expiry date picker: quick buttons or typed date.
// `value` is a YYYY-MM-DD string or '' (not chosen yet).
export function ExpiryField({ value, onChange }) {
  const typed = value;
  const isValid = isValidISODate(typed);

  let hint = 'Tap a button, or type the date printed on the pack.';
  let hintStyle = null;
  if (isValid) {
    const left = daysLeft(typed);
    const when = left < 0 ? 'already expired' : left === 0 ? 'today' : `in ${plural(left, 'day')}`;
    hint = `✓ ${prettyISODate(typed)} (${when})`;
    hintStyle = left < 0 ? ui.hintBad : ui.hintGood;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(typed)) {
    hint = 'That date does not exist. Check the month and day.';
    hintStyle = ui.hintBad;
  } else if (typed) {
    hint = 'Use this format: 2026-10-20 (year-month-day)';
    hintStyle = ui.hintBad;
  }

  const quickOptions = QUICK_DATES.map(([days, label]) => [daysFromToday(days), label]);
  return (
    <View>
      <Chips options={quickOptions} value={value} onChange={onChange} />
      <TextInput
        style={[ui.input, { marginTop: 10 }]}
        placeholder="or type it: YYYY-MM-DD"
        value={typed}
        onChangeText={onChange}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
      />
      <Text style={[ui.hint, hintStyle]}>{hint}</Text>
    </View>
  );
}

export function isExpiryFieldValid(value) {
  return isValidISODate(value);
}

const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'code93', 'itf14'];

// Full-screen camera that calls onScanned(barcode) once, then closes.
export function BarcodeScanner({ visible, onClose, onScanned }) {
  const [permission, requestPermission] = useCameraPermissions();
  const hasScanned = useRef(false);

  function handleScan({ data }) {
    if (hasScanned.current) return;
    hasScanned.current = true;
    onScanned(data);
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => {
        hasScanned.current = false;
      }}
    >
      <SafeAreaProvider>
        <SafeAreaView style={styles.scanner}>
          {permission?.granted ? (
            <View style={styles.cameraWrap}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
                onBarcodeScanned={handleScan}
              />
              <View style={styles.scanFrame} />
              <Text style={styles.scanHint}>Point the camera at the barcode</Text>
            </View>
          ) : (
            <View style={ui.center}>
              <Text style={styles.scanPermissionText}>
                Shelby needs the camera to scan barcodes.
              </Text>
              <View style={styles.permissionButtonRow}>
                <PrimaryButton label="Allow camera" onPress={requestPermission} />
              </View>
            </View>
          )}
          <View style={styles.scannerFooter}>
            <SecondaryButton label="Cancel" onPress={onClose} />
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: '#fff' },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  sheetTitle: { fontSize: 20, fontWeight: 'bold', color: INK, flex: 1 },
  closeText: { fontSize: 16, color: COLORS.all.main, fontWeight: '600' },
  sheetBody: { padding: 16, paddingBottom: 32 },
  sheetFooter: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: '#eee' },

  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.all.soft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { fontSize: 26, fontWeight: 'bold', color: COLORS.all.main },
  stepInput: {
    width: 90,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: 'bold',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    paddingVertical: 8,
  },

  scanner: { flex: 1, backgroundColor: '#000' },
  cameraWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scanFrame: {
    width: '75%',
    height: 160,
    borderWidth: 3,
    borderColor: '#fff',
    borderRadius: 16,
  },
  scanHint: { color: '#fff', fontSize: 16, marginTop: 16, fontWeight: '600' },
  scanPermissionText: { color: '#fff', fontSize: 17, textAlign: 'center' },
  permissionButtonRow: { flexDirection: 'row', alignSelf: 'stretch' },
  scannerFooter: { flexDirection: 'row', padding: 16, backgroundColor: '#000' },
});

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PrimaryButton, SecondaryButton } from './components';
import { checkForUpdate, currentVersion, downloadAndInstall } from './updates';
import { toISODate } from './dates';
import { COLORS, ui } from './theme';

const LAST_AUTO_CHECK = 'update_last_auto_check';

const UpdateContext = createContext(null);

// Holds the update state for the whole app, so the More tab shows an update
// found by the automatic check on app start.
export function UpdateProvider({ children }) {
  const [update, setUpdate] = useState(null); // newer version found, or null
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState(null); // 0–1 while downloading

  const install = useCallback(async (found) => {
    setProgress(0);
    try {
      await downloadAndInstall(found, setProgress);
    } catch (e) {
      Alert.alert('Update failed', e.message);
    } finally {
      setProgress(null);
    }
  }, []);

  const offer = useCallback(
    (found) => {
      const notes = found.notes ? `\n\nWhat's new:\n${found.notes}` : '';
      Alert.alert(
        'Update available',
        `Shelby ${found.version} is ready. Your data stays safe.${notes}`,
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Update now', onPress: () => install(found) },
        ]
      );
    },
    [install]
  );

  const checkNow = useCallback(async () => {
    setChecking(true);
    try {
      const found = await checkForUpdate();
      setUpdate(found);
      if (found) offer(found);
      else Alert.alert('Up to date ✅');
    } catch (e) {
      Alert.alert('Could not check', e.message);
    } finally {
      setChecking(false);
    }
  }, [offer]);

  // Checks quietly once a day when the app opens; only speaks up if there is an update.
  useEffect(() => {
    (async () => {
      try {
        const today = toISODate(new Date());
        if ((await AsyncStorage.getItem(LAST_AUTO_CHECK)) === today) return;
        const found = await checkForUpdate();
        await AsyncStorage.setItem(LAST_AUTO_CHECK, today);
        if (found) {
          setUpdate(found);
          offer(found);
        }
      } catch {
        // Offline or server busy — try again next time.
      }
    })();
  }, [offer]);

  const value = useMemo(
    () => ({ update, checking, progress, checkNow, install }),
    [update, checking, progress, checkNow, install]
  );
  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}

export function UpdateSection() {
  const { update, checking, progress, checkNow, install } = useContext(UpdateContext);
  const downloading = progress !== null;

  return (
    <View style={ui.section}>
      <Text style={ui.sectionTitle}>📲 Updates</Text>
      <Text style={ui.hint}>Version {currentVersion}</Text>
      {update ? (
        <Text style={[ui.hint, styles.available]}>
          New version {update.version} is ready.
        </Text>
      ) : null}
      {downloading ? (
        <View style={styles.progressWrap}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
          <Text style={ui.hint}>Downloading… {Math.round(progress * 100)}%</Text>
        </View>
      ) : null}
      <View style={[ui.row, { marginTop: 10 }]}>
        {update ? (
          <PrimaryButton
            label={downloading ? 'Downloading…' : `Update to ${update.version}`}
            onPress={() => install(update)}
            disabled={downloading}
          />
        ) : (
          <SecondaryButton
            label={checking ? 'Checking…' : 'Check for updates'}
            onPress={checkNow}
            disabled={checking || downloading}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  available: { color: COLORS.fresh.main, fontWeight: '600' },
  progressWrap: { marginTop: 10 },
  progressTrack: { height: 10, borderRadius: 5, backgroundColor: '#e2e6ea', overflow: 'hidden' },
  progressFill: { height: 10, backgroundColor: COLORS.fresh.main },
});

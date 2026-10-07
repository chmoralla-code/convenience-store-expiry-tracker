import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { DATABASE_NAME, migrateDbIfNeeded } from './src/db';
import { DataVersionContext } from './src/data';
import { SheetRouter, SheetsContext } from './src/sheets';
import { TABS, TabBar } from './src/screens';
import { refreshDailyReminder, sendDailyBackupIfDue, syncAutoBackupTask } from './src/services';
import { ui } from './src/theme';
import { UpdateProvider } from './src/UpdateSection';

export default function App() {
  return (
    <SafeAreaProvider>
      <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDbIfNeeded}>
        <UpdateProvider>
          <Shelby />
        </UpdateProvider>
      </SQLiteProvider>
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}

function Shelby() {
  const db = useSQLiteContext();
  const [tab, setTab] = useState('expiry');
  const [version, setVersion] = useState(0);
  const [sheetStack, setSheetStack] = useState([]);
  const nextSheetId = useRef(1);

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const dataContext = useMemo(() => ({ version, bump }), [version, bump]);

  // Sheets open on top of the tabs, one at a time; closing returns to the one below.
  const sheets = useMemo(() => {
    const withId = (sheet) => ({ ...sheet, id: nextSheetId.current++ });
    return {
      push: (sheet) => setSheetStack((stack) => [...stack, withId(sheet)]),
      replaceTop: (sheet) => setSheetStack((stack) => [...stack.slice(0, -1), withId(sheet)]),
      pop: () => setSheetStack((stack) => stack.slice(0, -1)),
      closeAll: () => setSheetStack([]),
    };
  }, []);

  // Keep the daily reminder's message up to date with the latest stock.
  useEffect(() => {
    refreshDailyReminder(db).catch(() => {});
  }, [db, version]);

  // Send today's Telegram backup when the app opens or comes back to the
  // screen, in case the background task hasn't run yet.
  useEffect(() => {
    syncAutoBackupTask().catch(() => {});
    // sendDailyBackupIfDue first loads any Telegram settings changed on another phone.
    sendDailyBackupIfDue(db);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') sendDailyBackupIfDue(db);
    });
    return () => subscription.remove();
  }, [db]);

  const { Screen } = TABS.find((t) => t.key === tab);

  return (
    <DataVersionContext.Provider value={dataContext}>
      <SheetsContext.Provider value={sheets}>
        <SafeAreaView style={ui.screen} edges={['top', 'left', 'right']}>
          <View style={ui.screen}>
            <Screen />
          </View>
          <TabBar value={tab} onChange={setTab} />
        </SafeAreaView>
        <SheetRouter sheet={sheetStack[sheetStack.length - 1]} />
      </SheetsContext.Provider>
    </DataVersionContext.Provider>
  );
}

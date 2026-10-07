import { createContext, useContext } from 'react';
import { useSQLiteContext } from 'expo-sqlite';

// Bumping `version` after any database write tells every screen to reload.
export const DataVersionContext = createContext({ version: 0, bump: () => {} });

export function useData() {
  const db = useSQLiteContext();
  const { version, bump } = useContext(DataVersionContext);
  return { db, version, bump };
}

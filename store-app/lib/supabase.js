import { createClient } from '@supabase/supabase-js';

// Public app keys loaded from env (see store-app/.env.example).
// Safe to ship in the app — enforced by Row Level Security.
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing Supabase env vars. Copy store-app/.env.example to store-app/.env and fill it in.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

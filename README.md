# Convenience Store — Expiry Tracker

Phone app (Expo) that tracks food items near expiration and sends a daily Telegram alert.

## Parts

- `store-app/` — Expo app: add items with expiry dates, color-coded list (Expired / Critical 0–3 days / Warning 4–7 days / Fresh)
- `supabase/migrations/` — shared `products` table + daily schedule
- `supabase/functions/expiry-check/` — daily job that pings Telegram with near-expiry items

## Run the app

1. Copy env and fill it in:
   - `cp store-app/.env.example store-app/.env`
2. Install and start:
   - `cd store-app && npm install && npx expo start`
   - Press `a` for the Android emulator

## Telegram alerts

Set these secrets on the `expiry-check` function in Supabase:

- `TELEGRAM_BOT_TOKEN` — from @BotFather
- `TELEGRAM_CHAT_ID` — your staff group chat id

Runs daily at 8 AM (Asia/Manila).

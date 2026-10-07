# Shelby — Convenience Store Inventory

Android app (Expo) for tracking a convenience store's stock and expiry dates.
Everything is stored **on the phone** (SQLite) and works without internet.

## What it does

- **Expiry** tab — every delivery with its expiry date, colour-coded:
  Expired / 0–3 days / 4–7 days. Throw out expired stock in one tap.
- **Stock** tab — all products with how many are left, low-stock and
  out-of-stock filters, search, and barcode scanning.
- **Product page** — Receive (delivery in, with expiry date), Remove (sold,
  damaged, expired, used in store, returned to supplier), Count (fix stock to
  what is really on the shelf) and Edit. Stock going out is taken from the
  batch that expires first.
- **History** tab — every stock change with its reason and time.
- **More** tab — this month's sales and waste, stock value at cost and selling
  price, reorder list (shareable), daily reminder notification, Telegram alert,
  and backup / restore.

## Run it for development

```bash
cd store-app
npm install
npx expo start
```

Press `a` to open it in Expo Go on the Android emulator. The daily reminder
only works in the installed APK — Expo Go doesn't support notifications.

## Build the APK

```bash
cd store-app
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
```

The APK is written to `store-app/android/app/build/outputs/apk/release/`.
On Windows, build from a short path such as `C:\sb` (or enable Windows long
paths): the project's full path is too long for the native build.

## Backups

Data lives only on the phone. Use **More → Save backup** regularly and keep the
file in Google Drive or Telegram. **More → Restore** loads a backup file and
replaces everything on the phone.

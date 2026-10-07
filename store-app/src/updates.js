// In-app updates: new versions are published as GitHub Releases with the APK
// attached (see scripts/release.sh). Shelby checks the latest release, and if
// it is newer, downloads the APK and opens Android's installer.

import Constants from 'expo-constants';
import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import { getContentUriAsync } from 'expo-file-system/legacy';
import { File, Paths } from 'expo-file-system';

const REPO = Constants.expoConfig?.extra?.updates?.repo;
const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

export const currentVersion = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '0.0.0';

// 1.10.0 > 1.9.2
function isNewer(candidate, current) {
  const a = candidate.split('.').map((n) => parseInt(n, 10) || 0);
  const b = current.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

// Returns { version, notes, apkUrl, sizeMb } when a newer version exists, else null.
export async function checkForUpdate() {
  if (!REPO) throw new Error('Updates are not set up in this version of Shelby.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res;
  try {
    res = await fetch(LATEST_RELEASE_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
  } catch {
    throw new Error('Could not check for updates. Check your internet connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) return null; // nothing published yet
  if (!res.ok) throw new Error('The update server is busy. Please try again later.');
  const release = await res.json();
  const version = String(release.tag_name ?? '').replace(/^v/i, '');
  const apk = (release.assets ?? []).find((a) => a.name.toLowerCase().endsWith('.apk'));
  if (!apk || !isNewer(version, currentVersion)) return null;
  return {
    version,
    notes: (release.body ?? '').trim(),
    apkUrl: apk.browser_download_url,
    sizeMb: Math.round(apk.size / 1048576),
  };
}

// Downloads the update and opens Android's installer. `onProgress` gets 0–1.
export async function downloadAndInstall(update, onProgress) {
  const file = new File(Paths.cache, `shelby-${update.version}.apk`);
  try {
    await File.downloadFileAsync(update.apkUrl, file, {
      idempotent: true,
      onProgress: ({ bytesWritten, totalBytes }) => {
        if (totalBytes > 0) onProgress?.(bytesWritten / totalBytes);
      },
    });
  } catch {
    throw new Error('The download stopped. Check your internet connection and try again.');
  }
  const contentUri = await getContentUriAsync(file.uri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    type: 'application/vnd.android.package-archive',
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
  });
}

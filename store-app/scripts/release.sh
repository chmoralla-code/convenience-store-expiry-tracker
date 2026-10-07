#!/usr/bin/env bash
# Builds a signed Shelby APK and (with --publish) sends it to every phone as an
# in-app update by creating a GitHub Release.
#
#   1. Raise "version" and "android.versionCode" in app.json
#   2. bash scripts/release.sh                              # build + check only
#   3. bash scripts/release.sh --publish "What changed"     # build + publish
#
# Builds from C:\sb because this project's folder path is too long for the
# Android native build on Windows.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="/c/sb"
REPO="chmoralla-code/convenience-store-expiry-tracker"
cd "$APP_DIR"

PUBLISH=false
NOTES=""
if [[ "${1:-}" == "--publish" ]]; then
  PUBLISH=true
  NOTES="${2:-Bug fixes and improvements.}"
fi

VERSION=$(node -p "require('./app.json').expo.version")
VERSION_CODE=$(node -p "require('./app.json').expo.android.versionCode")
echo "Building Shelby $VERSION (versionCode $VERSION_CODE)"

if [[ ! -f credentials/keystore.properties ]]; then
  echo "Missing credentials/keystore.properties — updates must be signed with Shelby's key." >&2
  exit 1
fi
if gh release view "v$VERSION" --repo "$REPO" >/dev/null 2>&1; then
  echo "Version $VERSION is already published. Raise the version in app.json first." >&2
  exit 1
fi

CI=1 npx expo prebuild --platform android --no-install --clean
powershell -NoProfile -Command \
  "robocopy '$(cygpath -w "$APP_DIR")' 'C:\\sb' /MIR /XD '$(cygpath -w "$APP_DIR")\\android\\app\\build' '$(cygpath -w "$APP_DIR")\\android\\app\\.cxx' '$(cygpath -w "$APP_DIR")\\android\\.gradle' '$(cygpath -w "$APP_DIR")\\android\\build' '$(cygpath -w "$APP_DIR")\\.expo' 'C:\\sb\\android\\app\\build' 'C:\\sb\\android\\app\\.cxx' 'C:\\sb\\android\\.gradle' 'C:\\sb\\android\\build' /NFL /NDL /NJH /NP | Out-Null; exit 0"
(cd "$BUILD_DIR/android" && ./gradlew assembleRelease --console=plain -q)

APK="$BUILD_DIR/android/app/build/outputs/apk/release/app-release.apk"
APKSIGNER=$(ls -d "$ANDROID_HOME"/build-tools/*/ | sort -V | tail -1)apksigner.bat
SIGNER=$("$APKSIGNER" verify --print-certs "$APK" | grep "certificate SHA-256" | head -1 | awk '{print $NF}')
EXPECTED=$(keytool -list -v -keystore credentials/shelby-release.keystore \
  -storepass "$(grep storePassword credentials/keystore.properties | cut -d= -f2-)" -alias shelby \
  | grep "SHA256:" | head -1 | awk '{print $2}' | tr -d ':' | tr 'A-F' 'a-f')
if [[ "$SIGNER" != "$EXPECTED" ]]; then
  echo "The APK is not signed with Shelby's release key. Phones would refuse the update." >&2
  exit 1
fi
echo "Signed with Shelby's release key ✓"

OUT="$APP_DIR/../Shelby-$VERSION.apk"
cp "$APK" "$OUT"
cp "$APK" "$APP_DIR/../Shelby.apk"
echo "APK: $OUT"

if $PUBLISH; then
  gh release create "v$VERSION" "$OUT" --repo "$REPO" --title "Shelby $VERSION" --notes "$NOTES"
  echo "Published. Phones will offer the update the next time Shelby opens."
else
  echo "Not published (run with --publish \"notes\" to send it to phones)."
fi

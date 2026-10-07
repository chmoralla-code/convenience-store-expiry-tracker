// Signs release builds with Shelby's own key (credentials/keystore.properties),
// so in-app updates install over older versions. Android only accepts an
// update signed with the same key, so this key must never change or be lost.
// Without the credentials folder, builds fall back to the debug key.
const fs = require('fs');
const path = require('path');
const { withAppBuildGradle } = require('expo/config-plugins');

const PROPERTIES = '../../credentials/keystore.properties'; // relative to android/app

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    const propertiesFile = path.join(cfg.modRequest.projectRoot, 'credentials', 'keystore.properties');
    let gradle = cfg.modResults.contents;
    if (!fs.existsSync(propertiesFile) || gradle.includes('shelbyRelease')) return cfg;

    gradle = gradle.replace(
      /signingConfigs\s*\{/,
      `signingConfigs {
        shelbyRelease {
            def props = new Properties()
            file("${PROPERTIES}").withInputStream { props.load(it) }
            storeFile file(props['storeFile'])
            storePassword props['storePassword']
            keyAlias props['keyAlias']
            keyPassword props['keyPassword']
        }`
    );
    gradle = gradle.replace(
      /(release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
      '$1signingConfig signingConfigs.shelbyRelease'
    );
    cfg.modResults.contents = gradle;
    return cfg;
  });
};

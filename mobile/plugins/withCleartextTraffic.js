/**
 * Expo config plugin — ensures android:usesCleartextTraffic="true"
 * is set in AndroidManifest.xml AND adds a network_security_config.xml
 * that allows cleartext (HTTP) traffic to all domains in debug/preview builds.
 *
 * Without this, Android 9+ blocks all cleartext HTTP traffic regardless
 * of what app.json says.
 */
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs   = require('fs');
const path = require('path');

// ── 1. Set usesCleartextTraffic on <application> ─────────────────────────────
const withCleartextManifest = (config) =>
  withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults;
    const app = manifest?.manifest?.application?.[0];
    if (app) {
      app.$['android:usesCleartextTraffic'] = 'true';
      // Point to our network security config
      app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    }
    return mod;
  });

// ── 2. Write res/xml/network_security_config.xml ─────────────────────────────
const withNetworkSecurityConfig = (config) =>
  withDangerousMod(config, [
    'android',
    async (mod) => {
      const xmlDir = path.join(
        mod.modRequest.platformProjectRoot,
        'app', 'src', 'main', 'res', 'xml'
      );
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(
        path.join(xmlDir, 'network_security_config.xml'),
        `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <!-- Allow cleartext HTTP for local dev/preview builds -->
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
</network-security-config>
`
      );
      return mod;
    },
  ]);

module.exports = (config) => {
  config = withCleartextManifest(config);
  config = withNetworkSecurityConfig(config);
  return config;
};

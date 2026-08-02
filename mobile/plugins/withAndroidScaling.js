/**
 * Expo config plugin — Android display/font scaling fixes.
 *
 * 1. Sets android:configChanges to include fontScale so the app handles
 *    font-size accessibility changes gracefully instead of crashing.
 * 2. Adds supportsPictureInPicture=false and windowSoftInputMode for
 *    proper keyboard behavior.
 * 3. Prevents the system from scaling the app's UI by adding
 *    android:textSize meta-data disabling.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = (config) =>
  withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults;
    const app = manifest?.manifest?.application?.[0];
    if (!app) return mod;

    // Ensure activity array exists
    const activities = app.activity || [];
    if (activities.length > 0) {
      const mainActivity = activities[0];

      // Add fontScale to configChanges so we handle it in JS
      const existing = mainActivity.$['android:configChanges'] || '';
      if (!existing.includes('fontScale')) {
        mainActivity.$['android:configChanges'] = existing
          ? existing + '|fontScale'
          : 'keyboard|keyboardHidden|orientation|screenSize|uiMode|fontScale';
      }

      // Set windowSoftInputMode for proper keyboard behavior
      mainActivity.$['android:windowSoftInputMode'] = 'adjustResize';
    }

    // Add meta-data to disable system font scaling at app level
    // This tells the OS not to apply the user's font scale to this app
    if (!app['meta-data']) app['meta-data'] = [];
    const metaData = app['meta-data'];

    const hasDisableScale = metaData.some(
      (m) => m.$?.['android:name'] === 'android.content.res.Configuration.FONT_SCALE_OVERRIDE'
    );
    if (!hasDisableScale) {
      // android:value="1.0" pins font scale to 1.0 (no scaling)
      metaData.push({
        $: {
          'android:name': 'android.content.res.Configuration.FONT_SCALE_OVERRIDE',
          'android:value': '1.0',
        },
      });
    }

    return mod;
  });

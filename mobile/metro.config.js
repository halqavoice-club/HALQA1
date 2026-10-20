// Metro configuration for HALQA Mobile
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// ── Workspace root access ─────────────────────────────────────────────────────
// The shared layout engine lives at <workspace-root>/src/lib/layout/.
// Metro's default root is the mobile/ directory, so we must explicitly
// add the workspace root as a watched folder so that relative imports
// like '../../../../../src/lib/layout/computeLayout' can be resolved.
const workspaceRoot = path.resolve(__dirname, '..');
config.watchFolders = [
  ...(config.watchFolders ?? []),
  workspaceRoot,
];

// Also extend the resolver to look for modules starting from workspace root
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Block expo-notifications side-effect files that crash in Expo Go
// because native modules (DevicePushToken) aren't available there.
// These files register background tasks at import time.
config.resolver.blockList = [
  // The .fx suffix = "side effect" file, auto-imported by expo-notifications/build/index.js
  /node_modules[/\\]expo-notifications[/\\]build[/\\]DevicePushTokenAutoRegistration\.fx\.js$/,
];

// Resolve expo-notifications/build/index.js to our safe shim that strips the .fx import
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Intercept the side-effect re-export inside expo-notifications index
  if (
    moduleName === './DevicePushTokenAutoRegistration.fx' &&
    context.originModulePath &&
    context.originModulePath.includes('expo-notifications')
  ) {
    // Redirect to an empty shim so the module resolves but does nothing
    return {
      filePath: path.resolve(__dirname, 'src/shims/empty.js'),
      type: 'sourceFile',
    };
  }
  // Default resolution for everything else
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

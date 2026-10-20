module.exports = function (api) {
  // Cache keyed on NODE_ENV so test and production configs are stored separately.
  // api.cache.using() is the only cache call — do NOT also call api.cache(true).
  api.cache.using(() => process.env.NODE_ENV);

  const isTest = process.env.NODE_ENV === 'test';

  return {
    presets: [
      [
        'babel-preset-expo',
        // In test env, tell babel-preset-expo not to load the reanimated plugin.
        // babel-preset-expo accepts { reanimated: false } to opt out.
        // Reanimated v4 requires react-native-worklets which is Metro-only
        // and crashes Node.js/JSDOM when required during Babel transform.
        ...(isTest ? [{ reanimated: false }] : []),
      ],
    ],
    plugins: [
      ['module-resolver', { root: ['./src'], alias: { '@': './src' } }],
      // react-native-reanimated/plugin must be LAST in the plugins array.
      // Omit it in Jest — same reason as above.
      ...(!isTest ? ['react-native-reanimated/plugin'] : []),
    ],
  };
};

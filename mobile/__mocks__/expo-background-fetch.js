// Jest stub for expo-background-fetch
// Prevents expo-modules-core native EventEmitter crash in Node.js.
const BackgroundFetchResult = { NoData: 1, NewData: 2, Failed: 3 };
const BackgroundFetchStatus  = { Denied: 1, Restricted: 2, Available: 3 };

module.exports = {
  BackgroundFetchResult,
  BackgroundFetchStatus,
  registerTaskAsync:   jest.fn(async () => {}),
  unregisterTaskAsync: jest.fn(async () => {}),
  getStatusAsync:      jest.fn(async () => BackgroundFetchStatus.Available),
};

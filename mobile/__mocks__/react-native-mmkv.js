// Jest stub for react-native-mmkv
// Provides an in-memory key-value store for tests.
const _store = {};

class MMKV {
  constructor() {}
  set(key, value) { _store[key] = value; }
  getString(key) { return _store[key] ?? undefined; }
  getNumber(key) { return _store[key] ?? undefined; }
  getBoolean(key) { return _store[key] ?? undefined; }
  delete(key) { delete _store[key]; }
  getAllKeys() { return Object.keys(_store); }
  clearAll() { Object.keys(_store).forEach(k => delete _store[k]); }
}

module.exports = { MMKV };

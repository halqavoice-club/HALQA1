// Jest stub for expo-secure-store
// Individual tests override these with jest.mock() as needed.
module.exports = {
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
};

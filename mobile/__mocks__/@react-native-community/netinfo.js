// Jest stub for @react-native-community/netinfo
const NetInfo = {
  fetch:              jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addEventListener:   jest.fn(() => () => {}),
  useNetInfo:         jest.fn(() => ({ isConnected: true, isInternetReachable: true })),
  configure:          jest.fn(),
};

module.exports = NetInfo;
module.exports.default = NetInfo;

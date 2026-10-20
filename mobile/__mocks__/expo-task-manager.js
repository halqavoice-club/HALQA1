// Jest stub for expo-task-manager
module.exports = {
  defineTask:          jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => false),
  getRegisteredTasksAsync: jest.fn(async () => []),
  unregisterAllTasksAsync: jest.fn(async () => {}),
};

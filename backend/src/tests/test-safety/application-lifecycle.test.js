'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const APP_PATH = path.join(__dirname, '../../app.js');
const BACKEND_PACKAGE_PATH = path.join(__dirname, '../../../package.json');

function genericModule() {
  const callable = () => callable;
  return new Proxy(callable, {
    get(target, property) {
      if (property === 'then') return undefined;
      return target[property] ?? callable;
    },
  });
}

describe('Phase 3B-2 Stage 3 application lifecycle isolation', () => {
  test('import is inert and explicit startup is single-flight with tracked shutdown', async () => {
    const order = [];
    const intervalHandles = [{ type: 'memory' }, { type: 'cleanup' }];
    const immediateHandle = { type: 'recovery' };
    const appSource = fs.readFileSync(APP_PATH, 'utf8');
    const relativeRequires = [...appSource.matchAll(/require\(['"](\.\/[^"]+?)['"]\)/g)]
      .map((match) => match[1]);

    for (const request of new Set(relativeRequires)) {
      const absolute = path.resolve(path.dirname(APP_PATH), request);
      jest.doMock(absolute, () => genericModule());
    }

    const prisma = genericModule();
    prisma.$disconnect = jest.fn(async () => { order.push('prisma:disconnect'); });
    jest.doMock(path.resolve(path.dirname(APP_PATH), './utils/prisma'), () => prisma);
    jest.doMock(path.resolve(path.dirname(APP_PATH), './utils/validateEnv'), () => ({
      validateEnv: jest.fn(),
    }));

    const tracing = {
      middleware: (req, res, next) => next(),
      initialize: jest.fn(async () => { order.push('tracing'); }),
    };
    const featureFlags = {
      defaultFlags: {},
      initialize: jest.fn(async () => { order.push('features'); }),
    };
    const leaderElection = {
      initialize: jest.fn(async () => { order.push('leader'); }),
      shutdown: jest.fn(async () => { order.push('leader:shutdown'); }),
    };
    const redis = {
      connectRedis: jest.fn(async () => {
        order.push('redis');
        return { pubClient: {}, subClient: {} };
      }),
      disconnectRedis: jest.fn(async () => { order.push('redis:disconnect'); }),
    };
    const queue = {
      startWorkers: jest.fn(() => { order.push('workers'); }),
      scheduleCleanup: jest.fn(async () => { order.push('cleanup:schedule'); }),
      rehydrateLiveClassAutoEndJobs: jest.fn(async () => { order.push('queue:rehydrate'); }),
      queueBulkNotifications: jest.fn(),
    };
    const scheduler = {
      initialize: jest.fn(async () => { order.push('scheduler'); }),
      scheduleCron: jest.fn(() => { order.push('cron'); }),
      shutdown: jest.fn(() => { order.push('scheduler:shutdown'); }),
    };
    const sms = { initialize: jest.fn(() => { order.push('sms'); }) };
    const health = {
      liveness: jest.fn(),
      readiness: jest.fn(),
      startup: jest.fn(),
      detailed: jest.fn(),
      markStartupComplete: jest.fn(() => { order.push('health'); }),
    };
    const cleanupStaleOnline = jest.fn();

    const mockRelative = (request, value) => {
      jest.doMock(path.resolve(path.dirname(APP_PATH), request), () => value);
    };
    mockRelative('./utils/tracing', tracing);
    mockRelative('./utils/featureFlags', featureFlags);
    mockRelative('./utils/leaderElection', leaderElection);
    mockRelative('./utils/redis', redis);
    mockRelative('./services/queue.service', queue);
    mockRelative('./utils/jobScheduler', scheduler);
    mockRelative('./utils/sms', sms);
    mockRelative('./utils/health', health);
    mockRelative('./controllers/room-member.controller', { cleanupStaleOnline });

    const io = {
      adapter: jest.fn(() => { order.push('adapter'); }),
      on: jest.fn(),
      use: jest.fn(),
      to: jest.fn(() => io),
      emit: jest.fn(),
    };
    jest.doMock('socket.io', () => ({ Server: jest.fn(() => io) }));
    jest.doMock('@socket.io/redis-adapter', () => ({ createAdapter: jest.fn(() => 'adapter') }));

    const listenSpy = jest.spyOn(http.Server.prototype, 'listen').mockImplementation(function (...args) {
      order.push('listen');
      const callback = args.find((arg) => typeof arg === 'function');
      if (callback) callback();
      return this;
    });
    const processOnSpy = jest.spyOn(process, 'on');
    const intervalSpy = jest.spyOn(global, 'setInterval')
      .mockImplementation(() => intervalHandles.shift());
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval').mockImplementation(() => {});
    const immediateSpy = jest.spyOn(global, 'setImmediate').mockImplementation(() => immediateHandle);
    const clearImmediateSpy = jest.spyOn(global, 'clearImmediate').mockImplementation(() => {});
    const previousRedisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = 'redis://unit.invalid';

    let app;
    try {
      app = require(APP_PATH);

      expect(listenSpy).not.toHaveBeenCalled();
      expect(redis.connectRedis).not.toHaveBeenCalled();
      expect(queue.startWorkers).not.toHaveBeenCalled();
      expect(scheduler.scheduleCron).not.toHaveBeenCalled();
      expect(intervalSpy).not.toHaveBeenCalled();
      expect(processOnSpy).not.toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(processOnSpy).not.toHaveBeenCalledWith('SIGINT', expect.any(Function));

      const firstStart = app.startServer();
      const secondStart = app.startServer();
      expect(secondStart).toBe(firstStart);
      await firstStart;

      expect(listenSpy).toHaveBeenCalledTimes(1);
      expect(redis.connectRedis).toHaveBeenCalledTimes(1);
      expect(queue.startWorkers).toHaveBeenCalledTimes(1);
      expect(scheduler.initialize).toHaveBeenCalledTimes(1);
      expect(scheduler.scheduleCron).toHaveBeenCalledTimes(3);
      expect(intervalSpy).toHaveBeenCalledTimes(2);
      expect(order.indexOf('redis')).toBeLessThan(order.indexOf('adapter'));
      expect(order.indexOf('adapter')).toBeLessThan(order.indexOf('workers'));
      expect(order.indexOf('workers')).toBeLessThan(order.indexOf('scheduler'));
      expect(order.indexOf('scheduler')).toBeLessThan(order.indexOf('listen'));

      await app.shutdown('TEST', { exitProcess: false });

      expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
      expect(clearImmediateSpy).toHaveBeenCalledWith(immediateHandle);
      expect(scheduler.shutdown).toHaveBeenCalledTimes(1);
      expect(leaderElection.shutdown).toHaveBeenCalledTimes(1);
      expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
      expect(redis.disconnectRedis).toHaveBeenCalledTimes(1);
    } finally {
      if (previousRedisUrl === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = previousRedisUrl;
    }
  });

  test('production commands execute app.js directly and startup remains main-gated', () => {
    const source = fs.readFileSync(APP_PATH, 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(BACKEND_PACKAGE_PATH, 'utf8'));

    expect(packageJson.scripts.start).toContain('src/app.js');
    expect(packageJson.scripts.dev).toContain('src/app.js');
    expect(source).toMatch(/if\s*\(require\.main\s*===\s*module\)/);
    expect(source).toMatch(/registerSignalHandlers\(\);\s*startServer\(\)/);
  });
});

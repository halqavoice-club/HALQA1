'use strict';
// Global Jest stub for @opentelemetry/instrumentation-redis
// Redirected via moduleNameMapper in package.json jest config.
module.exports = {
  RedisInstrumentation: function RedisInstrumentation() {
    return {};
  },
};

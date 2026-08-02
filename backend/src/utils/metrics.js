/**
 * Simple in-memory metrics tracker
 * Used for basic query counting and monitoring
 */

const metrics = {
  dbQueriesTotal: 0,
  dbSlowQueries: 0,
  requestsTotal: 0,
  requestsSuccess: 0,
  requestsClientErr: 0,
  requestsServerErr: 0,
  errorsTotal: 0,
  endpoints: {},
  activeUsers: new Set(),
  
  increment(metricName) {
    if (this.hasOwnProperty(metricName)) {
      this[metricName]++;
    }
  },
  
  get(metricName) {
    return this[metricName] || 0;
  },
  
  recordRequest() {
    this.increment('requestsTotal');
  },
  
  recordError() {
    this.increment('errorsTotal');
  },
  
  recordEndpoint(method, path, durationMs, status) {
    const key = `${method}:${path}`;
    if (!this.endpoints[key]) {
      this.endpoints[key] = { count: 0, totalDuration: 0, errors: 0 };
    }
    this.endpoints[key].count++;
    this.endpoints[key].totalDuration += durationMs;
    if (status >= 400) {
      this.endpoints[key].errors++;
    }
  },
  
  recordActiveUser(userId) {
    this.activeUsers.add(userId);
  },
  
  getActiveUserCount() {
    return this.activeUsers.size;
  },
  
  reset() {
    this.dbQueriesTotal = 0;
    this.dbSlowQueries = 0;
    this.requestsTotal = 0;
    this.requestsSuccess = 0;
    this.requestsClientErr = 0;
    this.requestsServerErr = 0;
    this.errorsTotal = 0;
    this.endpoints = {};
    this.activeUsers.clear();
  }
};

module.exports = metrics;

const redis = require('ioredis');
const client = new redis('redis://localhost:6379');
client.keys('voice:*').then(keys => {
  if (!keys.length) { console.log('No voice room cache keys found'); client.disconnect(); return; }
  return client.del(...keys).then(n => {
    console.log('Cleared ' + n + ' voice room cache keys');
    keys.forEach(k => console.log('  - ' + k));
    client.disconnect();
  });
}).catch(e => { console.error(e.message); client.disconnect(); });

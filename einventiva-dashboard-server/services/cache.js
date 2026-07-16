const cache = new Map();

// Expired entries are otherwise only removed on re-read; dynamic keys
// (e.g. postgres-detailed-*) would accumulate forever
const SWEEP_INTERVAL = 60000;
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.timestamp > entry.ttl) cache.delete(key);
  }
}, SWEEP_INTERVAL).unref();

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > entry.ttl) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data, ttl) {
  cache.set(key, { data, timestamp: Date.now(), ttl });
}

module.exports = { getCached, setCache };

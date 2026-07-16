const db = require('../db');

const DAY_MS = 24 * 60 * 60 * 1000;

// Least-squares fit over [{x, y}] where x is epoch ms.
// Returns slope per ms, intercept, and r2 (fit quality, 0-1).
function linearRegression(points) {
  const n = points.length;
  if (n < 2) return null;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;
  for (const { x, y } of points) {
    sumX += x; sumY += y; sumXY += x * y; sumXX += x * x; sumYY += y * y;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const ssTot = sumYY - (sumY * sumY) / n;
  let r2 = 1;
  if (ssTot > 0) {
    let ssRes = 0;
    for (const { x, y } of points) {
      const pred = slope * x + intercept;
      ssRes += (y - pred) * (y - pred);
    }
    r2 = Math.max(0, 1 - ssRes / ssTot);
  }
  return { slope, intercept, r2 };
}

function toPoints(rows, field) {
  return rows
    .filter(r => r[field] != null && r[field] > 0)
    .map(r => ({ x: new Date(r.timestamp).getTime(), y: r[field] }));
}

function spanMs(points) {
  return points.length < 2 ? 0 : points[points.length - 1].x - points[0].x;
}

// Disk-full ETA from the last 14 days of hourly data. Needs >= 24h of
// span; a slope under 0.05%/day is treated as stable (no ETA).
function projectDisk(rows) {
  const points = toPoints(rows, 'disk');
  const current = points.length ? points[points.length - 1].y : null;
  const base = { current, slopePerDay: null, etaDays: null, insufficient: true };
  if (points.length < 12 || spanMs(points) < DAY_MS) return base;

  const fit = linearRegression(points);
  if (!fit) return base;
  const slopePerDay = fit.slope * DAY_MS;
  const result = { current, slopePerDay: round(slopePerDay, 3), etaDays: null, insufficient: false };
  if (slopePerDay >= 0.05 && current != null && current < 100) {
    result.etaDays = round((100 - current) / slopePerDay, 1);
  }
  return result;
}

// Memory slope over the last 12 hours — a sustained positive slope with
// a decent fit is the classic leak signature.
function projectMemory(rows) {
  const points = toPoints(rows, 'memory');
  if (points.length < 12 || spanMs(points) < 6 * 60 * 60 * 1000) {
    return { slopePerHour: null, r2: null, trendingUp: false, insufficient: true };
  }
  const fit = linearRegression(points);
  if (!fit) return { slopePerHour: null, r2: null, trendingUp: false, insufficient: true };
  const slopePerHour = fit.slope * 60 * 60 * 1000;
  return {
    slopePerHour: round(slopePerHour, 3),
    r2: round(fit.r2, 2),
    trendingUp: slopePerHour > 0.3 && fit.r2 > 0.5,
    insufficient: false,
  };
}

function round(v, d) {
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

function computeProjections(serverKeys) {
  const now = Date.now();
  const since14d = new Date(now - 14 * DAY_MS).toISOString();
  const since12h = new Date(now - 12 * 60 * 60 * 1000).toISOString();
  const out = {};
  for (const key of serverKeys) {
    const hourly = db.getRollup(key, since14d, 3600);
    const recent = db.getMetricsBucketed(key, since12h, 30 * 60);
    out[key] = {
      disk: projectDisk(hourly),
      memory: projectMemory(recent),
    };
  }
  return out;
}

module.exports = { linearRegression, projectDisk, projectMemory, computeProjections };

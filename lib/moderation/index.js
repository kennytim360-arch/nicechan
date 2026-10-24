// Moderation basics: rate limiting, hashed visitor ids for reports, and admin authentication.
// Raw IP addresses are never stored. The hash uses a salt that changes every day.
const crypto = require("crypto");

// Sliding-window limiter, kept in memory. Restarting the server resets it, which is fine for a local install.
function createLimiter({ max, windowMs }) {
  const hits = new Map();
  return {
    // Returns true when the key may act now, and records the attempt.
    allow(key, now = Date.now()) {
      const list = (hits.get(key) || []).filter(t => now - t < windowMs);
      if (list.length >= max) {
        hits.set(key, list);
        return false;
      }
      list.push(now);
      hits.set(key, list);
      if (hits.size > 10_000) hits.delete(hits.keys().next().value);
      return true;
    },
  };
}

// Secret for hashing. ADMIN_TOKEN if set, otherwise random per process.
const SECRET = process.env.ADMIN_TOKEN || crypto.randomBytes(32).toString("hex");

function dailySalt(date = new Date()) {
  return crypto.createHash("sha256").update(`${date.toISOString().slice(0, 10)}:${SECRET}`).digest("hex");
}

function visitorHash(ip, date) {
  return crypto.createHash("sha256").update(`${dailySalt(date)}:${ip || "unknown"}`).digest("hex").slice(0, 24);
}

// Admin is off unless ADMIN_TOKEN is set. Comparison is constant-time.
function adminAllowed(provided, env = process.env) {
  const token = env.ADMIN_TOKEN || "";
  if (!token || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { createLimiter, visitorHash, adminAllowed };

// SQLite store for ingested items and digests. Uses Node's built-in node:sqlite (Node 22.5+), so there is no native dependency.
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  source TEXT NOT NULL,
  post_id TEXT NOT NULL,
  community TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  author TEXT,
  time INTEGER NOT NULL,
  title TEXT,
  text TEXT,
  url TEXT NOT NULL,
  score REAL,
  replies INTEGER,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (source, post_id)
);
CREATE INDEX IF NOT EXISTS items_time ON items (time);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  post_id TEXT NOT NULL,
  reason TEXT,
  ip_hash TEXT,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
);
CREATE TABLE IF NOT EXISTS hidden (
  source TEXT NOT NULL,
  post_id TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (source, post_id)
);
CREATE TABLE IF NOT EXISTS digests (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sources TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  first_time INTEGER NOT NULL,
  last_time INTEGER NOT NULL,
  status TEXT NOT NULL,
  rare TEXT,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

// Adds columns that older databases lack. SQLite has no "ADD COLUMN IF NOT EXISTS".
function migrate(db) {
  const cols = new Set(db.prepare("PRAGMA table_info(items)").all().map(c => c.name));
  if (!cols.has("external_url")) db.exec("ALTER TABLE items ADD COLUMN external_url TEXT");
  if (!cols.has("sticky")) db.exec("ALTER TABLE items ADD COLUMN sticky INTEGER NOT NULL DEFAULT 0");
}

function openStore(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  migrate(db);

  const upsert = db.prepare(`
    INSERT INTO items (source, post_id, community, thread_id, author, time, title, text, url, score, replies, seen_at, external_url, sticky)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (source, post_id) DO UPDATE SET
      score = excluded.score, replies = excluded.replies, seen_at = excluded.seen_at,
      external_url = excluded.external_url, sticky = excluded.sticky`);

  return {
    upsertItems(items, now = Math.floor(Date.now() / 1000)) {
      db.exec("BEGIN");
      try {
        for (const it of items) {
          upsert.run(
            it.source, it.postId, it.community, it.threadId, it.author ?? null, it.time,
            it.title ?? "", it.text ?? "", it.url, it.score ?? null, it.meta?.replies ?? null, now,
            it.meta?.externalUrl ?? null, it.meta?.sticky ? 1 : 0
          );
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return items.length;
    },

    // Items at or after `since` (unix seconds), newest first. Only root items are returned: threads, not replies.
    itemsSince(since) {
      return db
        .prepare(`SELECT * FROM items WHERE time >= ? AND post_id = thread_id AND sticky = 0 ORDER BY time DESC`)
        .all(since)
        .map(toItem);
    },

    // Threads posted in [from, to), newest first, for the "past" page.
    rootsBetween(from, to, limit = 200) {
      return db
        .prepare(`SELECT * FROM items WHERE time >= ? AND time < ? AND post_id = thread_id AND sticky = 0 ORDER BY time DESC LIMIT ?`)
        .all(from, to, limit)
        .map(toItem);
    },

    getDigest(id) {
      const r = db.prepare("SELECT * FROM digests WHERE id = ?").get(id);
      return r ? toDigest(r) : null;
    },

    saveDigest(d) {
      db.prepare(`
        INSERT INTO digests (id, label, sources, item_count, first_time, last_time, status, rare, payload, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          label = excluded.label, sources = excluded.sources, item_count = excluded.item_count,
          first_time = excluded.first_time, last_time = excluded.last_time, status = excluded.status,
          rare = excluded.rare, payload = excluded.payload, updated_at = excluded.updated_at`)
        .run(d.id, d.label, JSON.stringify(d.sources), d.itemCount, d.firstTime, d.lastTime, d.status, d.rare ?? null, JSON.stringify(d.payload), d.updatedAt);
    },

    listDigests(since = 0) {
      return db
        .prepare("SELECT * FROM digests WHERE last_time >= ? ORDER BY last_time DESC")
        .all(since)
        .map(toDigest);
    },

    // Removes stories that were not rebuilt in the run that stamped `before`.
    pruneDigests(before) {
      return db.prepare("DELETE FROM digests WHERE updated_at < ?").run(before).changes;
    },

    // Deletes whole threads (root and replies) whose title matches `re`. Used for excluded boards' threads already stored.
    purgeThreadsByTitle(source, re) {
      const roots = db.prepare("SELECT thread_id, title FROM items WHERE source = ? AND post_id = thread_id AND title <> ''").all(source);
      const del = db.prepare("DELETE FROM items WHERE source = ? AND thread_id = ?");
      let n = 0;
      for (const r of roots) if (re.test(r.title)) { n += del.run(source, r.thread_id).changes; }
      return n;
    },

    pruneItems(before) {
      return db.prepare("DELETE FROM items WHERE time < ?").run(before).changes;
    },

    // Cached posts (threads and their comments) for the given threads.
    postsForThreads(keys) {
      const q = db.prepare("SELECT * FROM items WHERE source = ? AND thread_id = ? ORDER BY time");
      const out = [];
      for (const k of keys) for (const r of q.all(k.source, String(k.threadId))) out.push(toItem(r));
      return out;
    },

    addReport({ source, postId, reason, ipHash, now }) {
      return db.prepare("INSERT INTO reports (source, post_id, reason, ip_hash, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(source, String(postId), reason ?? null, ipHash ?? null, now).lastInsertRowid;
    },

    listReports(status = "open") {
      return db.prepare(`
        SELECT r.id, r.source, r.post_id, r.reason, r.created_at, r.status,
               (SELECT COUNT(*) FROM reports x WHERE x.source = r.source AND x.post_id = r.post_id) AS count,
               (SELECT text FROM items i WHERE i.source = r.source AND i.post_id = r.post_id) AS text,
               (SELECT url FROM items i WHERE i.source = r.source AND i.post_id = r.post_id) AS url,
               (SELECT 1 FROM hidden h WHERE h.source = r.source AND h.post_id = r.post_id) AS hidden
        FROM reports r WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 200`).all(status);
    },

    resolveReport(id, status) {
      return db.prepare("UPDATE reports SET status = ? WHERE id = ?").run(status, id).changes;
    },

    hidePost(source, postId, reason, now) {
      db.prepare("INSERT INTO hidden (source, post_id, reason, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (source, post_id) DO NOTHING")
        .run(source, String(postId), reason ?? null, now);
    },

    unhidePost(source, postId) {
      db.prepare("DELETE FROM hidden WHERE source = ? AND post_id = ?").run(source, String(postId));
    },

    // Set of "source:postId" keys hidden by moderators.
    hiddenSet() {
      return new Set(db.prepare("SELECT source, post_id FROM hidden").all().map(r => `${r.source}:${r.post_id}`));
    },

    close() {
      db.close();
    },
  };
}

function toItem(r) {
  return {
    source: r.source, postId: r.post_id, community: r.community, threadId: r.thread_id,
    author: r.author, time: r.time, title: r.title, text: r.text, url: r.url,
    score: r.score, meta: { replies: r.replies, externalUrl: r.external_url ?? null, sticky: !!r.sticky },
  };
}

function toDigest(r) {
  return {
    id: r.id, label: r.label, sources: JSON.parse(r.sources), itemCount: r.item_count,
    firstTime: r.first_time, lastTime: r.last_time, status: r.status, rare: r.rare ?? null,
    payload: JSON.parse(r.payload), updatedAt: r.updated_at,
  };
}

module.exports = { openStore };

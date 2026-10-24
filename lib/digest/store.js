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

function openStore(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);

  const upsert = db.prepare(`
    INSERT INTO items (source, post_id, community, thread_id, author, time, title, text, url, score, replies, seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (source, post_id) DO UPDATE SET
      score = excluded.score, replies = excluded.replies, seen_at = excluded.seen_at`);

  return {
    upsertItems(items, now = Math.floor(Date.now() / 1000)) {
      db.exec("BEGIN");
      try {
        for (const it of items) {
          upsert.run(
            it.source, it.postId, it.community, it.threadId, it.author ?? null, it.time,
            it.title ?? "", it.text ?? "", it.url, it.score ?? null, it.meta?.replies ?? null, now
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
        .prepare(`SELECT * FROM items WHERE time >= ? AND post_id = thread_id ORDER BY time DESC`)
        .all(since)
        .map(r => ({
          source: r.source, postId: r.post_id, community: r.community, threadId: r.thread_id,
          author: r.author, time: r.time, title: r.title, text: r.text, url: r.url,
          score: r.score, meta: { replies: r.replies },
        }));
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

    pruneItems(before) {
      return db.prepare("DELETE FROM items WHERE time < ?").run(before).changes;
    },

    close() {
      db.close();
    },
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

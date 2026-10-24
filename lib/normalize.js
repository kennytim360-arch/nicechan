// The one item shape every source adapter returns.
//   source     adapter id, e.g. "hn", "4chan", "lemmy"
//   community  community id within the source (board, subreddit-style name, ...)
//   threadId   id of the thread or story this item belongs to (string)
//   postId     id of this post, comment or story (string)
//   parentId   id of the post this replies to; null for the root of a thread
//   author     display name
//   time       unix seconds
//   title      "" when the source has no title
//   text       plain text body
//   url        link back to the original on the source site (required: attribution)
//   score      number or null
//   thumb      image URL or null
//   meta       source-specific extras (replies, images, full image URL, ...)

function item(f) {
  if (!f.source) throw new Error("item: source is required");
  if (!f.url) throw new Error(`item ${f.source}/${f.postId}: url is required for attribution`);
  return {
    source: f.source,
    community: String(f.community),
    threadId: String(f.threadId),
    postId: String(f.postId),
    parentId: f.parentId == null ? null : String(f.parentId),
    author: f.author || "Anonymous",
    time: Math.floor(Number(f.time)) || 0,
    title: f.title || "",
    text: f.text || "",
    url: f.url,
    score: typeof f.score === "number" ? f.score : null,
    thumb: f.thumb || null,
    meta: f.meta || {},
  };
}

// Newest first, with duplicates (same source and postId) removed.
function mergeLatest(items) {
  const seen = new Set();
  return items
    .filter(it => {
      const k = `${it.source}:${it.postId}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b.time - a.time);
}

module.exports = { item, mergeLatest };

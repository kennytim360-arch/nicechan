# Nice Chan: build instructions

You are extending an existing small project called Nice Chan, in the repo root.

## What Nice Chan is
A local website that wraps public forum APIs, blurs rude words and images by default (Safe mode), and uses an LLM to digest how different online communities discuss the same world news story. People can then read the merged view and add their own comments. The audience is people who want to understand the world better by seeing how different communities frame the same event, and where they agree and disagree.

## Existing code (read it first)
- `server.js`: dependency-free Node http server. Proxies 4chan's read-only API (a.4cdn.org) with a 60s cache and a board whitelist. Routes: `/api/boards`, `/api/:board/catalog`, `/api/:board/thread/:id`. Serves `./public`.
- `public/index.html`: single-page app (hash routing) showing boards, a catalog and threads.
- `public/filter.js`: client-side blur filter. Rude words become click-to-reveal blurred spans. Thumbnails are blurred until clicked.
- `public/style.css`: classic imageboard look.

## Rules (important)
- Keep it simple. Node 20+, plain JavaScript, minimal dependencies. SQLite via `better-sqlite3` for storage is fine. Vanilla HTML/JS frontend, no framework, no build step.
- Only use official public APIs or RSS. No scraping of sites that lack one. No Reddit, X/Twitter, Facebook or anything behind a login.
- Be polite: cache everything, respect rate limits (4chan: max 1 request per second, send `If-Modified-Since` where supported), and set a clear User-Agent.
- Always show the source name and a link back to the original post. Attribution is required.
- Do NOT hard-code slurs in the repo. Use the `obscenity` npm package (or load a word list from a file the user supplies) for the blur filter, and keep the small starter list only for mild profanity. Keep the existing handling of obfuscations such as f*ck.
- Safe mode must apply on the server too: when `safe=1`, rude words in API responses are wrapped in a marker, so the client never receives them in clear text.
- No pornography, gore or NSFW boards. Keep the board whitelist for 4chan. For Lemmy, only use the configured communities.
- Secrets come from environment variables (`ANTHROPIC_API_KEY`, optional `OPENAI_API_KEY`, `ADMIN_TOKEN`, optional Turnstile keys). Never commit them. Add `.env.example` and `.gitignore`.
- Show excerpts and links for third-party comments, never full copies.
- Always label what is an AI summary and what is a real comment.

## Build in this order, committing after each milestone

### Milestone 1: source adapters
Create `lib/sources/` with one module per source. Each exports `listCommunities()`, `fetchRecent(community, limit)` and `fetchThread(id)`, and returns items in one normalised shape:
`{ source, community, threadId, postId, parentId, author, time, title, text, url, score, thumb }`

Sources, in priority order:
1. Hacker News: the official Firebase API (`hacker-news.firebaseio.com/v0`) for top and new stories and comment trees, and the Algolia search API (`hn.algolia.com/api/v1/search` and `/items/:id`) for searching by topic.
2. 4chan: move the existing code into an adapter.
3. Lemmy: configurable instances and communities in `config.json`, starting with programming.dev and lemmy.world. Use each instance's public `/api/v3` endpoints.
4. Manifold Markets: public API for markets and comments.
5. LessWrong and the EA Forum: the public GraphQL API.

Then, if time allows: Lobsters (JSON endpoints), Schneier on Security and Hackaday (RSS).
Add a test for each adapter that runs against a recorded fixture, not the live site.

### Milestone 2: unified browsing UI
- Home page: one sidebar listing every source and community, with a unified Latest feed.
- Thread view works for every source, with the same blur filter, Safe mode toggle and attribution link.
- Keep the existing imageboard look, but make it responsive.

### Milestone 3: the digest pipeline (the core feature)
Create `lib/digest/`:
1. Ingest: every N minutes, pull recent items from every source into SQLite, de-duplicated by source+postId.
2. Story grouping: embed each thread (title plus first posts) and cluster threads that are about the same news event or topic across sources. Use a hosted embeddings API or a local model. After clustering, ask the LLM to label each cluster and merge near-duplicate clusters (repeatedly merge the two most overlapping topics until a target count is reached).
3. Per-community framing: for each cluster and each community, call Claude (model from env, default `claude-sonnet-5-5`) with structured JSON output. For each community, extract: the main claims, the tone, who or what is blamed or credited, and 2 to 4 representative quotes. Every quote must include the postId it came from. Reject and retry any output whose quotes are not found verbatim in the source text.
4. Agreement and divergence: given the per-community summaries, generate 3 candidate "common ground" statements, have the model judge from each community's perspective how well each statement represents them (1 to 5), and pick the one with the best worst-case score. Also list the 3 sharpest disagreements between communities. Say in the UI that this is an AI summary and flag when a minority community's view carried the result (consensus tools like this tend to overweight minority views).
5. Cache digests in SQLite and only regenerate when a cluster gets meaningful new posts.

Before sending any text to the model, remove or mask slurs and graphic content using the same filter. Do not send images.

### Milestone 4: digest UI
- `/digest` page: list of today's stories. Each opens a view with: a one-paragraph neutral summary, a side-by-side column for each community's framing, a "common ground" box, a "where they split" list, and links to the original threads.
- Every quote links to its source post.
- A visible disclaimer: AI-generated, check the sources.

### Milestone 5: Story rooms (merged discussion + native comments)
For any digest cluster that has threads from 2 or more sources, create a "story room" at `/story/:id`.

Page layout, top to bottom:
1. Neutral summary (from the digest) and the date.
2. "Take first" panel: 2 to 3 key claims from the cluster, each with Agree / Disagree / Unsure buttons. Store the choices only in the browser (localStorage). After the visitor answers, reveal the rest of the page and show which source community their answers are closest to, using the per-community stance data from the digest. Allow skipping.
3. One column per source community: its framing summary plus the top 5 comments (short excerpts only), each with the author name, time and a link to the original post.
4. "Common ground" and "Where they split" boxes from the digest.
5. A native Nice Chan thread: anonymous, text-only comments (no image uploads), with:
   - a "quote" button on any source comment that inserts a short quoted excerpt plus the source link into the reply box
   - an optional "responding to: [community]" tag on each reply
   - a visible notice: "Comments are by Nice Chan visitors. Summaries are AI-generated; check the sources."

#### Moderation and spam stack for native comments
Build this as a small module (`lib/moderation/`) so each layer can be swapped:
1. Word filter: the `obscenity` package. Blur on read (marker wrapping), and hard-reject posts that contain a configurable block-list.
2. Classifier: call OpenAI's moderation endpoint (`omni-moderation-latest`, free to use) on every new comment before saving. Reject or hold for review anything flagged under hate, harassment, threats, illicit/violent, self-harm or sexual categories. Make the provider pluggable, and fall back to a Claude-based classifier (small structured-output call) if `OPENAI_API_KEY` is not set. Do NOT use Google's Perspective API: it is being shut down at the end of 2026.
3. Bot protection: Cloudflare Turnstile on the comment form, enabled only when the Turnstile keys are present.
4. Rate limiting: per hashed IP (for example 5 posts per 10 minutes), max length 2000 characters, simple duplicate-text detection.
5. Reports and admin: a Report button that stores reports in SQLite, and `/admin` (protected by an `ADMIN_TOKEN` env var) to review reports, restore held posts, and delete posts.
6. Privacy: store native comments in SQLite (table: story_id, parent_id, body, tag, created_at, ip_hash with a daily-rotating salt, status). Never store raw IPs.

Add tests for the filter, the moderation module (with a mocked classifier), the rate limiter and the quote insertion.

## Done means
- `npm install && npm start` runs everything on http://localhost:3000 with no extra setup beyond `ANTHROPIC_API_KEY`.
- `npm test` passes.
- `README.md` explains setup, how to add a source or Lemmy community, the rate limits, and the safety design.
- `NOTES.md` lists each source's terms-of-use link, the moderation duties that come with hosting user comments, and a reminder to check the legal rules (for example the EU Digital Services Act and the UK Online Safety Act) for wherever the site is hosted, before making it public.

Ask before adding any new dependency that is heavier than a small utility library.

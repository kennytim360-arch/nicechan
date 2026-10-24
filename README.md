# Nice Chan

A local website that reads public forum discussions side by side: Hacker News, 4chan, Lemmy, Manifold Markets, LessWrong and the EA Forum. Rude words and images are blurred by default (Safe mode). Every thread links back to the original.

Status: sources and browsing are done (Milestones 1 and 2). The LLM digest, digest pages, story rooms and moderation are not built yet. See [Roadmap](#roadmap).

## Setup

Requires Node 20 or newer. There are no runtime dependencies.

```sh
npm install   # nothing to install yet, but safe to run
npm start     # http://localhost:3000
npm test      # runs the tests against recorded fixtures, no network needed
```

Set `PORT` to change the port. Copy `.env.example` to `.env` for keys you will need later. `.env` is git-ignored. Never commit keys.

## Using it

Layout and copy follow the approved mockups in `design/` (see `AGENTS.md`).

- **Home** (`#/`) lists the newest threads from every source in one table. Each row shows the source, the domain, points, the author and the age.
- **Source filter:** the bracket list at the top (`[all / HN / 4chan / ...]`) shows one source.
- **Sources** and **About** pages are linked from the black bar.
- **Thread** pages show every comment in time order, with `>>` gutters and nested replies. Each post links to its original.
- **Safe mode** (on by default) is applied by the server. Rude words show as a button; press it to turn Safe mode off and read the word. Thumbnails are blurred until clicked.
- **Search** (top right) filters the current table.

Not built yet: AI rundowns and digest pages (Milestones 3 and 4), native "Post a Take" comments and story rooms (Milestone 5), and view counts, which no source API provides, so the Views column shows a dash.

## Adding a source or community

Sources are configured in `config.json`:

```json
"lemmy": {
  "enabled": true,
  "instances": [
    { "base": "https://lemmy.world", "communities": ["technology", "news"] }
  ]
}
```

- **Lemmy:** add a community under its instance. Only listed communities are reachable.
- **Hacker News, Manifold, LessWrong, EA Forum:** add the community id to `communities`. The valid ids are the ones the adapter knows: `top`/`new` for HN, `markets` for Manifold, `new`/`top` for the forums.
- **4chan:** add the board to `boards`. Boards not in the list return 404.
- **Latest:** each source can set `latest` to the communities that feed the Latest page. By default every community is included, except 4chan, which is included only for the boards you list there.

To add a new source type, write a module in `lib/sources/` that exports `create(cfg)`. It must return `meta`, `listCommunities()`, `fetchRecent(community, limit)` and `fetchThread(community, id)`, and every item must match the shape in `lib/normalize.js`. Then register it in `lib/sources/index.js`, add a recorded fixture (see below), and add tests.

## Rate limits and politeness

- Each host gets one request slot at a time, spaced by a minimum gap (`lib/http.js`). 4chan is spaced at 1 request per second. Other hosts are spaced at 100 to 300 ms.
- Responses are cached in memory for 30 seconds to 1 hour depending on the endpoint. Repeated page loads do not hit the APIs.
- 4chan requests use `If-Modified-Since` and ETags for conditional requests.
- A 429 or 503 response is retried once after 3 seconds. Requests time out after 10 seconds.
- Every request sends a `NiceChan/0.3` User-Agent.
- "Latest" is cached for 2 minutes (`config.json`).

## Safety design

- **Safe mode runs on the server.** When `safe` is not `0`, each rude word in a title, text or author is replaced with a masked token (`f***`) before the response is sent. The browser never receives the original word while Safe mode is on. See `lib/filter.js`.
- **Obfuscation is handled**, for example `sh1t`, `f u c k`, `fuuuck`, `f*ck`.
- **The word list is a starter list** in `lib/filter.js`. For a public launch, load a maintained list from a file or the `obscenity` package. Do not hard-code slurs into the repo.
- **Excerpts only.** Third-party text is cut to 1200 characters on the server. The cut never splits a masked word. Each post links to the original.
- **Adult content is excluded.** The 4chan board list does not include adult-only boards. Lemmy posts marked NSFW are skipped.
- **Thumbnails are blurred** in Safe mode until clicked.
- **Attribution.** Every item carries its source and an original URL, and the UI shows both.

## Tests and fixtures

Tests never call the live sites. Each adapter has a recorded set of responses in `test/fixtures/`, and the tests replay them.

- `npm test` runs the adapter, filter, text and merge tests.
- `npm run record` re-records the fixtures from the live APIs. Use it only when an API changes shape, then review the diff before committing.

## Project layout

```
server.js              HTTP server: /api routes and static files
config.json            enabled sources, communities and boards
lib/http.js            polite HTTP client: spacing, caching, conditional requests
lib/normalize.js       the shared item shape
lib/text.js            HTML and Markdown to plain text, excerpts
lib/filter.js          server-side Safe mode masking
lib/latest.js          merged "Latest" feed
lib/sources/           one adapter per source
public/                the browser UI (vanilla HTML, CSS and JS)
scripts/record-fixtures.js
test/                  tests and recorded fixtures
```

## Roadmap

- **Milestone 3, digest pipeline.** Needs decisions on an embeddings provider, the Anthropic key, and whether to add the `obscenity` package.
- **Milestone 4, digest pages.**
- **Milestone 5, story rooms and native comments.** Needs decisions on moderation services (OpenAI moderation or a Claude fallback, Turnstile keys, and the `ADMIN_TOKEN`).
- Lobsters, Schneier on Security and Hackaday (RSS), if time allows.

See `NOTES.md` for terms of use and the rules to check before making the site public.

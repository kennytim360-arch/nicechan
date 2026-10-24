# Notes: terms, moderation duties and legal checks

Read this before making the site public. The links were checked against what the sites published when the code was written. Re-check them before launch, because terms change.

## Source terms

| Source | Access used | Terms and rules | Status |
|---|---|---|---|
| Hacker News | Official Firebase API and Algolia HN Search | HN API docs: https://github.com/HackerNews/API . Legal: https://www.ycombinator.com/legal/ | Confirm that the Algolia search endpoint's terms allow this use. |
| 4chan | Public read-only JSON API (`a.4cdn.org`) | https://www.4chan.org/rules . API: https://github.com/4chan/4chan-API | Check whether 4chan allows redistributing excerpts. Keep the 1 request per second limit. |
| Lemmy | Each instance's public `/api/v3` | https://join-lemmy.org/docs/ . Each instance has its own terms, so check every instance in `config.json`. | Instance terms differ. Only configured communities are used. |
| Manifold Markets | Public v0 API | https://manifold.markets/terms . API: https://docs.manifold.markets/api | Check the API terms for rate limits and attribution. |
| LessWrong | Public GraphQL API | https://www.lesswrong.com | The terms page URL was not verified. Find it and confirm before launch. |
| EA Forum | Public GraphQL API | https://forum.effectivealtruism.org | The terms page URL was not verified. Find it and confirm before launch. |

General rule: excerpts with links back to the original, never full copies. Keep attribution visible.

## Content in the starter word list

`lib/filter.js` contains a starter list written by the project owner. Review it before launch:

- `retard` is a slur, not just profanity. Remove it, or move the list to a maintained file.
- A maintained list (for example the LDNOOBW lists or the `obscenity` package) should replace the starter list.

## Moderation duties (once user comments exist, Milestone 5)

Hosting user comments creates duties that the current code does not yet cover:

- A reporting path for every comment, and a review queue.
- A way to remove content quickly, and a record of what was removed and why.
- A clear, visible rule set and a contact address.
- Rate limiting and spam defences (planned in Milestone 5).
- Keeping IP addresses out of storage. The plan is salted, daily-rotating hashes.

## Legal checks before making the site public

Check the rules that apply to wherever the site is hosted. In particular:

- **EU Digital Services Act:** notice-and-action for illegal content, a statement of reasons for moderation decisions, and transparency reporting if the service is large enough.
- **UK Online Safety Act:** illegal-content duties, and child-safety duties if children could reach the service. Check whether the service is in scope.
- **Copyright:** excerpts and images from third parties. Thumbnails are blurred by default, but check the rules for showing them at all.
- **Data protection (GDPR and similar):** what personal data is stored (none, by design, for IP addresses) and any cookies or local storage (the theme and Safe mode settings use browser storage only).
- **AI disclosure:** when digests (Milestone 3) are added, label them as AI-generated and separate them from real comments everywhere they appear.

This file is not legal advice. Get a lawyer's review before launch if the site will be public.

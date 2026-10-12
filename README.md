# GD Forum Tools

A userscript for the **World of Warcraft General Discussion forums** that adds an ignore-list manager, per-author profile details, a weekly "who is everywhere" leaderboard, and a private 1-5 star rating system for post content. It runs entirely in your browser and keeps everything in your own local storage.

> **Not affiliated with Blizzard Entertainment.** This is a community-made reading aid. It only reads pages and profile data the forum already serves to you. It never posts, votes, flags, or automates anything on your behalf.

---

## Table of contents

- [What it does](#what-it-does)
- [Install with Tampermonkey](#install-with-tampermonkey)
- [First run](#first-run)
- [Using it](#using-it)
- [Ratings are opinion - and flags are for rule-breaking](#ratings-are-opinion---and-flags-are-for-rule-breaking)
- [Privacy and your data](#privacy-and-your-data)
- [Technical reference](#technical-reference)
  - [Where your data lives](#where-your-data-lives)
  - [Data shapes](#data-shapes)
  - [Console cookbook](#console-cookbook)
  - [How it works](#how-it-works)
  - [Tunable constants](#tunable-constants)
  - [Backup file format](#backup-file-format)
- [Troubleshooting](#troubleshooting)
- [Version notes](#version-notes)
- [License and disclaimer](#license-and-disclaimer)

---

## What it does

**On the General Discussion list**

- **Ignore list** - threads started by people on your list collapse into a themed "Have a Nice Day!" banner with an **Unignore to View** button.
- **Blizzard sync** - your forum's own ignore list is merged in automatically when you save your forum ID.

**On topic pages (`/wow/t/...`)**

- **Profile details under every author** - last seen, last post, read time and trust level, pulled from the author's public profile data. Private profiles are flagged in red with a lock.
- **Private-profile log** - every private profile you run into is logged (first/last seen, topics, sightings) so you can spot who keeps turning up.
- **Rate post dropdown** - a 1-5 star dropdown under each author. Your running average for that person appears next to it as a colored star.
- **Unique-post counting** - each post is counted once per week, no matter how often it re-renders or you revisit the topic.

**The windows**

| Button | What it opens |
| --- | --- |
| **Save / Run** | Saves the ignore list and re-runs the page logic immediately. |
| **Weekly LB** | Weekly Forum Wrap-Up: your account stats, **Top 10 Most Seen Users**, **Top 5 Rated Users**, and the top shared topics. |
| **Private Log** | A readable report of every private profile logged. |
| **Manage Data** | Backup, restore, export (leaderboard `.json`, private log `.csv`) and selective wipe. |
| **Low Rated** | Everyone you have rated below 2.8 (even after one vote) with a one-click **Ignore / Unignore** button. |
| **?** | A legend explaining every icon and color. |

The windows are draggable by their title area (the legend follows the main window). The main window can be minimized to a small pill and remembers that state.

**Leaderboard details**

- Columns: `# | Avatar | Forum ID | Name | Rating | Posts | Topics`.
- The **Forum ID** is a link to that user's raw profile JSON (`/en/wow/u/{user}.json`), opened in a new tab. A lock marks private profiles.
- **Top 5 Rated** needs at least **3 ratings** per user. **Low Rated** lists anyone averaging **below 2.8**, even with one vote.

**Star colors** (based on your average, rounded to one decimal)

| Color | Average |
| --- | --- |
| Red | 1.9 and below |
| Yellow | 2.0 to 3.5 |
| Green | 3.6 and up |

---

## Install with Tampermonkey

1. **Install a userscript manager.** [Tampermonkey](https://www.tampermonkey.net/) is available for Chrome, Edge, Firefox, Safari and Opera from your browser's extension store. (Violentmonkey should also work since the script uses `@grant none`; it has not been tested.)
   - Recent versions of Chrome may require you to enable **Developer mode** or the **Allow User Scripts** switch for Tampermonkey on the extensions page before userscripts will run. Tampermonkey shows a notice if this is needed.
2. **Add the script** - either way works:
   - **From GitHub:** open the raw `GD_Forum_Tools.user.js` file in this repository. Tampermonkey detects the `.user.js` address and offers an **Install** button.
   - **Manually:** in the Tampermonkey menu choose **Create a new script**, delete the template, paste the full contents of `GD_Forum_Tools.user.js`, and save with `Ctrl+S` (`Cmd+S` on macOS).
3. **Open the forum.** Visit `https://us.forums.blizzard.com/en/wow/c/community/general-discussion`. The **GD FORUM TOOLS** window appears in the top right.

**Updating:** install the new version over the old one. Your data is untouched because it lives in the site's local storage, not in the script. If you host the script yourself, add these two lines to the metadata block so Tampermonkey can check for updates (bump `@version` with each release):

```js
// @updateURL    https://raw.githubusercontent.com/YOUR-USER/YOUR-REPO/main/GD_Forum_Tools.user.js
// @downloadURL  https://raw.githubusercontent.com/YOUR-USER/YOUR-REPO/main/GD_Forum_Tools.user.js
```

**Other regions / locales:** the script matches `https://us.forums.blizzard.com/en/wow/*` and builds profile requests with `/en/wow/u/...`. For a different host or language, add an `@match` line and adjust those paths.

---

## First run

1. Enter your **Blizzard forum ID** in the window (the `name-1234567` string in your own profile URL, for example `panthra-2938857`) and press **Save User ID**.
2. The script reads your profile data once and merges your existing Blizzard-side ignore list into the box.
3. Browse. Nothing else needs configuring - the script reacts to page changes on its own, so there is no need to refresh or re-click anything.

Your forum ID is used for four things only: syncing your ignore list, reading your own account stats (read time and trust level), skipping the rating dropdown on your own posts, and building the link to your Blizzard ignore settings.

---

## Using it

### Ignoring and un-ignoring

- Add names (forum IDs, one per line or comma separated) to the box and press **Save / Run**.
- On the topic list, a hidden thread's banner has **Unignore to View**.
- **If the person is also on your Blizzard ignore list**, unignoring locally would be undone the next time the page loads (the Blizzard list is re-synced every load). The banner and the Low Rated window therefore show a note with a link to your Blizzard ignore settings: remove them there first, then click Unignore again.

### Rating posts

Use the **Rate post...** dropdown under an author:

| Score | Meaning |
| --- | --- |
| 1 | Poor |
| 2 | Weak |
| 3 | Okay |
| 4 | Good |
| 5 | Great |

Choose **Clear rating** to remove one. Ratings are stored per post, so changing your mind simply overwrites the old score. Your own posts get no dropdown. Ratings are **all-time** (they are not reset by the weekly leaderboard).

### The leaderboard

The **Top 10 Most Seen Users** is *this week* (it resets each Sunday). The rating column and **Top 5 Rated** are *all-time*. Names and avatars come from the post you saw, or from the profile data if you have not seen that user this week.

### Manage Data

- **Backup All Data** - saves one `.json` file with everything.
- **Restore From Backup...** - shows a preview of exactly what will be overwritten before it touches anything. Invalid entries are skipped with a reason; a leaderboard from a previous week is skipped because only the current week is kept.
- **Leaderboard (.json)** and **Private Log (.csv)** - exports for your own analysis.
- **Wipe data** - tick what you want gone (ignore list, private log, ratings, leaderboard, forum ID, or **Everything**). The confirmation lists exactly what will be deleted.

---

## Ratings are opinion - and flags are for rule-breaking

Please read this part before you start rating people.

- **A rating is your personal opinion of a post's content.** A low average means "I did not enjoy this person's posts", not "this person is a bad actor". It is not a reputation score, it is never shared, and it should not be presented as fact about anyone.
- **Rule-breaking belongs with the moderators.** If a post breaks the forum rules or the Terms of Service - harassment, hate speech, spam, scams, threats, and so on - **use the post's flag button** so the moderation team can review it. The star average and the Low Rated list do not replace that and are not a way to report anyone.
- **Be kind.** Do not use this tool to harass, dox, or pile on. The profile details it shows are information the forum already makes available; the point is to make reading easier, not to build a case against someone.
- **Check the forum's rules yourself.** You are responsible for using the script in line with the forum's terms.

---

## Privacy and your data

- Everything is stored in your browser's local storage for the forum site. **Nothing is sent to any server run by this project.** There is no account, tracking or analytics.
- The only network requests are to the forum itself: the public profile data for authors you are looking at (`/en/wow/u/{user}.json`) and your own profile for syncing. Avatar images load from the same image hosts the forum page already uses.
- Requests are capped at **4 at a time** and cached, so a busy topic does not hammer the server. A failed lookup is retried after 30 seconds, not in a loop.
- Clearing your browser's site data wipes everything. **Make a backup** from **Manage Data** first.
- Data is per browser profile. To move it to another browser, make a backup and restore it there.

---

## Technical reference

### Where your data lives

The script uses `@grant none`, so it runs in the page's own context and stores data in the forum site's **`localStorage`**. Open the browser console on any page of the forum to read it.

| Key | Type | Contents |
| --- | --- | --- |
| `wow_app_user_id` | string | Your forum ID, for example `panthra-2938857`. |
| `wow_ignore_list` | JSON array | Forum IDs you are ignoring (your own entries plus the Blizzard-synced ones). |
| `wow_private_profiles` | JSON object | The private-profile log, keyed by forum ID. |
| `wow_weekly_leaderboard` | JSON object | This week's counters, including the list of already-counted post IDs. |
| `wow_post_ratings` | JSON object | Your ratings, keyed by post ID. |
| `wow_fools_minimized` | `'0'` or `'1'` | Whether the main window is minimized. |

The script keeps no other persistent state. Its only page-level variable is `window.__foolsLoaded`, a flag that stops it from running twice.

### Data shapes

```jsonc
// wow_ignore_list
["Subdriver-1553358", "vile-2539871"]

// wow_private_profiles  (sightings capped at 50 per user)
{
  "Thalia-2277436": {
    "firstSeen": "2026-10-10T08:45:01.000Z",
    "lastSeen":  "2026-10-11T20:12:44.000Z",
    "sightings": [
      { "timestamp": "...", "topicId": "slug", "topicUrl": "https://...", "topicTitle": "..." }
    ],
    "altNames": [],
    "topicSightings": { "topic-slug": "2026-10-11T20:12:44.000Z" }   // last sighting per topic
  }
}

// wow_weekly_leaderboard  (replaced when the local Sunday changes)
{
  "weekStart": "2026-10-11",                      // local-time Sunday, YYYY-MM-DD
  "users":  { "Akston-837933": { "count": 26, "topics": { "topic-slug": 12 },
                                 "name": "Akston", "avatar": "https://..." } },
  "topics": { "topic-slug": { "title": "...", "url": "...", "count": 57,
                              "users": { "Akston-837933": 12 } } },
  "appUserInitial": { "readTime": 1234, "trustLevel": 2 },   // your first check this week
  "appUserCurrent": { "readTime": 5678, "trustLevel": 2 },
  "topicsEngaged": ["topic-slug"],
  "seenPosts": { "30328672": 1 }                  // post IDs already counted this week
}

// wow_post_ratings  (all-time)
{ "30328672": { "u": "Chief-20738", "r": 4, "t": "topic-slug", "d": "2026-10-11" } }
//                  u = author, r = score 1-5, t = topic, d = date rated
```

### Console cookbook

Open DevTools (`F12`) on a forum page and paste any of these. After **editing** data, reload the page. If you have the forum open in several tabs, the last write wins.

**Read things**

```js
// Your ignore list
JSON.parse(localStorage.getItem('wow_ignore_list') || '[]')

// Average rating per user (lowest first)
const ratings = Object.values(JSON.parse(localStorage.getItem('wow_post_ratings') || '{}'));
const byUser = {};
ratings.forEach(r => (byUser[r.u] = byUser[r.u] || []).push(r.r));
console.table(
  Object.entries(byUser)
    .map(([user, rs]) => ({ user, votes: rs.length, avg: +(rs.reduce((a, b) => a + b, 0) / rs.length).toFixed(2) }))
    .sort((a, b) => a.avg - b.avg)
);

// Private profiles seen in the most topics
const priv = JSON.parse(localStorage.getItem('wow_private_profiles') || '{}');
console.table(
  Object.entries(priv)
    .map(([user, p]) => ({ user, topics: Object.keys(p.topicSightings || {}).length, sightings: (p.sightings || []).length, lastSeen: p.lastSeen }))
    .sort((a, b) => b.topics - a.topics)
);

// This week's top posters
const wk = JSON.parse(localStorage.getItem('wow_weekly_leaderboard') || '{}');
console.table(
  Object.entries(wk.users || {})
    .map(([user, u]) => ({ user, name: u.name, posts: u.count }))
    .sort((a, b) => b.posts - a.posts)
    .slice(0, 10)
);

// Raw profile data for anyone (same endpoint the Forum ID links open)
fetch('/en/wow/u/SomeUser-12345.json').then(r => r.json()).then(console.log)
```

**Change things**

```js
// Add someone to the ignore list
const list = JSON.parse(localStorage.getItem('wow_ignore_list') || '[]');
list.push('SomeUser-12345');
localStorage.setItem('wow_ignore_list', JSON.stringify(list));

// Delete every rating you gave one user
const r = JSON.parse(localStorage.getItem('wow_post_ratings') || '{}');
Object.keys(r).forEach(id => { if (r[id].u === 'SomeUser-12345') delete r[id]; });
localStorage.setItem('wow_post_ratings', JSON.stringify(r));

// Start the leaderboard week over (it recreates itself on the next page load)
localStorage.removeItem('wow_weekly_leaderboard');
```

**Quick backup from the console** (the **Manage Data** panel is easier and also accepts this older format on restore):

```js
copy(JSON.stringify(Object.fromEntries(
  ['wow_app_user_id','wow_ignore_list','wow_private_profiles','wow_weekly_leaderboard','wow_post_ratings','wow_fools_minimized']
    .map(k => [k, localStorage.getItem(k)])
)))
```

### How it works

The forum is a single-page app (Ember/Discourse). The page never fully reloads when you move between lists and topics, so a script that runs once at page load would only work for the first page. These are the techniques that make it work without refreshes:

**1. Reacts to the page instead of relying on `@run-at`.**
A `MutationObserver` on `document.body` watches for added and removed nodes (and for changes to the `data-user-card` attribute only). Changes are debounced into a single `tick()` 250 ms later. `popstate` and a 5-second heartbeat act as safety nets. Each tick re-checks the current URL and runs only what applies: the topic inspector on `/wow/t/`, the ignore filter on General Discussion, nothing elsewhere. Because of this, it does not matter when the script starts.

**2. Does not trigger itself.**
Mutations inside the script's own windows are ignored, and every write is idempotent - attributes and text are only touched when their value actually changes (for example the rating readout stores a signature in `data-sig`). A test run with the page idle records zero mutations.

**3. Copes with Ember reusing elements.**
Ember recycles DOM nodes for different posts and users. Each injected info block carries `data-for="<forum id>"` and each rating control carries `data-post` / `data-user`; if the element now belongs to someone else the block is rebuilt. Small `data-fools-*` flags track `pending` and `failed` states per element.

**4. Counts each post once.**
Authors are found via `article[data-post-id]`. Only the first `a.character-name` inside an article counts as the author. A per-session `Set` plus the persisted `seenPosts` map make re-renders, going back to a topic, or reloading harmless. All new posts found in one pass are written in a **single** storage write.

**5. Polite, cached, resilient requests.**
Profile lookups are cached as promises (one per user per session), limited to 4 in flight with a queue, and a failed lookup is retried after 30 seconds instead of in a loop.

**6. Private-profile detection.**
A profile with neither `last_seen_at` nor `last_posted_at` is treated as private. A private user is logged at most once per topic per 8 hours. Trust level is read from the `trust_level_N` group names when the plain `trust_level` field is absent.

**7. Content-security-policy friendly.**
No inline event handlers; everything uses `addEventListener`. Links use `rel="noopener noreferrer"`.

**8. Safe rendering.**
Everything interpolated into HTML goes through an escape function; URLs are built with `encodeURIComponent`; avatar addresses are accepted only if they are `http(s)` (so `javascript:` and `data:` values are ignored); names are always shown as text.

**9. The rating control stays out of the forum's way.**
The dropdown is built with the DOM API, and `click` / `mousedown` / `pointerdown` / `keydown` / `keyup` are stopped from bubbling so the forum's own handlers (user-card popups, keyboard shortcuts) never see them. Averages use integer-style rounding (`Math.round(sum * 10 / count)`) so 3.55 shows as 3.6, and the color is chosen from that same rounded value so the number and the star never disagree.

**10. Week handling without time-zone bugs.**
The week key is the *local* Sunday built from local date parts, not `toISOString()` (which would shift the date for people east of UTC).

**11. Draggable windows.**
Pointer events with pointer capture. At the start of a drag the window's `transform`/`right` positioning is converted to explicit `left`/`top`, and drags are clamped to the viewport. Buttons, inputs, links and text areas never start a drag.

**12. Defensive storage.**
All reads go through a `readJSON` helper with a fallback, so corrupted data cannot break the page. Restore validates and normalizes each key, drops invalid entries, and **rolls back** to the previous values if the browser's storage quota is exceeded mid-write. Each feature in a tick runs inside its own `try/catch`, so one failure cannot stop the rest. A `storage` event listener refreshes the ratings cache when another tab changes it.

**13. Blizzard ignore sync.**
The `ignored_usernames` array from your own profile data is merged (as a union) into your local list. Because that merge happens on every load, **Unignore** first re-checks your live Blizzard list; if the name is still there it shows the settings link instead of removing it locally.

### Tunable constants

Near the top of the script:

| Constant | Default | Purpose |
| --- | --- | --- |
| `MAX_PARALLEL` | `4` | Maximum simultaneous profile requests. |
| `RETRY_MS` | `30000` | Wait before retrying a failed profile lookup. |
| `PROFILE_NAME_KEYS` | `['name']` | Profile-JSON keys tried, in order, for the "selected name" when the post itself doesn't provide one. Dotted paths such as `'alias.name'` work. |

Other fixed rules (search the source for the number): Top 5 Rated needs at least 3 ratings (`count >= 3`); Low Rated is a rounded average below 2.8 (`tenths < 28`); star colors split at 1.9 / 3.5 (`tenths <= 19`, `tenths <= 35`); private-profile sightings are capped at 50 per user.

### Backup file format

```json
{
  "app": "GD Forum Tools",
  "backupVersion": 1,
  "scriptVersion": "11.3",
  "createdAt": "2026-10-12T18:30:00.000Z",
  "data": {
    "wow_app_user_id": "panthra-2938857",
    "wow_ignore_list": ["..."],
    "wow_private_profiles": { "...": {} },
    "wow_weekly_leaderboard": { "...": {} },
    "wow_post_ratings": { "...": {} },
    "wow_fools_minimized": "0"
  }
}
```

JSON-typed keys are stored as real JSON (not escaped strings) so the file is readable. Restore also accepts the older "plain object of raw localStorage strings" format.

---

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Nothing appears | Is Tampermonkey enabled for the site, and (on recent Chrome) is **Allow User Scripts** / **Developer mode** switched on? The page URL must start with `https://us.forums.blizzard.com/en/wow/`. |
| The window shows an ID box | Enter your forum ID and press **Save User ID**. |
| No rating dropdown on a post | It is hidden on your own posts. Otherwise give the page a moment: it appears as soon as the post is scanned. |
| Avatars show a letter tile | No image address was found yet, or it failed to load. Opening a topic where the user posted, or reopening the leaderboard, fills it in. |
| Unignore does not stick | The person is on your Blizzard ignore list too. Use the link in the note to remove them there first. |
| My data disappeared | Clearing browser/site data removes it. Restore from a backup. |
| Counts bumped up after upgrading | Versions before 10.5 counted every sighting. After upgrading, posts you already saw that week can be counted once more because the list of counted post IDs starts empty. Your existing data is kept. |

---

## Version notes

| Version | Highlights |
| --- | --- |
| 10.0 | Userscript with observer-driven autorun (no `@run-at` dependence), in-window ID entry, minimize pill. |
| 10.1 | Pop-out legend. |
| 10.5 | Unique-post counting via `data-post-id`, retry and element-reuse fixes. |
| 10.6 | Link to Blizzard ignore settings, banners restyled to match the windows. |
| 10.7 | **Manage Data** panel: backup, restore, export, selective wipe. |
| 10.8 / 10.9 | Forum IDs link to raw profile JSON; lock icon for private profiles. |
| 11.0 | 1-5 star post ratings, colored averages, Rating column. |
| 11.1 | Avatars and selected names, request limiter, trust-level fix. |
| 11.2 | **Top 5 Rated Users**. |
| 11.3 | 3-rating minimum for Top 5; **Low Rated** list with Ignore / Unignore. |

---

## License and disclaimer

Released under the **MIT License** (see `LICENSE`). Provided as is, with no warranty. This project is not endorsed by, affiliated with, or supported by Blizzard Entertainment. World of Warcraft and Blizzard are trademarks of Blizzard Entertainment, Inc.

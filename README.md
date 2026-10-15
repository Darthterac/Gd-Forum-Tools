# GD Forum Tools

A userscript for the **World of Warcraft General Discussion forums** (`us.forums.blizzard.com/en/wow`). It adds a small draggable control panel and some quality-of-life tools to topic lists and topic pages: a local ignore list, extra profile info, private-profile tracking, per-post star ratings, a weekly leaderboard, a read-aloud button, and an optional link and image helper.

Everything runs in your own browser. There is no server, no account, no tracking and no analytics.

> ## ⚠️ Not a Blizzard product
> **GD Forum Tools is an independent, fan-made project. It is not made, endorsed, sponsored, reviewed or supported by Blizzard Entertainment, Inc. in any way.** World of Warcraft®, Blizzard® and Blizzard Entertainment® are trademarks or registered trademarks of Blizzard Entertainment, Inc. They are used here only to say which website the script works on.
>
> The script runs in your browser and only reads pages and public profile data that the forum already shows to you. It does not modify the forum for anyone else, and it does not send your data anywhere. It is provided as is, with no warranty. It depends on the forum's page layout, so a forum update can break it at any time. Use it at your own risk.

---

## Contents

- [Features](#features)
- [Install](#install)
- [Updating](#updating)
- [Using the tools](#using-the-tools)
- [Privacy and data](#privacy-and-data)
- [A note on ratings](#a-note-on-ratings)
- [Technical details](#technical-details)
- [Console access](#console-access)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Features

| Feature | What it does |
|---|---|
| **Ignore list** | Hides topics started by users on your list in General Discussion. Each hidden row becomes a "Have a Nice Day!" banner with an **Unignore to View** button. |
| **Blizzard ignore sync** | Reads the ignore list from your own forum profile and merges it into the local list. |
| **Topic user info** | Under each author on a topic page: last seen, last post, recent read time and trust level. |
| **Private profile log** | Notes users whose last seen and last post are both hidden, and remembers the topics they were spotted in. Shows a 🔒 badge and a 🔄×N badge when the same private user turns up in several topics. |
| **Last seen carry-forward** | For a private profile, shows the most recent time that user was seen in a different topic. |
| **Post ratings** | A 1-5 star dropdown on every post (except your own). Keeps an all-time average per user. |
| **Weekly leaderboard** | Sunday to Sunday. Most seen users (each unique post counted once), your own account stats, top rated users and the topics your top users share. Shows avatars and names. |
| **Low Rated & Ignored list** | Everyone you have rated below 2.8 or ignored, with one-click Ignore / Unignore. |
| **Read aloud** | A 🔊 Read button on each post that reads it out loud using your browser's text to speech. |
| **Trust level 5 toggle** | Optional display helper that turns plain-text links into clickable styled links and shows image links inline. |
| **Manage Data** | Backup, restore, export (leaderboard JSON, private log CSV) and selective wipe. |
| **Metrics and legend** | Small counters in the panel header, plus a pop-out legend explaining every icon. |

---

## Install

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Edge, Firefox, Safari and others).
2. Open the script link: **[GD_Forum_Tools.user.js](https://github.com/Darthterac/Gd-Forum-Tools/raw/refs/heads/master/GD_Forum_Tools.user.js)**
3. Your userscript manager will show an install page. Click **Install**.
4. Go to the [WoW General Discussion forum](https://us.forums.blizzard.com/en/wow/c/community/general-discussion). The **GD Forum Tools** panel appears in the top right.

The script only runs on `https://us.forums.blizzard.com/en/wow/*`.

### First-time setup

1. Open any topic list or topic page and find your **forum user ID** (the name in your profile link, for example `name-1234567`).
2. Paste it into the **Blizzard Forum User ID** box in the panel and click **Save User ID**.

This is optional, but it is needed for ignore sync, your account stats and for skipping rating controls on your own posts.

---

## Updating

The script header includes `@updateURL` and `@downloadURL`, so Tampermonkey checks for new versions on its own (about once a day by default). To check right away, open the Tampermonkey dashboard and choose **Check for userscript updates**.

Your data lives in your browser's local storage, not in the script, so updating keeps it.

---

## Using the tools

### The panel

- **Drag** the header to move it. **Minimize** (or the close button) shrinks it to a small 🛡️ GD pill. Click the pill to open it again.
- **?** or the metric counters open the **legend**.
- Type user IDs into the box (one per line or comma separated) and click **Save / Run** to update your ignore list and re-run the filter.

### Ignore list

Ignored users' topics are replaced by a banner on the General Discussion list. **Unignore to View** removes the user from your local list. If the user is also on your Blizzard ignore list, the script tells you to remove them there first, because that list is re-synced every time the page loads.

### Ratings

Use the **Rate post…** dropdown under an author on a topic page. Colors for the all-time average: **red** below 2.0, **yellow** 2.0 to 3.5, **green** 3.6 to 5.0. The number in brackets is how many ratings the average is based on. **Top 5 Rated** needs at least 3 ratings per user.

### Read aloud

Click **🔊 Read** under an author to hear that post. Click **⏹ Stop** to stop. Select some text in the post first to read only that part. Quoted replies, code blocks and images are skipped, and links are read as the word "link". Reading stops when you open a different topic.

### Trust level 5 toggle

Display only. It does **not** change your real forum trust level or permissions. When on, plain-text `https` links in posts become clickable styled links, and image links (`.png`, `.jpg`, `.jpeg`, `.gif` and Imgur pages) are shown inline. Imgur album links stay as normal links. Turn it off and everything it added is removed.

Inline images load straight from the host site, so that host can see your IP address.

### Manage Data

- **Backup All Data** saves one JSON file with everything the script stores.
- **Restore From Backup…** reads that file back in after a confirmation.
- **Leaderboard (.json)** and **Private Log (.csv)** export reports.
- **Wipe Selected** deletes the data you tick, after a confirmation.

---

## Privacy and data

- All data is stored in your browser's `localStorage` for the forum site. Nothing is uploaded anywhere.
- The script only makes requests to the forum itself (`/en/wow/u/<user>.json` for profile data). With the Trust level 5 toggle on, your browser also loads any image links found in posts from their own hosts.
- The private profile log and ratings only contain things you have seen or entered yourself, such as user IDs, topic links and timestamps. It does not collect anything the forum hides from you.
- Clearing your browser's site data, or using **Wipe Selected**, removes it. Make a backup first if you want to keep it.

---

## A note on ratings

Ratings are **your own private opinion** of a post's content, kept on your own computer. They are not shared, not public, and they are not a judgement about a person. Please do not use them to harass anyone.

If a post breaks the forum rules, **report it with the post's flag button** so the moderators can deal with it. This tool does not report anyone and cannot replace that.

---

## Technical details

### Stack

A single self-contained JavaScript file (an IIFE) with no dependencies and no build step. It is written with plain DOM APIs, `fetch`, `localStorage`, `MutationObserver` and the Web Speech API.

```
// @match      https://us.forums.blizzard.com/en/wow/*
// @run-at     document-idle
// @grant      none
```

`@grant none` means the script runs in the page context and uses no privileged userscript APIs.

### Page detection

The forum is a single-page app, so the script re-checks the page on every change instead of only at load.

- `/wow/c/community/general-discussion` is treated as the **list** page (ignore filtering).
- `/wow/t/...` is treated as a **topic** page (user info, ratings, read aloud, leaderboard counting).

### Async DOM handling

- A `MutationObserver` on `document.body` (childList, subtree, plus the `data-user-card` attribute) schedules a run of the main `tick()` function, debounced to 250 ms.
- Mutations that happen entirely inside the script's own modals are ignored, so the script never triggers itself.
- A 5 second `setInterval` and a `popstate` listener act as a safety net for navigation the observer misses.
- Each stage of `tick()` runs inside its own `try/catch`, so one failure does not stop the others.
- Rows and controls are marked with `data-` attributes (for example `data-fools-processed`, `data-post`, `data-user`) so work is never done twice.

### Profile fetching

- Author names are read from `a.character-name[data-user-card]`.
- Profile data comes from `/en/wow/u/<user>.json`.
- Requests go through a small queue with a limit of **4 in flight at once**, and results are cached per user for the session.
- A failed fetch is retried after 30 seconds.
- A profile is treated as **private** when both `last_seen_at` and `last_posted_at` are missing.

### Leaderboard counting

- A week runs **Sunday to Sunday** in local time, keyed by the Sunday's date. A new week starts a fresh record automatically.
- Each unique post is counted **once per week**, identified by `article[data-post-id]`, and only the first `a.character-name` in a post is counted.
- Avatars and names are taken from the post, and filled in from the profile JSON when missing.

### Private profile log

- A sighting is logged at most once per topic every **8 hours**.
- Up to **50 sightings** are kept per user.
- Per-topic "last seen" times are stored so a private user's last seen can carry forward to a new topic.

### Ratings

- Stored by post ID: `{ u: user, r: 1-5, t: topicId, d: date }`.
- Averages are computed from all stored ratings and cached until a rating changes.
- Low Rated list threshold: average below **2.8**. Top 5 Rated minimum: **3** ratings.

### Read aloud

- Uses `speechSynthesis` and `SpeechSynthesisUtterance`.
- Text is taken from the post's `.cooked` element, with quotes, code and images removed.
- It is spoken in sentence-sized chunks (about 220 characters) one after another. This avoids a known browser problem where long utterances cut off after roughly 15 seconds.
- A token counter cancels stale chunks when you press Stop, start another post or change topic.

### Trust level 5 helper

- A `TreeWalker` finds text nodes containing `https://` and swaps them for links or image elements, skipping links, code, inputs, the editor and the script's own UI.
- Inserted elements carry a `data-gdft` attribute so toggling off can remove exactly what was added and restore plain text.
- Images use `referrerPolicy = 'no-referrer'` and lazy loading, and are removed again if they fail to load.
- The pulsing animation is switched off for users who prefer reduced motion.

### Storage keys

| Key | Contents |
|---|---|
| `wow_app_user_id` | Your forum user ID (string) |
| `wow_ignore_list` | Array of ignored user IDs |
| `wow_private_profiles` | Object keyed by user ID: first/last seen, sightings, topic sightings, topic last seen |
| `wow_weekly_leaderboard` | Current week only: users, topics, seen post IDs, account snapshot |
| `wow_post_ratings` | Object keyed by post ID: user, rating, topic, date |
| `wow_fools_minimized` | `"1"` if the panel is minimized |
| `wow_trust_level_5` | `"1"` if the Trust level 5 toggle is on |

### Backup format

A JSON file with this shape:

```json
{
  "app": "GD Forum Tools",
  "backupVersion": 1,
  "scriptVersion": "12.2",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "data": { "wow_ignore_list": [], "wow_post_ratings": {} }
}
```

On restore, every value is validated before anything is written. A bad section is skipped, a failed write rolls back, and a leaderboard from a past week is rejected because only the current week is kept.

### Safety

Text from the forum is escaped before it is placed into the script's own HTML, and links opened in a new tab use `rel="noopener noreferrer"`.

---

## Console access

Open the browser developer tools (F12) on the forum and use the console. A few examples:

```js
// View your ignore list
JSON.parse(localStorage.getItem('wow_ignore_list'))

// View the private profile log
JSON.parse(localStorage.getItem('wow_private_profiles'))

// Count your stored ratings
Object.keys(JSON.parse(localStorage.getItem('wow_post_ratings') || '{}')).length

// Inspect a user's raw profile data (same data the script reads)
fetch('/en/wow/u/USERNAME.json').then(r => r.json()).then(console.log)
```

Changing stored values by hand is possible but easy to get wrong. Use **Manage Data → Backup** first.

---

## Troubleshooting

- **Nothing appears:** make sure the userscript manager is enabled and you are on a `us.forums.blizzard.com/en/wow` page.
- **Ignore sync does nothing:** save your forum user ID in the panel, and make sure you are logged in.
- **A hidden topic came back:** the user is probably still on your Blizzard ignore list. Remove them there (the panel links to your ignore settings), then use **Unignore to View**.
- **No voice or wrong voice for Read:** the voice comes from your browser and operating system. Change it in your system's text to speech settings.
- **Something looks broken after a forum update:** the script relies on the forum's page structure. Please open an issue with what you see.

---

## License

MIT License. © Lazyeyez.

# GD Forum Tools

**A client-side JavaScript userscript for the World of Warcraft General Discussion forums.**

GD Forum Tools adds a personal set of forum-management, profile-inspection, activity-tracking, and data-management features to the Blizzard World of Warcraft forums. Built with vanilla JavaScript, it works directly with the forum page through DOM manipulation, browser storage, asynchronous requests, and a custom floating interface.

Developed by **Lazyeyez**.

<img width="1917" height="882" alt="image" src="https://github.com/user-attachments/assets/2793b67d-97b4-475e-aaf1-072f4ea80700" />
**more pictures below**

## Overview

GD Forum Tools is designed to give users more control over their forum experience while providing additional visibility into publicly available forum profile information and their own browsing activity.

The script integrates with Blizzard's existing forum pages rather than replacing them. Its interface can be moved around the screen or minimized, allowing the user to keep the tools available without permanently occupying valuable screen space.

The project combines several practical JavaScript techniques, including DOM observation, event-driven updates, asynchronous profile requests, local data persistence, dynamic interface generation, and client-side reporting.

## Features

### 1. Ignore List and Topic Filtering

Maintain a personal list of forum users whose topics you would rather not see.

* Manage multiple user IDs in a single interface.
* Enter users using newline-separated or comma-separated values.
* Save and run the filter without manually editing browser storage.
* Hide matching topic rows and display a replacement message.
* Restore an individual topic row using the unignore control.
* Synchronize the local ignore list with Blizzard's native ignored-user list when the account user ID is configured.

If a user is still present on Blizzard's native ignore list, the interface provides a link to the relevant forum preferences page so that the native ignore can be removed first.

### 2. Topic User Profile Inspector

On individual discussion topics, GD Forum Tools inspects participating user profiles and displays additional information alongside forum users.

Available profile information includes:

* User ID
* Last-seen timestamp, when available
* Last-post timestamp, when available
* Recent forum reading time
* Trust level
* Rate Users Posts, survives weekly resets, shows in Weekly Report 

Profile information is retrieved through asynchronous requests to the forum's user JSON endpoint. Results are cached during the current page session to reduce repeated requests.

The script also identifies profiles where both last-seen and last-post timestamps are unavailable, marking them as private profiles for tracking purposes.

<img width="1917" height="877" alt="image" src="https://github.com/user-attachments/assets/03aba304-c421-4fc5-8f34-a2bc7e5768c7" />

### 3. Private Profile Activity Log

Track sightings of profiles identified by the script as private.

The local activity log records information such as:

* First-seen and last-seen timestamps
* Topic IDs and URLs where the profile was encountered
* Topic titles
* Repeated sightings across different topics

To limit data growth, the script retains the most recent 50 sightings per tracked profile.

A reporting interface presents the collected records, and the export function allows the private-profile log to be exported as CSV.

**Important:** This is a local browsing-activity log, not access to hidden account information. The script does not reveal the actual last-seen or last-post values when Blizzard's profile response does not provide them.

### 4. Weekly Forum Activity Leaderboard

Tracks the forum activity of users encountered during your browsing sessions, building a leaderboard from their observed posts and participation.

* **Observed activity:** Records posts encountered by the script while browsing forum pages.
* **Unique post tracking:** Deduplicates posts by post ID to avoid counting the same post repeatedly.
* **Weekly rankings:** Ranks observed users by their recorded posting activity for the week.
* **Topic participation:** Tracks unique topics and identifies shared discussions among the most active observed users.

The leaderboard provides a snapshot of the activity flowing through the pages you visit. It measures observed forum participation, not total site-wide activity or the complete time users spend online.

<img width="460" height="631" alt="image" src="https://github.com/user-attachments/assets/d4ec2798-510b-4415-9a64-ca48d846b53c" />

### 5. Account Statistics and Metrics

The floating interface displays live counters for the script's current tracking activity.

These include:

* Ignored users
* Topic rows hidden during the current session
* Tracked private profiles
* Profiles observed across multiple topics
* Profiles inspected during the current session
* Recorded private-profile sightings

A companion legend explains the counters and the visual indicators used by the profile inspector and topic filter.

### 6. Floating User Interface

The interface is generated dynamically using JavaScript and styled with CSS.

Interface features include:

* A movable main control panel
* A minimizable floating control
* A draggable weekly leaderboard
* A draggable report window
* A separate metrics legend
* A dark visual theme with blue accents
* Responsive width constraints for smaller browser windows
* Status messages and controls for saving, exporting, and clearing data

The interface is designed to remain separate from the underlying forum's normal content and controls.

### 7. Local Data Management

GD Forum Tools uses browser `localStorage` to preserve user settings and collected data across page reloads.

Stored datasets include:

| Storage key              | Purpose                          |
| ------------------------ | -------------------------------- |
| `wow_ignore_list`        | Personal ignore list             |
| `wow_private_profiles`   | Private-profile sightings        |
| `wow_weekly_leaderboard` | Weekly activity data             |
| `wow_app_user_id`        | Configured forum account user ID |
| `wow_fools_minimized`    | Minimized interface state        |

The data-management controls support clearing the private-profile log independently or wiping the script's principal datasets and reloading the page.

Clearing this data is destructive. Export any information you want to retain before performing a full wipe. The new Manage Data function has options to 
export all or parts of your data, and import from back ups, making it easy to manage multiple accounts.

## Technical Implementation

This project is built with plain JavaScript and browser-native APIs. It does not require a JavaScript framework or a separate build process.

### Technologies and techniques

* **Vanilla JavaScript:** Application logic, data processing, and interface behavior.
* **DOM manipulation:** Dynamic creation and updating of interface elements.
* **MutationObserver:** Detects relevant changes to the forum's document structure.
* **Fetch API:** Retrieves forum profile JSON and native ignore information.
* **Promises and async/await:** Handles asynchronous profile requests and ignore synchronization.
* **Map and Set:** Supports in-session profile caching and unique-post tracking.
* **localStorage:** Persists configuration, activity logs, and weekly statistics.
* **CSS:** Styles the floating interface, reports, controls, and leaderboard.
* **Event listeners:** Handles user interaction, browser navigation, and pointer-based dragging.

### Efficient page updates

Forum pages can change after their initial load, so GD Forum Tools uses a `MutationObserver` to schedule updates when relevant DOM changes occur.

A short scheduling delay coalesces bursts of mutations, while a periodic check and the browser's `popstate` event provide additional opportunities to synchronize the script with the current page.

The observer also filters mutations originating entirely inside the script's own interface to reduce unnecessary update cycles.

Profile requests are cached during the current session, and failed requests are eligible for retry after the cache entry is removed.

## Installation

GD Forum Tools is distributed as a JavaScript userscript.

1. Install a userscript manager compatible with your browser, such as Tampermonkey.
2. Open your userscript manager and create a new userscript.
3. Replace the editor contents with the contents of `GD_Forum_Tools-10_6_user.js`.
4. Save the userscript and ensure it is enabled.
5. Open or reload the World of Warcraft General Discussion forums.

The script's metadata limits automatic execution to:

`https://us.forums.blizzard.com/en/wow/*`

The script runs at `document-idle` and requests no additional userscript-manager grants.

## Configuration

Open the GD Forum Tools interface on a supported forum page.

### Managing ignored users

Enter the user IDs you want to filter, using one ID per line or comma-separated entries, then select **Save / Run**.

### Synchronizing Blizzard ignores

Configure your own Blizzard forum user ID in the account section of the interface. The script uses this ID to request the account's forum JSON data and synchronize its native ignored-user list.

### Reviewing activity

Use the weekly leaderboard and private-profile report controls to inspect locally collected information. Use the CSV export control when you want to retain the private-profile log outside the browser.

### Clearing stored information

Use the data-clearing control to remove the private-profile log or clear the principal stored datasets. Export relevant data first if you need to preserve it.

## Privacy and Limitations

GD Forum Tools runs in your browser and stores its tracking data in the browser's local storage for the Blizzard forum origin.

Keep the following limitations in mind:

* The weekly leaderboard only counts unique posts encountered by the running script.
* Profile information depends on the data returned by Blizzard's forum endpoints.
* Private-profile tracking records observed profile appearances; it does not bypass privacy settings.
* Native ignore synchronization depends on the configured account ID and the availability of the expected forum JSON response.
* Local storage is browser-specific and is not automatically synchronized between devices.
* Clearing browser storage or using a different browser profile may remove access to previously collected data.
* Changes to Blizzard's forum markup, routes, or JSON endpoints may require code updates.

Use the collected information responsibly and respect other forum users' privacy.

## Compatibility

**Target platform:** Blizzard World of Warcraft US forums.

**Supported page types:**

* World of Warcraft General Discussion topic listings
* Individual World of Warcraft discussion topics

The script is written against the forum's current page structure and JSON endpoints. Compatibility with other Blizzard forums, regions, or future forum redesigns is not guaranteed.

## Version

**Current documented version: 11.1**
The userscript identifies itself as `GD Forum Tools`, uses the namespace `lazyeyez.gdforumtools`, and is authored by Lazyeyez.

## License

Released under the **MIT License**.

See the repository's `LICENSE` file for the full license text.

## Development Philosophy

GD Forum Tools is an example of practical browser-side engineering: identify a repetitive workflow, understand the page and its data, build a small layer of functionality around existing systems, and keep the implementation focused on the problem.

The project uses native browser capabilities rather than depending on a large framework. Its features are developed through experimentation, iterative improvements, and direct interaction with the actual forum environment.

The goal is straightforward: build useful tools, understand the code that makes them work, and keep improving the implementation as the platform changes.

---

**Author:** Lazyeyez

**Project:** GD Forum Tools

**Language:** JavaScript

**Platform:** Blizzard World of Warcraft forums



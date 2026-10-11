// ==UserScript==
// @name         GD Forum Tools
// @namespace    lazyeyez.gdforumtools
// @version      10.9
// @description  Ignore list, topic user data, private profile log, metrics, weekly leaderboard (unique posts per week), a Manage Data panel (backup, restore, export, selective wipe), and version tag.
// @author       Lazyeyez (MIT)
// @match        https://us.forums.blizzard.com/en/wow/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    if (window.__foolsLoaded) return;
    window.__foolsLoaded = true;

    const THEME = {
        text: '#ffffff',
        bg: '#121212',
        navy: '#0a1f5c',
        navyHover: '#143a96',
        sky: '#87ceeb',
        shadow: '0 6px 26px rgba(189, 183, 107, 0.55)',
        shadowSoft: '0 2px 10px rgba(189, 183, 107, 0.45)'
    };

    const stats = { scanned: 0, hidden: 0 };
    const profileCache = new Map();
    const VERSION = '10.9';
    const RETRY_MS = 30000;
    const DATA_KEYS = ['wow_app_user_id', 'wow_ignore_list', 'wow_private_profiles', 'wow_weekly_leaderboard', 'wow_fools_minimized'];
    const JSON_KEYS = new Set(['wow_ignore_list', 'wow_private_profiles', 'wow_weekly_leaderboard']);
    const DATA_LABELS = {
        wow_app_user_id: 'Blizzard User ID',
        wow_ignore_list: 'Ignore list',
        wow_private_profiles: 'Private profile log',
        wow_weekly_leaderboard: 'Weekly leaderboard',
        wow_fools_minimized: 'Window state'
    };
    const sessionSeenPosts = new Set();
    let sessionWeek = '';
    let warnedNoPostId = false;
    let appUserId = '';
    let modal = null;
    let pill = null;
    let legend = null;
    let legendOpen = false;
    let tickTimer = null;

    function readJSON(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallback;
            const parsed = JSON.parse(raw);
            return parsed === null || parsed === undefined ? fallback : parsed;
        } catch (e) {
            return fallback;
        }
    }

    function getIgnoreList() {
        const raw = readJSON('wow_ignore_list', []);
        if (!Array.isArray(raw)) return [];
        return raw
            .filter(v => v !== null && v !== undefined)
            .map(v => String(v).trim())
            .filter(Boolean);
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatSeconds(sec) {
        if (!sec) return '0m';
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    function formatSignedSeconds(sec) {
        if (!sec) return '0m';
        return (sec < 0 ? '-' : '+') + formatSeconds(Math.abs(sec));
    }

    function formatDate(isoStr) {
        if (!isoStr) return 'N/A';
        return new Date(isoStr).toLocaleString();
    }

    function getCurrentTopicId() {
        const match = window.location.href.match(/\/wow\/t\/([^/]+)/);
        return match ? match[1] : null;
    }

    function pageKind() {
        const href = window.location.href;
        if (href.includes('/wow/c/community/general-discussion')) return 'gd';
        if (href.includes('/wow/t/')) return 'topic';
        return null;
    }

    // --- WEEKLY LEADERBOARD LOGIC (SUN - SUN) ---
    function getSundayOfCurrentWeek() {
        const now = new Date();
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        d.setDate(d.getDate() - d.getDay());
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${dd}`;
    }

    function getWeeklyData() {
        const currentSunday = getSundayOfCurrentWeek();
        let data = readJSON('wow_weekly_leaderboard', null);
        if (!data || data.weekStart !== currentSunday) {
            data = {
                weekStart: currentSunday,
                users: {},
                topics: {},
                appUserInitial: null,
                appUserCurrent: null,
                topicsEngaged: [],
                seenPosts: {}
            };
            localStorage.setItem('wow_weekly_leaderboard', JSON.stringify(data));
        }
        return data;
    }

    function recordSightings(topicId, topicTitle, topicUrl, entries) {
        if (!topicId || !entries || entries.length === 0) return;
        const data = getWeeklyData();
        if (!data.seenPosts) data.seenPosts = {};
        let changed = false;

        entries.forEach(({ userCard, postId }) => {
            if (!userCard || !postId || data.seenPosts[postId]) return;
            data.seenPosts[postId] = 1;
            changed = true;

            if (!data.users[userCard]) {
                data.users[userCard] = { count: 0, topics: {} };
            }
            data.users[userCard].count++;
            data.users[userCard].topics[topicId] = (data.users[userCard].topics[topicId] || 0) + 1;

            if (!data.topics[topicId]) {
                data.topics[topicId] = { title: topicTitle || topicId, url: topicUrl || window.location.href, count: 0, users: {} };
            }
            data.topics[topicId].count++;
            data.topics[topicId].users[userCard] = (data.topics[topicId].users[userCard] || 0) + 1;

            if (!data.topicsEngaged.includes(topicId)) {
                data.topicsEngaged.push(topicId);
            }
        });

        if (changed) {
            localStorage.setItem('wow_weekly_leaderboard', JSON.stringify(data));
        }
    }

    function updateAppUserStats(profile) {
        if (!profile) return;
        const data = getWeeklyData();
        const readTime = profile.recent_time_read || 0;
        const trustLevel = profile.trust_level || 0;

        if (!data.appUserInitial) {
            data.appUserInitial = { readTime, trustLevel };
        }
        data.appUserCurrent = { readTime, trustLevel };
        localStorage.setItem('wow_weekly_leaderboard', JSON.stringify(data));
    }

    function shouldLogPrivateProfile(userCard) {
        const privateProfiles = readJSON('wow_private_profiles', {});
        if (!privateProfiles[userCard]) return true;

        const currentTopicId = getCurrentTopicId();
        const entry = privateProfiles[userCard];

        if (entry.topicSightings && entry.topicSightings[currentTopicId]) {
            const last = new Date(entry.topicSightings[currentTopicId]).getTime();
            const eightHoursMs = 8 * 60 * 60 * 1000;
            if (Date.now() - last < eightHoursMs) return false;
        }
        return true;
    }

    function logPrivateProfileUser(userCard) {
        const privateProfiles = readJSON('wow_private_profiles', {});
        const currentTopicId = getCurrentTopicId();

        if (!privateProfiles[userCard]) {
            privateProfiles[userCard] = {
                firstSeen: new Date().toISOString(),
                sightings: [],
                altNames: [],
                topicSightings: {}
            };
        }

        const entry = privateProfiles[userCard];
        if (!Array.isArray(entry.sightings)) entry.sightings = [];
        if (!entry.topicSightings) entry.topicSightings = {};
        entry.lastSeen = new Date().toISOString();

        entry.sightings.push({
            timestamp: new Date().toISOString(),
            topicId: currentTopicId,
            topicUrl: window.location.href,
            topicTitle: document.title
        });

        entry.topicSightings[currentTopicId] = new Date().toISOString();

        if (entry.sightings.length > 50) {
            entry.sightings = entry.sightings.slice(-50);
        }

        localStorage.setItem('wow_private_profiles', JSON.stringify(privateProfiles));
    }

    function getProfileJsonUrl(userCard) {
        return `${window.location.origin}/en/wow/u/${encodeURIComponent(userCard)}.json`;
    }

    function getIgnorePrefsUrl(userId) {
        return `${window.location.origin}/en/wow/u/${encodeURIComponent(userId)}/preferences/users`;
    }

    async function fetchNativeIgnores() {
        if (!appUserId) return null;
        try {
            const res = await fetch(`${window.location.origin}/en/wow/u/${encodeURIComponent(appUserId)}.json`);
            if (!res.ok) return null;
            const data = await res.json();
            if (data && data.user && Array.isArray(data.user.ignored_usernames)) {
                return data.user.ignored_usernames;
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    function modalCss(extra) {
        return `
            background: ${THEME.bg};
            color: ${THEME.text};
            border: 2px solid ${THEME.sky};
            border-radius: 8px;
            box-shadow: ${THEME.shadow};
            box-sizing: border-box;
            font-family: sans-serif;
            padding: 20px;
            ${extra}
        `;
    }

    function styleButtons(root) {
        root.querySelectorAll('.fools-btn').forEach(btn => {
            btn.style.background = THEME.navy;
            btn.style.color = THEME.text;
            btn.style.border = `1px solid ${THEME.sky}`;
            btn.style.borderRadius = '4px';
            btn.style.padding = '6px 8px';
            btn.style.cursor = 'pointer';
            btn.style.fontSize = '10px';
            btn.style.fontWeight = 'bold';
            btn.style.fontFamily = 'sans-serif';
            btn.style.textAlign = 'center';
            btn.style.whiteSpace = 'nowrap';
            btn.addEventListener('mouseenter', () => { if (!btn.disabled) btn.style.background = THEME.navyHover; });
            btn.addEventListener('mouseleave', () => { btn.style.background = THEME.navy; });
        });
    }

    function makeDraggable(el, handle, onMove) {
        handle = handle || el;
        handle.style.cursor = 'move';
        handle.style.touchAction = 'none';
        handle.style.userSelect = 'none';

        handle.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            if (e.target.closest('button, textarea, input, select, a')) return;

            const rect = el.getBoundingClientRect();
            el.style.left = rect.left + 'px';
            el.style.top = rect.top + 'px';
            el.style.right = 'auto';
            el.style.bottom = 'auto';
            el.style.transform = 'none';

            const startX = e.clientX;
            const startY = e.clientY;
            const offX = e.clientX - rect.left;
            const offY = e.clientY - rect.top;
            el.__dragged = false;

            try { handle.setPointerCapture(e.pointerId); } catch (err) {}

            const move = (ev) => {
                if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) el.__dragged = true;
                const maxX = Math.max(0, window.innerWidth - el.offsetWidth);
                const maxY = Math.max(0, window.innerHeight - 40);
                el.style.left = Math.min(Math.max(0, ev.clientX - offX), maxX) + 'px';
                el.style.top = Math.min(Math.max(0, ev.clientY - offY), maxY) + 'px';
                if (onMove) onMove();
            };

            const up = (ev) => {
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', up);
                handle.removeEventListener('pointercancel', up);
                try { handle.releasePointerCapture(ev.pointerId); } catch (err) {}
            };

            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', up);
            handle.addEventListener('pointercancel', up);
            e.preventDefault();
        });
    }

    function getMetricItems() {
        const profiles = readJSON('wow_private_profiles', {});
        const ids = Object.keys(profiles);
        let sights = 0;
        let repeat = 0;
        ids.forEach(id => {
            const entry = profiles[id] || {};
            sights += Array.isArray(entry.sightings) ? entry.sightings.length : 0;
            if (Object.keys(entry.topicSightings || {}).length > 1) repeat++;
        });

        const ignored = getIgnoreList().length;

        return [
            ['🚫', ignored, 'Ignored', '# of Users on your ignore list.'],
            ['🙈', stats.hidden, 'Hidden', 'Ignored Topics [Have a nice day] banners.'],
            ['🔒', ids.length, 'Private', 'Private-profiles logged.'],
            ['🔄', repeat, 'Repeat', 'Private-profiles seen in 2+ topics you have read.'],
            ['🔎', stats.scanned, 'Scanned', 'Profiles scanned since last refresh.'],
            ['👁', sights, 'Sights', 'Private-profiles meta data (up to 50 entries per logged profile)']
        ];
    }

    function renderLegend() {
        const box = document.getElementById('fools-legend-rows');
        if (!box) return;

        const html = getMetricItems().map(i => `
            <div style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
                <div style="width: 22px; text-align: center; font-size: 14px;">${i[0]}</div>
                <div style="flex: 1;">
                    <div style="font-weight: bold; font-size: 12px;">${i[2]}</div>
                    <div style="font-size: 11px; opacity: 0.85;">${i[3]}</div>
                </div>
                <div style="font-family: monospace; font-size: 12px; font-weight: bold;">${i[1]}</div>
            </div>
        `).join('');

        if (box.innerHTML !== html) box.innerHTML = html;
    }

    function positionLegend() {
        if (!legend || !modal) return;
        const r = modal.getBoundingClientRect();
        const w = 300;
        const gap = 10;
        let left = r.left - w - gap;
        if (left < 8) left = Math.min(r.right + gap, Math.max(8, window.innerWidth - w - 8));
        legend.style.left = left + 'px';
        legend.style.right = 'auto';
        legend.style.top = Math.max(8, r.top) + 'px';
    }

    function setLegendOpen(open) {
        legendOpen = open;
        syncVisibility();
    }

    function updateMetrics() {
        const box = document.getElementById('fools-metrics');
        if (!box) return;

        const html = getMetricItems()
            .map(i => `<span title="${i[3]}" style="white-space: nowrap;">${i[0]} ${i[1]}</span>`)
            .join('');

        if (box.innerHTML !== html) box.innerHTML = html;
        if (legendOpen) renderLegend();
    }

    function setStatus(text) {
        const el = document.getElementById('fools-status');
        if (el && el.textContent !== text) el.textContent = text;
    }

    function fetchProfile(userCard) {
        if (profileCache.has(userCard)) return profileCache.get(userCard);

        const p = fetch(`${window.location.origin}/en/wow/u/${userCard}.json`)
            .then(res => {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(data => {
                const profile = data.user || data;
                const isPrivate = !profile.last_seen_at && !profile.last_posted_at;
                if (isPrivate && shouldLogPrivateProfile(userCard)) {
                    logPrivateProfileUser(userCard);
                }
                stats.scanned++;
                updateMetrics();
                return profile;
            });

        profileCache.set(userCard, p);
        p.catch(() => {
            setTimeout(() => {
                if (profileCache.get(userCard) === p) profileCache.delete(userCard);
            }, 30000);
        });
        return p;
    }

    function renderUserInfo(profile, userCard) {
        const lastSeen = formatDate(profile.last_seen_at);
        const lastPost = formatDate(profile.last_posted_at);
        const readTime = formatSeconds(profile.recent_time_read);
        let maxTrust = profile.trust_level || 0;
        const isPrivate = !profile.last_seen_at && !profile.last_posted_at;

        if (profile.groups && Array.isArray(profile.groups)) {
            profile.groups.forEach(g => {
                const gName = typeof g === 'string' ? g : (g.name || '');
                const match = gName.match(/trust_level_(\d+)/);
                if (match) {
                    const lvl = parseInt(match[1], 10);
                    if (lvl > maxTrust) maxTrust = lvl;
                }
            });
        }

        let badge = '';
        if (isPrivate) {
            const privateProfiles = readJSON('wow_private_profiles', {});
            const topicCount = privateProfiles[userCard] ? Object.keys(privateProfiles[userCard].topicSightings || {}).length : 0;
            if (topicCount > 1) badge = ` 🔄×${topicCount}`;
        }

        const container = document.createElement('div');
        container.className = 'fools-info';
        container.setAttribute('data-for', userCard);
        container.style.fontSize = '11px';
        container.style.color = isPrivate ? '#ff6b6b' : '#38bdf8';
        container.style.marginTop = '4px';
        container.style.lineHeight = '1.2';
        container.innerHTML = `
            <div><strong>[ID: ${escapeHtml(userCard)}]${isPrivate ? ' 🔒 PRIVATE' + badge : ''}</strong></div>
            <div>last seen: ${lastSeen}</div>
            <div>last post: ${lastPost}</div>
            <div>read time: ${readTime}</div>
            <div>trust level: ${maxTrust}</div>
        `;
        return container;
    }

    function showUserInfo(el, userCard) {
        const holder = el.parentNode;
        if (!holder) return;

        const existing = holder.querySelector(':scope > .fools-info');
        if (existing && existing.getAttribute('data-for') === userCard) {
            el.dataset.foolsUser = userCard;
            return;
        }

        if (el.dataset.foolsUser === userCard &&
            (el.dataset.foolsPending === 'true' || el.dataset.foolsFailed === userCard)) {
            return;
        }

        el.dataset.foolsUser = userCard;
        el.dataset.foolsPending = 'true';
        delete el.dataset.foolsFailed;
        if (existing) existing.remove();

        fetchProfile(userCard)
            .then(profile => {
                if (el.dataset.foolsUser !== userCard) return;
                delete el.dataset.foolsPending;
                const target = el.parentNode;
                if (!target) return;
                target.querySelectorAll(':scope > .fools-info').forEach(n => n.remove());
                target.appendChild(renderUserInfo(profile, userCard));
                updateMetrics();
            })
            .catch(err => {
                console.error('GD Forum Tools fetch error:', err);
                if (el.dataset.foolsUser !== userCard) return;
                delete el.dataset.foolsPending;
                el.dataset.foolsFailed = userCard;
                setTimeout(() => {
                    if (el.dataset.foolsFailed === userCard) delete el.dataset.foolsFailed;
                }, RETRY_MS);
            });
    }

    // --- COUNT EACH UNIQUE POST (article[data-post-id]) ONCE PER WEEK ---
    function inspectTopicUsers() {
        const topicId = getCurrentTopicId();
        if (!topicId) return;

        const weekNow = getSundayOfCurrentWeek();
        if (sessionWeek !== weekNow) {
            sessionWeek = weekNow;
            sessionSeenPosts.clear();
        }

        const topicTitle = document.title;
        const topicUrl = window.location.href;
        const newPosts = [];

        document.querySelectorAll('a.character-name').forEach(el => {
            const userCard = el.getAttribute('data-user-card');
            if (!userCard) return;

            const article = el.closest('article[data-post-id]');
            const postId = article ? article.getAttribute('data-post-id') : null;

            if (!postId) {
                if (!warnedNoPostId) {
                    warnedNoPostId = true;
                    console.warn('GD Forum Tools: no article[data-post-id] found for a.character-name, skipping sighting count.');
                }
            } else if (!sessionSeenPosts.has(postId) && article.querySelector('a.character-name') === el) {
                sessionSeenPosts.add(postId);
                newPosts.push({ userCard, postId });
            }

            showUserInfo(el, userCard);
        });

        if (newPosts.length > 0) {
            recordSightings(topicId, topicTitle, topicUrl, newPosts);
        }
    }

    function applyFilter() {
        const currentIgnores = getIgnoreList();
        if (currentIgnores.length === 0) return;

        const rows = document.querySelectorAll('table.topic-list tbody.topic-list-body tr.topic-list-item');

        rows.forEach(row => {
            if (row.dataset.foolsProcessed === 'true') return;

            let matched = false;
            let matchedCard = '';

            row.querySelectorAll('[data-user-card]').forEach(el => {
                const cardValue = el.getAttribute('data-user-card') || '';
                currentIgnores.forEach(ignore => {
                    if (cardValue.toLowerCase() === String(ignore).toLowerCase()) {
                        matched = true;
                        matchedCard = cardValue;
                    }
                });
            });

            if (!matched) return;

            row.dataset.foolsProcessed = 'true';
            stats.hidden++;

            row.innerHTML = `
                <td colspan="5" style="padding: 4px 0;">
                    <div class="fools-banner" style="
                        background: ${THEME.bg};
                        color: ${THEME.text};
                        padding: 10px 15px;
                        font-weight: bold;
                        border: 2px solid ${THEME.sky};
                        border-radius: 8px;
                        box-shadow: ${THEME.shadowSoft};
                        font-family: monospace;
                        width: 100%;
                        box-sizing: border-box;
                    ">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span>[ Have a Nice Day! (${escapeHtml(matchedCard)}) ]</span>
                            <button class="fools-btn fools-unignore-btn" data-card="${escapeHtml(matchedCard)}">Unignore to View</button>
                        </div>
                        <div class="fools-native-note" style="
                            display: none;
                            margin-top: 8px;
                            padding-top: 8px;
                            border-top: 1px solid ${THEME.sky};
                            font-family: sans-serif;
                            font-size: 11px;
                            font-weight: normal;
                            line-height: 1.5;
                        "></div>
                    </div>
                </td>
            `;

            styleButtons(row);

            const bannerDiv = row.querySelector('.fools-banner');
            if (bannerDiv) {
                bannerDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!e.target.closest('a')) e.preventDefault();
                });
            }

            const unignoreBtn = row.querySelector('.fools-unignore-btn');
            if (unignoreBtn) {
                unignoreBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const cardToUnignore = unignoreBtn.getAttribute('data-card');
                    const note = row.querySelector('.fools-native-note');

                    unignoreBtn.disabled = true;
                    const natives = await fetchNativeIgnores();
                    unignoreBtn.disabled = false;

                    const stillNative = !!natives && natives.some(n => String(n).toLowerCase() === cardToUnignore.toLowerCase());

                    if (stillNative && note) {
                        note.innerHTML = `
                            <div><strong>${escapeHtml(cardToUnignore)}</strong> is also on your Blizzard ignore list. That list is re-synced every time this page loads, so they would come straight back.</div>
                            <div style="margin-top: 4px;">1. <a href="${escapeHtml(getIgnorePrefsUrl(appUserId))}" target="_blank" rel="noopener noreferrer" style="color: ${THEME.sky}; font-weight: bold; text-decoration: underline;">Open your Blizzard ignore settings ↗</a> and remove <strong>${escapeHtml(cardToUnignore)}</strong>.</div>
                            <div>2. Come back here and click <strong>Unignore to View</strong> again.</div>
                        `;
                        note.style.display = 'block';
                        return;
                    }

                    let ignores = getIgnoreList();
                    ignores = ignores.filter(c => c.toLowerCase() !== cardToUnignore.toLowerCase());
                    localStorage.setItem('wow_ignore_list', JSON.stringify(ignores));

                    alert(`${cardToUnignore} is now unignored.`);
                    window.location.reload();
                });
            }
        });

        updateMetrics();
    }

    async function syncNativeIgnores() {
        const textarea = document.getElementById('fools-input');
        if (!appUserId) return;

        if (textarea) setStatus('Connecting to Blizzard profile...');

        try {
            const response = await fetch(`${window.location.origin}/en/wow/u/${appUserId}.json`);
            if (!response.ok) {
                if (textarea) setStatus('⚠️ Failed to fetch profile JSON.');
                return;
            }

            const data = await response.json();
            if (data && data.user) {
                updateAppUserStats(data.user);

                if (Array.isArray(data.user.ignored_usernames)) {
                    const nativeIgnores = data.user.ignored_usernames;

                    if (nativeIgnores.length > 0) {
                        if (textarea) setStatus(`✓ Synced ${nativeIgnores.length} user(s) from Blizzard!`);

                        const currentLines = textarea ? textarea.value.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : getIgnoreList();
                        const combined = [...new Set([...currentLines, ...nativeIgnores])];

                        if (textarea) textarea.value = combined.join('\n');
                        localStorage.setItem('wow_ignore_list', JSON.stringify(combined));
                        updateMetrics();
                        if (pageKind() === 'gd') applyFilter();
                    } else if (textarea) {
                        setStatus('✓ Connected (No native ignores found).');
                    }
                }
            }
        } catch (error) {
            if (textarea) setStatus('⚠️ Error syncing with Blizzard.');
        }
    }

    function renderIdBox() {
        const box = document.getElementById('fools-id-box');
        if (!box) return;

        if (appUserId) {
            box.innerHTML = `
                <div style="margin-bottom: 6px;"><strong>Logged In As:</strong></div>
                <div style="word-break: break-all; margin-bottom: 8px; font-family: monospace;">${escapeHtml(appUserId)}</div>
                <a id="fools-blizz-ignores" href="${escapeHtml(getIgnorePrefsUrl(appUserId))}" target="_blank" rel="noopener noreferrer" style="display: block; margin-bottom: 4px; color: ${THEME.sky}; font-size: 11px; font-weight: bold; text-decoration: underline;">Manage your Blizzard ignore list ↗</a>
                <div style="font-size: 10px; line-height: 1.4; opacity: 0.85; margin-bottom: 8px;">To stop ignoring someone for good, remove them on that page first, then click Unignore here.</div>
                <button id="fools-reset-id" class="fools-btn" style="width: 100%; font-size: 10px;">Reset User ID</button>
            `;
            styleButtons(box);
            document.getElementById('fools-reset-id').onclick = () => {
                if (confirm('Reset your Blizzard Forum User ID?')) {
                    localStorage.removeItem('wow_app_user_id');
                    appUserId = '';
                    renderIdBox();
                    setStatus('User ID cleared. Enter it again to sync Blizzard ignores.');
                }
            };
        } else {
            box.innerHTML = `
                <div style="margin-bottom: 6px;"><strong>Blizzard Forum User ID:</strong></div>
                <input id="fools-id-input" type="text" placeholder="e.g. panthra-2938857" style="
                    width: 100%;
                    box-sizing: border-box;
                    background: #1e1e1e;
                    color: ${THEME.text};
                    border: 1px solid ${THEME.sky};
                    border-radius: 4px;
                    padding: 6px 8px;
                    margin-bottom: 8px;
                    font-family: monospace;
                    font-size: 11px;
                ">
                <button id="fools-save-id" class="fools-btn" style="width: 100%; font-size: 10px;">Save User ID</button>
            `;
            styleButtons(box);

            const input = document.getElementById('fools-id-input');
            const save = () => {
                const val = input.value.trim();
                if (!val) {
                    setStatus('⚠️ Please enter your User ID first.');
                    return;
                }
                appUserId = val;
                localStorage.setItem('wow_app_user_id', val);
                renderIdBox();
                syncNativeIgnores();
            };
            document.getElementById('fools-save-id').onclick = save;
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') save();
            });
        }
    }

    function accountStatsHtml(weekly) {
        const initial = weekly.appUserInitial || { readTime: 0, trustLevel: 0 };
        const current = weekly.appUserCurrent || initial;
        const readTimeDiff = (current.readTime || 0) - (initial.readTime || 0);
        const trustChanged = current.trustLevel !== initial.trustLevel;
        const postsSeen = Object.values(weekly.users || {}).reduce((a, b) => a + (b.count || 0), 0);

        return `
            <h4 style="margin: 0 0 8px; color: ${THEME.sky}; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Your Account Stats</h4>
            <div style="font-size: 11px; line-height: 1.5; display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                <div title="Change in Blizzard's recent read time since your first check this week. It is a rolling window, so it can go down."><strong>Read Time Change:</strong> <span style="color: #38bdf8; font-family: monospace;">${formatSignedSeconds(readTimeDiff)}</span></div>
                <div><strong>Topics Engaged:</strong> <span style="font-family: monospace;">${(weekly.topicsEngaged || []).length}</span></div>
                <div><strong>Trust Level:</strong> <span style="font-family: monospace;">${current.trustLevel || 0} ${trustChanged ? `(was ${initial.trustLevel || 0})` : ''}</span></div>
                <div><strong>Posts Seen:</strong> <span style="font-family: monospace;">${postsSeen}</span></div>
            </div>
        `;
    }

    async function refreshAppUserStats() {
        if (!appUserId) return;
        try {
            const res = await fetch(`${window.location.origin}/en/wow/u/${appUserId}.json`);
            if (!res.ok) return;
            const data = await res.json();
            if (data && data.user) updateAppUserStats(data.user);
        } catch (e) {}
    }

    function showLeaderboard() {
        const weekly = getWeeklyData();
        const weekStart = weekly.weekStart;

        const userEntries = Object.entries(weekly.users || {}).map(([card, obj]) => ({
            card,
            count: obj.count,
            uniqueTopics: Object.keys(obj.topics || {}).length
        })).sort((a, b) => b.count - a.count).slice(0, 10);

        const top10Cards = new Set(userEntries.map(u => u.card));

        const privateLog = readJSON('wow_private_profiles', {});
        const isPrivateCard = (card) =>
            !!privateLog && typeof privateLog === 'object' && !Array.isArray(privateLog) &&
            Object.prototype.hasOwnProperty.call(privateLog, card);

        const topicScores = {};
        for (const [topicId, tObj] of Object.entries(weekly.topics || {})) {
            let score = 0;
            for (const [uCard, sightings] of Object.entries(tObj.users || {})) {
                if (top10Cards.has(uCard)) score += sightings;
            }
            if (score > 0) {
                topicScores[topicId] = { ...tObj, score };
            }
        }

        const topTopics = Object.values(topicScores).sort((a, b) => b.score - a.score).slice(0, 3);

        let html = `
            <div id="leaderboardHeader">
                <h3 style="margin: 0 0 4px; color: ${THEME.text}; text-align: center;">Weekly Forum Wrap-Up</h3>
                <p style="margin: 0 0 16px; text-align: center; font-size: 11px; opacity: 0.8;">Week of Sunday, ${weekStart}</p>
            </div>

            <div id="lbAccountStats" style="background: #1e1e1e; border: 1px solid ${THEME.sky}; border-radius: 6px; padding: 12px; margin-bottom: 16px;">
                ${accountStatsHtml(weekly)}
            </div>

            <div style="margin-bottom: 16px;">
                <h4 style="margin: 0 0 8px; color: ${THEME.sky}; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Top 10 Most Seen Users</h4>
                ${userEntries.length === 0 ? '<div style="font-size: 11px; opacity: 0.7;">No sightings recorded yet this week.</div>' : `
                    <div style="font-size: 10px; opacity: 0.7; margin: -4px 0 8px;">Click a name to open its profile data (raw JSON) in a new tab. 🔒 = private profile.</div>
                    <table style="width: 100%; font-size: 11px; border-collapse: collapse;">
                        <thead>
                            <tr style="border-bottom: 1px solid ${THEME.sky}; text-align: left; opacity: 0.8;">
                                <th style="padding: 4px;">#</th>
                                <th style="padding: 4px;">User Card</th>
                                <th style="padding: 4px; text-align: right;">Posts</th>
                                <th style="padding: 4px; text-align: right;">Topics</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${userEntries.map((u, idx) => `
                                <tr style="border-bottom: 1px solid #222;">
                                    <td style="padding: 4px; font-family: monospace;">${idx + 1}</td>
                                    <td style="padding: 4px; font-family: monospace;"><a href="${escapeHtml(getProfileJsonUrl(u.card))}" target="_blank" rel="noopener noreferrer" title="Open ${escapeHtml(u.card)}'s profile data (JSON) in a new tab" style="color: #38bdf8; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 3px;">${escapeHtml(u.card)}</a>${isPrivateCard(u.card) ? ' <span class="fools-lock" title="Private profile: last seen and last post are hidden" style="cursor: help;">🔒</span>' : ''}</td>
                                    <td style="padding: 4px; text-align: right; font-family: monospace;">${u.count}</td>
                                    <td style="padding: 4px; text-align: right; font-family: monospace;">${u.uniqueTopics}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `}
            </div>

            <div style="margin-bottom: 16px;">
                <h4 style="margin: 0 0 8px; color: ${THEME.sky}; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Top 3 Shared Topics (Top Users Hub)</h4>
                ${topTopics.length === 0 ? '<div style="font-size: 11px; opacity: 0.7;">No shared topic intersections yet.</div>' : `
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        ${topTopics.map((t, idx) => `
                            <div style="background: #191919; border: 1px solid #333; padding: 8px; border-radius: 4px; font-size: 11px;">
                                <div style="font-weight: bold; margin-bottom: 4px;">${idx + 1}. <a href="${escapeHtml(t.url)}" target="_blank" rel="noopener noreferrer" style="color: #38bdf8; text-decoration: none;">${escapeHtml(t.title)}</a></div>
                                <div style="opacity: 0.75; font-size: 10px;">Intersection Score: ${t.score} top-user posts across ${t.count} posts seen</div>
                            </div>
                        `).join('')}
                    </div>
                `}
            </div>
        `;

        const oldLb = document.getElementById('fools-lb-modal');
        if (oldLb) oldLb.remove();

        const lbModal = document.createElement('div');
        lbModal.id = 'fools-lb-modal';
        lbModal.style.cssText = modalCss(`
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 9999999;
            width: 550px;
            max-width: calc(100vw - 40px);
            max-height: 80vh;
            overflow-y: auto;
        `);

        lbModal.innerHTML = html + `
            <button id="lbClose" class="fools-btn" style="width: 100%; margin-top: 12px;">Close</button>
        `;

        document.body.appendChild(lbModal);
        styleButtons(lbModal);
        makeDraggable(lbModal, lbModal.querySelector('#leaderboardHeader'));

        lbModal.querySelector('#lbClose').addEventListener('click', () => lbModal.remove());

        refreshAppUserStats().then(() => {
            const box = document.getElementById('lbAccountStats');
            if (box) box.innerHTML = accountStatsHtml(getWeeklyData());
        });
    }

    function showReport() {
        const privateProfiles = readJSON('wow_private_profiles', {});

        const fmt = (iso) => {
            const d = iso ? new Date(iso) : null;
            return d && !isNaN(d) ? d.toLocaleString() : 'N/A';
        };

        let report = 'PRIVATE PROFILE TRACKING\n';
        report += '='.repeat(70) + '\n\n';

        const count = Object.keys(privateProfiles).length;
        if (count === 0) {
            report += 'No private profiles tracked yet.\n';
        } else {
            for (const [userCard, data] of Object.entries(privateProfiles)) {
                const sightings = Array.isArray(data.sightings) ? data.sightings : [];
                const firstByTopic = new Map();
                sightings.forEach(s => {
                    if (!firstByTopic.has(s.topicId)) firstByTopic.set(s.topicId, s);
                });

                report += `[${userCard}]\n`;
                report += `  First Seen: ${fmt(data.firstSeen)}\n`;
                report += `  Last Seen: ${fmt(data.lastSeen)}\n`;
                report += `  Total Sightings: ${sightings.length}\n`;

                const topicIds = Object.keys(data.topicSightings || {});
                if (topicIds.length > 0) {
                    report += `  Seen in ${topicIds.length} unique topic(s):\n`;
                    topicIds.forEach((topicId, idx) => {
                        const sighting = firstByTopic.get(topicId);
                        report += `    ${idx + 1}. ${topicId}\n`;
                        if (sighting) {
                            report += `       Title: ${sighting.topicTitle}\n`;
                            report += `       URL: ${sighting.topicUrl}\n`;
                        }
                    });
                }

                if (Array.isArray(data.altNames) && data.altNames.length > 0) {
                    report += `  Possible Alts: ${data.altNames.join(', ')}\n`;
                }
                report += '\n';
            }
        }

        const oldReport = document.getElementById('fools-report-modal');
        if (oldReport) oldReport.remove();

        const reportModal = document.createElement('div');
        reportModal.id = 'fools-report-modal';
        reportModal.style.cssText = modalCss(`
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 9999999;
            width: 700px;
            max-width: calc(100vw - 40px);
            max-height: 600px;
            overflow-y: auto;
        `);

        reportModal.innerHTML = `
            <div id="reportHeader">
                <h3 style="margin: 0 0 12px; color: ${THEME.text};">Private Profile Log (${count} users)</h3>
            </div>
            <textarea id="reportText" readonly style="
                width: 100%;
                height: 400px;
                background: #1e1e1e;
                color: ${THEME.text};
                border: 1px solid ${THEME.sky};
                border-radius: 4px;
                padding: 8px;
                box-sizing: border-box;
                font-family: monospace;
                font-size: 10px;
            "></textarea>
            <div style="margin-top: 12px; display: flex; gap: 8px;">
                <button id="reportClose" class="fools-btn" style="flex: 1;">Close</button>
                <button id="reportCopy" class="fools-btn" style="flex: 1;">Copy</button>
            </div>
        `;

        document.body.appendChild(reportModal);

        const reportText = reportModal.querySelector('#reportText');
        reportText.value = report;

        styleButtons(reportModal);
        makeDraggable(reportModal, reportModal.querySelector('#reportHeader'));

        reportModal.querySelector('#reportClose').addEventListener('click', () => reportModal.remove());

        reportModal.querySelector('#reportCopy').addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(reportText.value);
            } catch (e) {
                reportText.select();
                document.execCommand('copy');
            }
            alert('Copied to clipboard!');
        });
    }

    function todayStamp() {
        const n = new Date();
        return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    }

    function downloadFile(filename, content, mime) {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    function setButtonEnabled(btn, enabled) {
        btn.disabled = !enabled;
        btn.style.opacity = enabled ? '1' : '0.45';
        btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
    }

    function getDataSummary() {
        const priv = readJSON('wow_private_profiles', {});
        const privCount = priv && typeof priv === 'object' && !Array.isArray(priv) ? Object.keys(priv).length : 0;
        const wk = readJSON('wow_weekly_leaderboard', null);
        let posts = 0;
        if (wk && wk.users && typeof wk.users === 'object') {
            posts = Object.values(wk.users).reduce((a, u) => a + ((u && u.count) || 0), 0);
        }
        return {
            ignores: getIgnoreList().length,
            privCount,
            weekStart: wk && wk.weekStart ? wk.weekStart : null,
            posts,
            userId: (localStorage.getItem('wow_app_user_id') || '').trim()
        };
    }

    function buildBackup() {
        const data = {};
        DATA_KEYS.forEach(key => {
            const raw = localStorage.getItem(key);
            if (raw === null) return;
            if (JSON_KEYS.has(key)) {
                try {
                    data[key] = JSON.parse(raw);
                } catch (e) {
                    console.warn('GD Forum Tools: skipped unreadable data for ' + key);
                }
            } else {
                data[key] = raw;
            }
        });
        return {
            app: 'GD Forum Tools',
            backupVersion: 1,
            scriptVersion: VERSION,
            createdAt: new Date().toISOString(),
            data
        };
    }

    function normalizeBackupValue(key, val) {
        if (val === null || val === undefined) return { skip: true };
        const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

        if (JSON_KEYS.has(key) && typeof val === 'string') {
            try {
                val = JSON.parse(val);
            } catch (e) {
                return { error: 'is not valid JSON' };
            }
        }

        if (key === 'wow_app_user_id') {
            if (typeof val !== 'string' || !val.trim() || val.length > 100) return { error: 'is not a valid User ID' };
            return { value: val.trim() };
        }
        if (key === 'wow_ignore_list') {
            if (!Array.isArray(val)) return { error: 'is not a list' };
            return { value: val.filter(v => v !== null && v !== undefined).map(v => String(v).trim()).filter(Boolean) };
        }
        if (key === 'wow_private_profiles') {
            if (!isObj(val)) return { error: 'is not an object' };
            if (!Object.values(val).every(isObj)) return { error: 'contains invalid entries' };
            return { value: val };
        }
        if (key === 'wow_weekly_leaderboard') {
            if (!isObj(val) || typeof val.weekStart !== 'string' || !isObj(val.users) || !isObj(val.topics)) {
                return { error: 'is not a leaderboard' };
            }
            if (val.weekStart !== getSundayOfCurrentWeek()) {
                return { error: `is from the week of ${val.weekStart} (only the current week is kept)` };
            }
            val.topicsEngaged = Array.isArray(val.topicsEngaged) ? val.topicsEngaged : [];
            val.seenPosts = isObj(val.seenPosts) ? val.seenPosts : {};
            return { value: val };
        }
        if (key === 'wow_fools_minimized') {
            const v = String(val);
            return v === '0' || v === '1' ? { value: v } : { error: 'is not 0 or 1' };
        }
        return { skip: true };
    }

    function parseBackupText(text) {
        let obj;
        try {
            obj = JSON.parse(text);
        } catch (e) {
            return { error: 'That file is not valid JSON.' };
        }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
            return { error: 'That file is not a GD Forum Tools backup.' };
        }

        const hasWrapper = !!obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data);
        if (hasWrapper && obj.app && obj.app !== 'GD Forum Tools') {
            return { error: 'That file was not made by GD Forum Tools.' };
        }
        const payload = hasWrapper ? obj.data : obj;

        const entries = {};
        const skipped = [];
        DATA_KEYS.forEach(key => {
            if (!(key in payload)) return;
            const res = normalizeBackupValue(key, payload[key]);
            if (res.error) skipped.push(`${DATA_LABELS[key]} ${res.error}`);
            else if (!res.skip) entries[key] = res.value;
        });

        if (Object.keys(entries).length === 0) {
            return { error: skipped.length ? 'Nothing in that file could be restored: ' + skipped.join('; ') : 'No GD Forum Tools data found in that file.' };
        }

        return {
            entries,
            skipped,
            meta: hasWrapper ? { createdAt: obj.createdAt || null } : { createdAt: null }
        };
    }

    function describeEntry(key, value) {
        if (key === 'wow_app_user_id') return `Blizzard User ID: ${value}`;
        if (key === 'wow_ignore_list') return `Ignore list: ${value.length} user(s)`;
        if (key === 'wow_private_profiles') return `Private profile log: ${Object.keys(value).length} profile(s)`;
        if (key === 'wow_weekly_leaderboard') {
            const posts = Object.values(value.users).reduce((a, u) => a + ((u && u.count) || 0), 0);
            return `Weekly leaderboard: week of ${value.weekStart}, ${posts} post(s)`;
        }
        return `Window state: ${value === '1' ? 'minimized' : 'open'}`;
    }

    function applyRestore(entries) {
        const previous = {};
        DATA_KEYS.forEach(k => { previous[k] = localStorage.getItem(k); });
        try {
            Object.entries(entries).forEach(([key, value]) => {
                localStorage.setItem(key, JSON_KEYS.has(key) ? JSON.stringify(value) : String(value));
            });
            return true;
        } catch (e) {
            DATA_KEYS.forEach(k => {
                try {
                    if (previous[k] === null) localStorage.removeItem(k);
                    else localStorage.setItem(k, previous[k]);
                } catch (err) {}
            });
            return false;
        }
    }

    function buildLeaderboardExport() {
        const weekly = readJSON('wow_weekly_leaderboard', null);
        if (!weekly || typeof weekly !== 'object' || !weekly.users) return null;

        const users = Object.entries(weekly.users)
            .map(([userCard, u]) => ({
                userCard,
                posts: (u && u.count) || 0,
                topics: Object.keys((u && u.topics) || {}).length
            }))
            .sort((a, b) => b.posts - a.posts);

        const topics = Object.entries(weekly.topics || {})
            .map(([topicId, t]) => ({
                topicId,
                title: (t && t.title) || topicId,
                url: (t && t.url) || '',
                posts: (t && t.count) || 0,
                uniqueUsers: Object.keys((t && t.users) || {}).length,
                users: (t && t.users) || {}
            }))
            .sort((a, b) => b.posts - a.posts);

        if (users.length === 0 && topics.length === 0) return null;

        const initial = weekly.appUserInitial || null;
        const current = weekly.appUserCurrent || initial;

        return {
            app: 'GD Forum Tools',
            exportType: 'weekly-leaderboard',
            scriptVersion: VERSION,
            exportedAt: new Date().toISOString(),
            weekStart: weekly.weekStart || null,
            isCurrentWeek: weekly.weekStart === getSundayOfCurrentWeek(),
            account: {
                userId: appUserId || null,
                readTimeChangeSeconds: initial && current ? (current.readTime || 0) - (initial.readTime || 0) : 0,
                trustLevelStart: initial ? initial.trustLevel : null,
                trustLevelNow: current ? current.trustLevel : null,
                topicsEngaged: Array.isArray(weekly.topicsEngaged) ? weekly.topicsEngaged.length : 0
            },
            totals: {
                postsSeen: users.reduce((a, u) => a + u.posts, 0),
                uniqueUsers: users.length,
                topics: topics.length
            },
            users,
            topics
        };
    }

    function exportPrivateCsv() {
        const privateProfiles = readJSON('wow_private_profiles', {});
        const entries = Object.entries(privateProfiles);
        if (entries.length === 0) return null;

        const q = (v) => `"${String(v === undefined || v === null ? '' : v).replace(/"/g, '""')}"`;
        let csv = 'UserCard,FirstSeen,LastSeen,TotalSightings,UniqueTopics,Topics,Alts\n';

        entries.forEach(([userCard, raw]) => {
            const data = raw || {};
            const alts = Array.isArray(data.altNames) ? data.altNames.join(';') : '';
            const total = Array.isArray(data.sightings) ? data.sightings.length : 0;
            const topicIds = data.topicSightings ? Object.keys(data.topicSightings) : [];
            csv += [q(userCard), q(data.firstSeen), q(data.lastSeen), total, topicIds.length, q(topicIds.join(';')), q(alts)].join(',') + '\n';
        });

        const filename = `wow-private-profiles-${todayStamp()}.csv`;
        downloadFile(filename, csv, 'text/csv;charset=utf-8;');
        return { filename, count: entries.length };
    }

    function showDataManager() {
        const old = document.getElementById('fools-data-modal');
        if (old) old.remove();

        const sum = getDataSummary();
        const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
        const lines = {
            wow_ignore_list: `Ignore list (${plural(sum.ignores, 'user')})`,
            wow_private_profiles: `Private profile log (${plural(sum.privCount, 'profile')})`,
            wow_weekly_leaderboard: sum.weekStart ? `Weekly leaderboard (week of ${sum.weekStart}, ${plural(sum.posts, 'post')})` : 'Weekly leaderboard (empty)',
            wow_app_user_id: sum.userId ? `Blizzard User ID (${sum.userId})` : 'Blizzard User ID (not saved)'
        };

        const dm = document.createElement('div');
        dm.id = 'fools-data-modal';
        dm.style.cssText = modalCss(`
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 9999999;
            width: 460px;
            max-width: calc(100vw - 40px);
            max-height: 85vh;
            overflow-y: auto;
        `);

        const heading = (t) => `<div style="font-size: 10px; letter-spacing: 1px; text-transform: uppercase; opacity: 0.7; margin: 16px 0 6px;">${t}</div>`;
        const wipeRow = (key) => `
            <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; cursor: pointer;">
                <input type="checkbox" class="fools-wipe-box" data-key="${key}" data-line="${escapeHtml(lines[key])}" style="accent-color: ${THEME.sky}; margin: 0;">
                <span>${escapeHtml(lines[key])}</span>
            </label>`;

        dm.innerHTML = `
            <div id="dataHeader" style="display: flex; align-items: center; justify-content: space-between;">
                <h3 style="margin: 0; font-size: 16px; letter-spacing: 1px; text-transform: uppercase; color: ${THEME.text};">Manage Data</h3>
                <button id="dataClose" class="fools-btn" title="Close">×</button>
            </div>
            <p style="margin: 6px 0 0; font-size: 11px; line-height: 1.4; opacity: 0.85;">Everything is stored in this browser only. Make a backup before you wipe data or switch browsers.</p>

            ${heading('Backup &amp; restore')}
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <button id="dataBackup" class="fools-btn">💾 Backup All Data</button>
                <button id="dataRestore" class="fools-btn">📂 Restore From Backup…</button>
            </div>
            <input id="dataRestoreFile" type="file" accept=".json,application/json" style="display: none;">

            ${heading('Export')}
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <button id="dataExportLb" class="fools-btn">🏆 Leaderboard (.json)</button>
                <button id="dataExportCsv" class="fools-btn">📥 Private Log (.csv)</button>
            </div>

            ${heading('Wipe data')}
            <div style="border: 1px solid ${THEME.sky}; border-radius: 6px; padding: 10px; font-size: 11px;">
                <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-weight: bold; cursor: pointer;">
                    <input type="checkbox" id="dataWipeAll" style="accent-color: ${THEME.sky}; margin: 0;">
                    <span>Everything</span>
                </label>
                ${wipeRow('wow_ignore_list')}
                ${wipeRow('wow_private_profiles')}
                ${wipeRow('wow_weekly_leaderboard')}
                ${wipeRow('wow_app_user_id')}
                <button id="dataWipe" class="fools-btn" style="width: 100%; margin-top: 6px;">🗑️ Wipe Selected</button>
            </div>

            <div id="dataStatus" style="margin-top: 12px; font-size: 11px; font-family: monospace; line-height: 1.4; min-height: 14px;"></div>
        `;

        document.body.appendChild(dm);
        styleButtons(dm);

        const closeBtn = dm.querySelector('#dataClose');
        closeBtn.style.padding = '0';
        closeBtn.style.width = '22px';
        closeBtn.style.height = '22px';
        closeBtn.style.borderRadius = '50%';
        closeBtn.style.fontSize = '13px';
        closeBtn.style.lineHeight = '20px';
        closeBtn.addEventListener('click', () => dm.remove());

        makeDraggable(dm, dm.querySelector('#dataHeader'));

        const setStatus2 = (text) => {
            const el = dm.querySelector('#dataStatus');
            if (el) el.textContent = text;
        };

        dm.querySelector('#dataBackup').addEventListener('click', () => {
            const backup = buildBackup();
            if (Object.keys(backup.data).length === 0) {
                setStatus2('⚠️ Nothing to back up yet.');
                return;
            }
            const filename = `gd-forum-tools-backup-${todayStamp()}.json`;
            downloadFile(filename, JSON.stringify(backup, null, 2), 'application/json');
            setStatus2(`✓ Backup saved: ${filename}`);
        });

        dm.querySelector('#dataExportLb').addEventListener('click', () => {
            const out = buildLeaderboardExport();
            if (!out) {
                setStatus2('⚠️ No leaderboard data yet. Browse a few topics first.');
                return;
            }
            const filename = `gd-forum-tools-leaderboard-${out.weekStart || todayStamp()}.json`;
            downloadFile(filename, JSON.stringify(out, null, 2), 'application/json');
            setStatus2(`✓ Leaderboard exported: ${filename}`);
        });

        dm.querySelector('#dataExportCsv').addEventListener('click', () => {
            const res = exportPrivateCsv();
            if (!res) {
                setStatus2('⚠️ No private profiles logged yet.');
                return;
            }
            setStatus2(`✓ Exported ${res.count} profile(s): ${res.filename}`);
        });

        const fileInput = dm.querySelector('#dataRestoreFile');
        dm.querySelector('#dataRestore').addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) return;

            if (file.size > 10 * 1024 * 1024) {
                setStatus2('⚠️ That file is too large to be a backup.');
                fileInput.value = '';
                return;
            }

            const reader = new FileReader();
            reader.onerror = () => setStatus2('⚠️ Could not read that file.');
            reader.onload = () => {
                fileInput.value = '';
                const res = parseBackupText(String(reader.result));
                if (res.error) {
                    setStatus2('⚠️ ' + res.error);
                    return;
                }

                const listed = Object.entries(res.entries).map(([k, v]) => '  - ' + describeEntry(k, v)).join('\n');
                const skippedText = res.skipped.length ? `\n\nSkipped:\n${res.skipped.map(x => '  - ' + x).join('\n')}` : '';
                const when = res.meta.createdAt ? ` (made ${new Date(res.meta.createdAt).toLocaleString()})` : '';

                if (!confirm(`Restore from "${file.name}"${when}?\n\nThis will overwrite your current:\n${listed}${skippedText}\n\nAnything not listed is left alone.`)) {
                    setStatus2('Restore cancelled. Nothing was changed.');
                    return;
                }

                if (!applyRestore(res.entries)) {
                    setStatus2('⚠️ Restore failed (browser storage may be full). Your previous data was put back.');
                    return;
                }

                alert('Backup restored. Reloading page...');
                window.location.reload();
            };
            reader.readAsText(file);
        });

        const boxes = [...dm.querySelectorAll('.fools-wipe-box')];
        const wipeAll = dm.querySelector('#dataWipeAll');
        const wipeBtn = dm.querySelector('#dataWipe');

        const refreshWipe = () => {
            const picked = boxes.filter(b => b.checked).length;
            wipeAll.checked = picked === boxes.length;
            setButtonEnabled(wipeBtn, picked > 0);
            wipeBtn.textContent = picked > 0 ? `🗑️ Wipe Selected (${picked})` : '🗑️ Wipe Selected';
        };

        wipeAll.addEventListener('change', () => {
            boxes.forEach(b => { b.checked = wipeAll.checked; });
            refreshWipe();
        });
        boxes.forEach(b => b.addEventListener('change', refreshWipe));
        refreshWipe();

        wipeBtn.addEventListener('click', () => {
            const picked = boxes.filter(b => b.checked);
            if (picked.length === 0) return;

            const listed = picked.map(b => '  - ' + b.getAttribute('data-line')).join('\n');
            if (!confirm(`Permanently delete the following?\n\n${listed}\n\nThis cannot be undone. Tip: use Backup All Data first.`)) {
                setStatus2('Wipe cancelled. Nothing was deleted.');
                return;
            }

            picked.forEach(b => localStorage.removeItem(b.getAttribute('data-key')));
            if (picked.length === boxes.length) localStorage.removeItem('wow_fools_minimized');

            alert('Selected data wiped. Reloading page...');
            window.location.reload();
        });
    }

    function setMinimized(min) {
        localStorage.setItem('wow_fools_minimized', min ? '1' : '0');

        if (min && modal && pill) {
            const rect = modal.getBoundingClientRect();
            pill.style.left = 'auto';
            pill.style.top = Math.max(0, rect.top) + 'px';
            pill.style.right = Math.max(0, window.innerWidth - rect.right) + 'px';
        }
        syncVisibility();
    }

    function syncVisibility() {
        const kind = pageKind();
        const minimized = localStorage.getItem('wow_fools_minimized') === '1';

        if (modal) modal.style.display = kind && !minimized ? 'block' : 'none';
        if (pill) pill.style.display = kind && minimized ? 'block' : 'none';
        if (legend) {
            const showLegend = legendOpen && kind && !minimized;
            legend.style.display = showLegend ? 'block' : 'none';
            if (showLegend) {
                positionLegend();
                renderLegend();
            }
        }
        if (kind && !minimized) updateMetrics();
    }

    function buildUi() {
        if (modal) return;

        appUserId = (localStorage.getItem('wow_app_user_id') || '').trim();
        const savedIgnores = getIgnoreList();

        modal = document.createElement('div');
        modal.id = 'fools-filter-modal';
        modal.style.cssText = modalCss(`
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 999999;
            width: 420px;
            max-width: calc(100vw - 40px);
            max-height: 80vh;
            overflow-y: auto;
            display: none;
        `);

        modal.innerHTML = `
            <div style="position: relative; padding-bottom: 12px;">
                <div id="fools-header">
                    <button id="fools-legend-btn" class="fools-btn" title="Show / hide the icon legend" style="position: absolute; top: 10px; left: 12px;">?</button>
                    <div id="fools-metrics" title="Click for the legend" style="
                        cursor: pointer;
                        position: absolute;
                        top: -10px;
                        right: 0px;
                        display: grid;
                        grid-template-columns: auto auto;
                        gap: 5px 10px;
                        font-family: monospace;
                        font-size: 12px;
                        color: ${THEME.sky};
                        text-align: left;
                    "></div>
                    <h3 style="
                        margin: 0;
                        text-align: center;
                        color: ${THEME.text};
                        font-size: 18px;
                        font-weight: bold;
                        letter-spacing: 1px;
                        white-space: nowrap;
                        text-transform: uppercase;
                    ">GD Forum Tools</h3>
                    <p style="margin: 4px 0 14px; text-align: center; font-size: 11px; color: ${THEME.text};">©MIT Lazyeyez</p>
                </div>

                <div id="fools-id-box" style="border: 1px solid ${THEME.sky}; border-radius: 4px; padding: 10px; margin-bottom: 12px; font-size: 11px;"></div>

                <p style="font-size: 12px; margin: 0 0 6px;">Enter the Users ID you wish to ignore</p>

                <div id="fools-status" style="font-size: 11px; margin-bottom: 8px; font-family: monospace;"></div>

                <textarea id="fools-input" style="
                    width: 100%;
                    height: 100px;
                    background: #1e1e1e;
                    color: ${THEME.text};
                    border: 1px solid ${THEME.sky};
                    border-radius: 4px;
                    padding: 8px;
                    box-sizing: border-box;
                    font-family: monospace;
                "></textarea>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px;">
                    <button id="fools-save" class="fools-btn">Save / Run</button>
                    <button id="fools-close" class="fools-btn">Minimize</button>
                    <button id="fools-view-leaderboard" class="fools-btn">🏆 Weekly LB</button>
                    <button id="fools-view-private" class="fools-btn">📋 Private Log</button>
                    <button id="fools-manage-data" class="fools-btn" style="grid-column: 1 / -1;">🗂️ Manage Data</button>
                </div>

                <div style="position: absolute; bottom: -8px; right: 2px; font-size: 9px; color: #ffd700; font-family: monospace; pointer-events: none;">v${VERSION}</div>
            </div>
        `;

        document.body.appendChild(modal);

        pill = document.createElement('div');
        pill.id = 'fools-pill';
        pill.title = 'GD Forum Tools (click to open, drag to move)';
        pill.textContent = '🛡️ GD';
        pill.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 999999;
            background: ${THEME.navy};
            color: ${THEME.text};
            border: 2px solid ${THEME.sky};
            border-radius: 16px;
            box-shadow: ${THEME.shadow};
            box-sizing: border-box;
            font-family: sans-serif;
            font-size: 12px;
            font-weight: bold;
            padding: 6px 12px;
            cursor: pointer;
            display: none;
            user-select: none;
        `;
        document.body.appendChild(pill);

        legend = document.createElement('div');
        legend.id = 'fools-legend';
        legend.style.cssText = modalCss(`
            position: fixed;
            top: 20px;
            left: 8px;
            z-index: 999999;
            width: 300px;
            max-width: calc(100vw - 16px);
            max-height: 80vh;
            overflow-y: auto;
            padding: 14px;
            display: none;
        `);
        legend.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                <h4 style="margin: 0; font-size: 13px; letter-spacing: 1px; text-transform: uppercase; color: ${THEME.text};">Legend</h4>
                <button id="fools-legend-close" class="fools-btn" title="Close legend">×</button>
            </div>
            <div style="font-size: 10px; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 6px; opacity: 0.7;">Modal counters</div>
            <div id="fools-legend-rows"></div>
            <div style="border-top: 1px solid ${THEME.sky}; margin: 10px 0 8px; padding-top: 8px; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; opacity: 0.7;">On topic pages</div>
            <div style="font-size: 11px; line-height: 1.4; margin-bottom: 6px;"><span style="color: #38bdf8; font-weight: bold;">Blue text</span> - normal profile: last seen, last post, read time and trust level.</div>
            <div style="font-size: 11px; line-height: 1.4; margin-bottom: 6px;"><span style="color: #ff6b6b; font-weight: bold;">Red text + 🔒 PRIVATE</span> - last seen and last post are both hidden.</div>
            <div style="font-size: 11px; line-height: 1.4; margin-bottom: 6px;"><strong>🔄×N</strong> - that private profile has been spotted in N different topics.</div>
            <div style="font-size: 11px; line-height: 1.4; margin-bottom: 6px;"><strong>🔒 in the leaderboard</strong> - private profile. Names link to the raw profile JSON.</div>
            <div style="border-top: 1px solid ${THEME.sky}; margin: 10px 0 8px; padding-top: 8px; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; opacity: 0.7;">On the topic list</div>
            <div style="font-size: 11px; line-height: 1.4;"><strong>[ Have a Nice Day! ]</strong> - the author is on your ignore list. Unignore to View restores the row. If they are also on your Blizzard ignore list, remove them there first (link in the modal).</div>
        `;
        document.body.appendChild(legend);

        document.getElementById('fools-input').value = Array.isArray(savedIgnores) ? savedIgnores.join('\n') : '';
        styleButtons(modal);
        styleButtons(legend);
        [document.getElementById('fools-legend-btn'), document.getElementById('fools-legend-close')].forEach(b => {
            b.style.padding = '0';
            b.style.width = '22px';
            b.style.height = '22px';
            b.style.borderRadius = '50%';
            b.style.fontSize = '13px';
            b.style.lineHeight = '20px';
        });
        makeDraggable(modal, document.getElementById('fools-header'), positionLegend);
        makeDraggable(pill);
        renderIdBox();
        updateMetrics();

        pill.addEventListener('click', () => {
            if (pill.__dragged) {
                pill.__dragged = false;
                return;
            }
            setMinimized(false);
        });

        document.getElementById('fools-legend-btn').onclick = () => setLegendOpen(!legendOpen);
        document.getElementById('fools-legend-close').onclick = () => setLegendOpen(false);
        document.getElementById('fools-metrics').addEventListener('click', () => {
            if (modal.__dragged) {
                modal.__dragged = false;
                return;
            }
            setLegendOpen(!legendOpen);
        });

        document.getElementById('fools-close').onclick = () => setMinimized(true);

        document.getElementById('fools-save').onclick = () => {
            const newList = document.getElementById('fools-input').value
                .split(/[\n,]+/)
                .map(s => s.trim())
                .filter(Boolean);

            localStorage.setItem('wow_ignore_list', JSON.stringify(newList));
            setStatus(`✓ Saved ${newList.length} user(s) and ran filter.`);
            tick();
        };

        document.getElementById('fools-view-leaderboard').onclick = showLeaderboard;
        document.getElementById('fools-view-private').onclick = showReport;
        document.getElementById('fools-manage-data').onclick = showDataManager;

        if (appUserId) {
            syncNativeIgnores();
        } else {
            setStatus('Enter your User ID to sync Blizzard ignores.');
        }
    }

    function tick() {
        tickTimer = null;
        if (!document.body) return;

        const safely = (label, fn) => {
            try {
                fn();
            } catch (err) {
                console.error(`GD Forum Tools ${label} error:`, err);
            }
        };

        const kind = pageKind();
        if (kind) safely('ui', buildUi);
        safely('visibility', syncVisibility);

        if (kind === 'topic') safely('inspector', inspectTopicUsers);
        if (kind === 'gd') safely('filter', applyFilter);
    }

    function schedule(mutations) {
        if (Array.isArray(mutations) && mutations.length) {
            const onlyOurs = mutations.every(m => {
                const node = m.target.nodeType === 1 ? m.target : m.target.parentElement;
                return node && node.closest && node.closest('#fools-filter-modal, #fools-report-modal, #fools-lb-modal, #fools-data-modal, #fools-pill, #fools-legend');
            });
            if (onlyOurs) return;
        }
        if (!tickTimer) tickTimer = setTimeout(tick, 250);
    }

    new MutationObserver(schedule).observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-user-card']
    });
    window.addEventListener('popstate', () => schedule());
    setInterval(() => schedule(), 5000);

    tick();
})();
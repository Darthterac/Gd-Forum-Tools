// ==UserScript==
// @name         GD Forum Tools
// @namespace    lazyeyez.gdforumtools
// @version      11.6
// @description  Ignore list, topic user data, private profile log, metrics, weekly leaderboard (unique posts per week), a Manage Data panel (backup, restore, exports, selective wipe), per-post star ratings, leaderboard avatars and names, Low Rated & Ignored list with clipboard copy and preference modals, polite request limiting, and version tag.
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
    const VERSION = '11.6';
    const RETRY_MS = 30000;
    const DATA_KEYS = ['wow_app_user_id', 'wow_ignore_list', 'wow_private_profiles', 'wow_weekly_leaderboard', 'wow_post_ratings', 'wow_fools_minimized'];
    const JSON_KEYS = new Set(['wow_ignore_list', 'wow_private_profiles', 'wow_weekly_leaderboard', 'wow_post_ratings']);
    const DATA_LABELS = {
        wow_app_user_id: 'Blizzard User ID',
        wow_ignore_list: 'Ignore list',
        wow_private_profiles: 'Private profile log',
        wow_weekly_leaderboard: 'Weekly leaderboard',
        wow_post_ratings: 'Post ratings',
        wow_fools_minimized: 'Window state'
    };
    const sessionSeenPosts = new Set();
    let sessionWeek = '';
    let warnedNoPostId = false;
    const PROFILE_NAME_KEYS = ['name'];
    const MAX_PARALLEL = 4;
    const sessionIdentity = new Set();
    let activeFetches = 0;
    const fetchQueue = [];
    let ratingsCache = null;
    let ratingStatsCache = null;
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

    async function copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            try {
                document.execCommand('copy');
                ta.remove();
                return true;
            } catch (err) {
                ta.remove();
                return false;
            }
        }
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

    function recordSightings(topicId, topicTitle, topicUrl, entries, identities) {
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

        if (applyIdentities(data, identities)) changed = true;

        if (changed) {
            localStorage.setItem('wow_weekly_leaderboard', JSON.stringify(data));
        }
    }

    function updateAppUserStats(profile) {
        if (!profile) return;
        const data = getWeeklyData();
        const readTime = profile.recent_time_read || 0;
        const trustLevel = getTrustLevel(profile);

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

    function showIgnoreModalDialog(type, card) {
        const old = document.getElementById('fools-action-modal');
        if (old) old.remove();

        const isIgnore = type === 'ignore';
        const titleText = isIgnore ? 'User Ignored & ID Copied' : 'Blizzard Native Ignore Conflict';
        const prefsUrl = appUserId ? getIgnorePrefsUrl(appUserId) : `${window.location.origin}/en/wow`;

        let bodyHtml = '';
        if (isIgnore) {
            bodyHtml = `
                <div style="margin-bottom: 10px;"><strong>${escapeHtml(card)}</strong> has been added to your local ignore list.</div>
                <div style="padding: 8px 10px; background: #1e1e1e; border: 1px solid ${THEME.sky}; border-radius: 4px; margin-bottom: 12px; color: #38bdf8; font-weight: bold; font-size: 11px;">
                    📋 User ID copied to clipboard and ready to paste!
                </div>
                <div style="font-size: 11px; line-height: 1.5; margin-bottom: 12px;">
                    To also add them to your Blizzard native ignore list:
                    <ol style="margin: 6px 0 0 20px; padding: 0;">
                        <li>Open your <a href="${escapeHtml(prefsUrl)}" target="_blank" rel="noopener noreferrer" style="color: ${THEME.sky}; font-weight: bold; text-decoration: underline;">Blizzard ignore settings ↗</a>.</li>
                        <li>Paste the user ID into the user search box.</li>
                    </ol>
                </div>
            `;
        } else {
            bodyHtml = `
                <div style="margin-bottom: 10px;"><strong>${escapeHtml(card)}</strong> is also on your Blizzard ignore list. That list is re-synced every time this page loads, so they would come straight back.</div>
                <div style="font-size: 11px; line-height: 1.5; margin-bottom: 12px;">
                    <ol style="margin: 6px 0 0 20px; padding: 0; display: flex; flex-direction: column; gap: 6px;">
                        <li>Open your <a href="${escapeHtml(prefsUrl)}" target="_blank" rel="noopener noreferrer" style="color: ${THEME.sky}; font-weight: bold; text-decoration: underline;">Blizzard ignore settings ↗</a> and remove <strong>${escapeHtml(card)}</strong>.</li>
                        <li>Come back here and click <strong>Unignore to View</strong> again.</li>
                    </ol>
                </div>
            `;
        }

        const modalEl = document.createElement('div');
        modalEl.id = 'fools-action-modal';
        modalEl.style.cssText = modalCss(`
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 9999999;
            width: 440px;
            max-width: calc(100vw - 40px);
        `);

        modalEl.innerHTML = `
            <div id="actionHeader" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                <h3 style="margin: 0; font-size: 15px; letter-spacing: 1px; text-transform: uppercase; color: ${THEME.text};">${escapeHtml(titleText)}</h3>
                <button id="actionCloseBtn" class="fools-btn" title="Close">×</button>
            </div>
            ${bodyHtml}
            <div style="display: flex; gap: 8px; margin-top: 14px;">
                <a href="${escapeHtml(prefsUrl)}" target="_blank" rel="noopener noreferrer" class="fools-btn" style="flex: 1; text-decoration: none; display: inline-flex; align-items: center; justify-content: center;">Open Preferences ↗</a>
                <button id="actionDone" class="fools-btn" style="flex: 1;">Close</button>
            </div>
        `;

        document.body.appendChild(modalEl);
        styleButtons(modalEl);

        const closeBtn = modalEl.querySelector('#actionCloseBtn');
        closeBtn.style.padding = '0';
        closeBtn.style.width = '22px';
        closeBtn.style.height = '22px';
        closeBtn.style.borderRadius = '50%';
        closeBtn.style.fontSize = '13px';
        closeBtn.style.lineHeight = '20px';

        const closeFn = () => modalEl.remove();
        closeBtn.addEventListener('click', closeFn);
        modalEl.querySelector('#actionDone').addEventListener('click', closeFn);
        makeDraggable(modalEl, modalEl.querySelector('#actionHeader'));
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
            ['🚫', ignored, 'Ignored', 'Users on your ignore list'],
            ['🙈', stats.hidden, 'Hidden', 'Topic rows hidden this session (shown as a Have a Nice Day banner)'],
            ['🔒', ids.length, 'Private', 'Private profiles logged (last seen and last post both hidden)'],
            ['🔄', repeat, 'Repeat', 'Private profiles spotted in 2 or more different topics'],
            ['🔎', stats.scanned, 'Scanned', 'Profiles inspected this session'],
            ['👁', sights, 'Sights', 'Private-profile sightings logged (last 50 kept per user)']
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

    function limitedFetch(url) {
        return new Promise((resolve, reject) => {
            const run = () => {
                activeFetches++;
                fetch(url)
                    .then(resolve, reject)
                    .finally(() => {
                        activeFetches--;
                        const next = fetchQueue.shift();
                        if (next) next();
                    });
            };
            if (activeFetches < MAX_PARALLEL) run();
            else fetchQueue.push(run);
        });
    }

    function getPath(obj, path) {
        return String(path).split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
    }

    function resolveAvatarUrl(tpl, size) {
        if (!tpl || typeof tpl !== 'string') return '';
        let url = tpl.replace(/\{size\}/g, String(size || 48));
        if (url.startsWith('//')) url = 'https:' + url;
        else if (url.startsWith('/')) url = window.location.origin + url;
        return /^https?:\/\//i.test(url) ? url : '';
    }

    function identityFromProfile(profile) {
        let name = '';
        for (const key of PROFILE_NAME_KEYS) {
            const v = getPath(profile, key);
            if (typeof v === 'string' && v.trim()) {
                name = v.trim();
                break;
            }
        }
        return { name: name.slice(0, 60), avatar: resolveAvatarUrl(profile && profile.avatar_template, 48) };
    }

    function identityFromPost(el, article) {
        const name = (el.textContent || '').trim().slice(0, 60);
        const img = article ? article.querySelector('.topic-avatar img, a.main-avatar img, img.avatar') : null;
        const src = img ? img.getAttribute('src') : '';
        let avatar = '';
        if (src) {
            try {
                avatar = new URL(src, window.location.href).href;
            } catch (e) {
                avatar = '';
            }
        }
        return { name, avatar: /^https?:\/\//i.test(avatar) ? avatar : '' };
    }

    function applyIdentities(data, list) {
        let changed = false;
        (list || []).forEach(({ userCard, name, avatar }) => {
            if (!Object.prototype.hasOwnProperty.call(data.users, userCard)) return;
            const u = data.users[userCard];
            if (name && u.name !== name) { u.name = name; changed = true; }
            if (avatar && u.avatar !== avatar) { u.avatar = avatar; changed = true; }
        });
        return changed;
    }

    function recordIdentities(list) {
        if (!list || list.length === 0) return;
        const data = getWeeklyData();
        if (applyIdentities(data, list)) {
            localStorage.setItem('wow_weekly_leaderboard', JSON.stringify(data));
        }
    }

    function fillIdentityFromProfile(userCard, profile) {
        const data = getWeeklyData();
        if (!Object.prototype.hasOwnProperty.call(data.users, userCard)) return;
        const u = data.users[userCard];
        if (u.name && u.avatar) return;
        const ident = identityFromProfile(profile);
        let changed = false;
        if (!u.name && ident.name) { u.name = ident.name; changed = true; }
        if (!u.avatar && ident.avatar) { u.avatar = ident.avatar; changed = true; }
        if (changed) localStorage.setItem('wow_weekly_leaderboard', JSON.stringify(data));
    }

    function fetchProfile(userCard) {
        if (profileCache.has(userCard)) return profileCache.get(userCard);

        const p = limitedFetch(`${window.location.origin}/en/wow/u/${userCard}.json`)
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
                fillIdentityFromProfile(userCard, profile);
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

    function getTrustLevel(profile) {
        let max = Number(profile && profile.trust_level) || 0;
        if (profile && Array.isArray(profile.groups)) {
            profile.groups.forEach(g => {
                const gName = typeof g === 'string' ? g : ((g && g.name) || '');
                const match = gName.match(/trust_level_(\d+)/);
                if (match) max = Math.max(max, parseInt(match[1], 10));
            });
        }
        return max;
    }

    function renderUserInfo(profile, userCard) {
        const lastSeen = formatDate(profile.last_seen_at);
        const lastPost = formatDate(profile.last_posted_at);
        const readTime = formatSeconds(profile.recent_time_read);
        const maxTrust = getTrustLevel(profile);
        const isPrivate = !profile.last_seen_at && !profile.last_posted_at;

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

    const RATING_OPTIONS = [[1, 'Poor'], [2, 'Weak'], [3, 'Okay'], [4, 'Good'], [5, 'Great']];

    function getRatings() {
        if (!ratingsCache) {
            const raw = readJSON('wow_post_ratings', {});
            ratingsCache = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
        }
        return ratingsCache;
    }

    function saveRatings() {
        ratingStatsCache = null;
        try {
            localStorage.setItem('wow_post_ratings', JSON.stringify(getRatings()));
            return true;
        } catch (e) {
            console.error('GD Forum Tools: could not save ratings', e);
            return false;
        }
    }

    function getRatingStats() {
        if (ratingStatsCache) return ratingStatsCache;
        const stats = new Map();
        Object.values(getRatings()).forEach(e => {
            if (!e || typeof e.u !== 'string' || !Number.isInteger(e.r) || e.r < 1 || e.r > 5) return;
            const st = stats.get(e.u) || { sum: 0, count: 0 };
            st.sum += e.r;
            st.count++;
            stats.set(e.u, st);
        });
        ratingStatsCache = stats;
        return stats;
    }

    function ratingSummary(stat) {
        if (!stat || !stat.count) return null;
        const tenths = Math.round(stat.sum * 10 / stat.count);
        const color = tenths <= 19 ? '#ef4444' : (tenths <= 35 ? '#facc15' : '#22c55e');
        return { tenths, text: (tenths / 10).toFixed(1), color, count: stat.count };
    }

    function starSvg(color, size) {
        const px = size || 14;
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${px}" height="${px}" style="vertical-align: -2px;" aria-hidden="true"><path fill="${color}" stroke="rgba(0,0,0,0.4)" stroke-width="0.8" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
    }

    function ratingBadgeHtml(sum) {
        return `${starSvg(sum.color)} <span style="font-family: monospace;">${sum.text}</span> <span style="opacity: 0.7;">(${sum.count})</span>`;
    }

    function refreshRatingReadouts() {
        const wraps = document.querySelectorAll('.fools-rate');
        if (wraps.length === 0) return;
        const stats = getRatingStats();
        const ratings = getRatings();

        wraps.forEach(wrap => {
            const sum = ratingSummary(stats.get(wrap.getAttribute('data-user')));
            const span = wrap.querySelector('.fools-rate-avg');
            if (span) {
                const sig = sum ? `${sum.text}|${sum.count}|${sum.color}` : '';
                if (span.getAttribute('data-sig') !== sig) {
                    span.innerHTML = sum ? ratingBadgeHtml(sum) : '';
                    span.title = sum ? `Your average for this user: ${sum.text} from ${sum.count} rating(s)` : '';
                    span.setAttribute('data-sig', sig);
                }
            }
            const sel = wrap.querySelector('select');
            const cur = ratings[wrap.getAttribute('data-post')];
            const want = cur ? String(cur.r) : '';
            if (sel && sel.value !== want && document.activeElement !== sel) sel.value = want;
        });
    }

    function buildRatingControl(userCard, postId, topicId) {
        const wrap = document.createElement('div');
        wrap.className = 'fools-rate';
        wrap.setAttribute('data-post', postId);
        wrap.setAttribute('data-user', userCard);
        wrap.style.cssText = 'margin-top: 4px; display: flex; align-items: center; gap: 6px; font-size: 11px; line-height: 1.2;';

        const select = document.createElement('select');
        select.className = 'fools-rate-select';
        select.setAttribute('aria-label', 'Rate this post');
        select.title = "Rate this post's content: 1 = poor, 5 = great";
        select.style.cssText = `background: ${THEME.navy}; color: ${THEME.text}; border: 1px solid ${THEME.sky}; border-radius: 4px; font-size: 11px; padding: 2px 4px; cursor: pointer; color-scheme: dark; max-width: 160px;`;
        select.innerHTML = '<option value="">Rate post…</option>' +
            RATING_OPTIONS.map(([v, label]) => `<option value="${v}">${'★'.repeat(v)} ${v} – ${label}</option>`).join('') +
            '<option value="clear">✕ Clear rating</option>';
        const existing = getRatings()[postId];
        select.value = existing ? String(existing.r) : '';

        const avg = document.createElement('span');
        avg.className = 'fools-rate-avg';
        avg.style.cssText = 'white-space: nowrap;';

        wrap.appendChild(select);
        wrap.appendChild(avg);

        ['click', 'mousedown', 'pointerdown', 'keydown', 'keyup'].forEach(type => {
            wrap.addEventListener(type, (e) => e.stopPropagation());
        });

        select.addEventListener('change', () => {
            const v = select.value;
            const ratings = getRatings();

            if (v === '') {
                const cur = ratings[postId];
                select.value = cur ? String(cur.r) : '';
                return;
            }

            if (v === 'clear') {
                delete ratings[postId];
                select.value = '';
            } else {
                ratings[postId] = { u: userCard, r: Number(v), t: topicId || '', d: todayStamp() };
            }

            if (!saveRatings()) alert('Could not save that rating (browser storage may be full).');
            refreshRatingReadouts();
        });

        return wrap;
    }

    function ensureRatingControl(el, userCard, postId, topicId) {
        const holder = el.parentNode;
        if (!holder) return;

        const isSelf = !!appUserId && userCard.toLowerCase() === appUserId.toLowerCase();
        const ctrl = holder.querySelector(':scope > .fools-rate');

        if (isSelf) {
            if (ctrl) ctrl.remove();
            return;
        }
        if (ctrl && ctrl.getAttribute('data-post') === postId && ctrl.getAttribute('data-user') === userCard) return;
        if (ctrl) ctrl.remove();

        holder.appendChild(buildRatingControl(userCard, postId, topicId));
    }

    function showUserInfo(el, userCard) {
        const holder = el.parentNode;
        if (!holder) return;

        const existing = holder.querySelector(':scope > .fools-info');
        if (existing && existing.getAttribute('data-for') === userCard) {
            if (el.dataset.foolsUser !== userCard) el.dataset.foolsUser = userCard;
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
                target.insertBefore(renderUserInfo(profile, userCard), target.querySelector(':scope > .fools-rate'));
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
            sessionIdentity.clear();
        }

        const topicTitle = document.title;
        const topicUrl = window.location.href;
        const newPosts = [];
        const identities = [];

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

            if (postId && article.querySelector('a.character-name') === el) {
                ensureRatingControl(el, userCard, postId, topicId);

                if (!sessionIdentity.has(userCard)) {
                    const ident = identityFromPost(el, article);
                    if (ident.name || ident.avatar) {
                        sessionIdentity.add(userCard);
                        identities.push({ userCard, name: ident.name, avatar: ident.avatar });
                    }
                }
            }
        });

        refreshRatingReadouts();

        if (newPosts.length > 0) {
            recordSightings(topicId, topicTitle, topicUrl, newPosts, identities);
        } else {
            recordIdentities(identities);
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

                    unignoreBtn.disabled = true;
                    const natives = await fetchNativeIgnores();
                    unignoreBtn.disabled = false;

                    const stillNative = !!natives && natives.some(n => String(n).toLowerCase() === cardToUnignore.toLowerCase());

                    if (stillNative) {
                        showIgnoreModalDialog('native_conflict', cardToUnignore);
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
                <div style="font-size: 10px; line-height: 1.4; opacity: 0.85; margin-bottom: 8px;">To stop ignoring someone from Blizzard's ignore list first follow the link above and remove them them from the list then return here and delete the name, if you have set a name manually to remove them just delete the name - after deletion clcik save and run, topics they create will now be visable.</div>
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

    function nameCellHtml(name) {
        return name ? escapeHtml(name) : '<span style="opacity: 0.4;">–</span>';
    }

    function avatarCellHtml(card, name, avatar) {
        const box = `width: 26px; height: 26px; border-radius: 4px; border: 1px solid ${THEME.sky}; box-sizing: border-box;`;
        if (/^https?:\/\//i.test(avatar || '')) {
            return `<img class="fools-avatar" src="${escapeHtml(avatar)}" alt="" width="26" height="26" loading="lazy" style="display: block; object-fit: cover; ${box}">`;
        }
        const initial = (Array.from(String(name || card))[0] || '?').toUpperCase();
        return `<div class="fools-avatar-ph" style="display: flex; align-items: center; justify-content: center; background: ${THEME.navy}; color: ${THEME.text}; font-size: 12px; font-weight: bold; ${box}">${escapeHtml(initial)}</div>`;
    }

    function bindAvatarFallbacks(root) {
        root.querySelectorAll('img.fools-avatar').forEach(img => {
            if (img.dataset.foolsBound) return;
            img.dataset.foolsBound = '1';
            img.addEventListener('error', () => {
                const tr = img.closest('tr');
                const td = img.parentNode;
                if (!tr || !td) return;
                const nameTd = tr.querySelector('.fools-lb-name');
                td.innerHTML = avatarCellHtml(tr.getAttribute('data-card'), nameTd ? nameTd.getAttribute('title') : '', '');
            });
        });
    }

    function refreshLeaderboardIdentities(root, cards) {
        const weekly = getWeeklyData();
        const missing = cards.filter(c => {
            if (!Object.prototype.hasOwnProperty.call(weekly.users, c)) return false;
            const u = weekly.users[c];
            return !u.name || !u.avatar;
        });
        if (missing.length === 0) return;

        Promise.allSettled(missing.map(c => fetchProfile(c))).then(() => {
            if (!root.isConnected) return;
            const fresh = getWeeklyData();
            const rows = [...root.querySelectorAll('tbody tr')];
            missing.forEach(c => {
                if (!Object.prototype.hasOwnProperty.call(fresh.users, c)) return;
                const u = fresh.users[c];
                const tr = rows.find(r => r.getAttribute('data-card') === c);
                if (!tr) return;
                tr.querySelector('.fools-lb-avatar').innerHTML = avatarCellHtml(c, u.name, u.avatar);
                const nameTd = tr.querySelector('.fools-lb-name');
                nameTd.title = u.name || '';
                nameTd.innerHTML = nameCellHtml(u.name);
            });
            bindAvatarFallbacks(root);
        });
    }

    function refreshTopRatedIdentities(root, cards, selector) {
        const table = root.querySelector(selector || '#lbTopRated');
        if (!table) return;
        const weekly = getWeeklyData();
        const need = cards.filter(c => {
            const u = Object.prototype.hasOwnProperty.call(weekly.users, c) ? weekly.users[c] : null;
            return !u || !u.name || !u.avatar;
        });
        if (need.length === 0) return;

        Promise.allSettled(need.map(c => fetchProfile(c).then(p => ({ c, ident: identityFromProfile(p) })))).then(results => {
            if (!root.isConnected) return;
            const fresh = getWeeklyData();
            const rows = [...table.querySelectorAll('tbody tr')];
            results.forEach(r => {
                if (r.status !== 'fulfilled') return;
                const { c, ident } = r.value;
                const tr = rows.find(x => x.getAttribute('data-card') === c);
                if (!tr) return;
                const u = Object.prototype.hasOwnProperty.call(fresh.users, c) ? fresh.users[c] : {};
                const name = u.name || ident.name;
                const avatar = u.avatar || ident.avatar;
                tr.querySelector('.fools-lb-avatar').innerHTML = avatarCellHtml(c, name, avatar);
                const nameTd = tr.querySelector('.fools-lb-name');
                nameTd.title = name || '';
                nameTd.innerHTML = nameCellHtml(name);
            });
            bindAvatarFallbacks(root);
        });
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
            name: (obj && obj.name) || '',
            avatar: (obj && obj.avatar) || '',
            uniqueTopics: Object.keys(obj.topics || {}).length
        })).sort((a, b) => b.count - a.count).slice(0, 10);

        const top10Cards = new Set(userEntries.map(u => u.card));

        const privateLog = readJSON('wow_private_profiles', {});
        const isPrivateCard = (card) =>
            !!privateLog && typeof privateLog === 'object' && !Array.isArray(privateLog) &&
            Object.prototype.hasOwnProperty.call(privateLog, card);

        const ratingStats = getRatingStats();
        const ratingCellHtml = (card) => {
            const rs = ratingSummary(ratingStats.get(card));
            if (!rs) return '<span style="opacity: 0.4;" title="Not rated yet">–</span>';
            return `<span title="Your average: ${rs.text} from ${rs.count} rating${rs.count === 1 ? '' : 's'} (all time)">${ratingBadgeHtml(rs)}</span>`;
        };

        const topRated = [...ratingStats.entries()]
            .map(([card, st]) => ({ card, avg: st.sum / st.count, count: st.count }))
            .filter(r => r.count >= 3)
            .sort((a, b) => (b.avg - a.avg) || (b.count - a.count) || (a.card < b.card ? -1 : 1))
            .slice(0, 5);

        const identOf = (card) => {
            const u = Object.prototype.hasOwnProperty.call(weekly.users || {}, card) ? weekly.users[card] : null;
            return { name: (u && u.name) || '', avatar: (u && u.avatar) || '' };
        };

        const topRatedHtml = topRated.length === 0
            ? `<div style="font-size: 11px; opacity: 0.7;">${ratingStats.size === 0 ? 'No ratings yet. Use the Rate post… dropdown on topic pages.' : 'Nobody has 3 or more ratings yet. A user needs at least 3 to appear here.'}</div>`
            : `
                <div style="font-size: 10px; opacity: 0.7; margin: -4px 0 8px;">Your all-time average 1-5 score. Needs at least 3 ratings. Ties go to the user with more ratings.</div>
                <table id="lbTopRated" style="width: 100%; font-size: 11px; border-collapse: collapse;">
                    <thead>
                        <tr style="border-bottom: 1px solid ${THEME.sky}; text-align: left; opacity: 0.8;">
                            <th style="padding: 4px;">#</th>
                            <th style="padding: 4px;">Avatar</th>
                            <th style="padding: 4px;">Forum ID</th>
                            <th style="padding: 4px;">Name</th>
                            <th style="padding: 4px;">Rating</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${topRated.map((r, i) => {
                            const id = identOf(r.card);
                            return `
                            <tr data-card="${escapeHtml(r.card)}" style="border-bottom: 1px solid #222;">
                                <td style="padding: 4px; font-family: monospace;">${i + 1}</td>
                                <td class="fools-lb-avatar" style="padding: 4px;">${avatarCellHtml(r.card, id.name, id.avatar)}</td>
                                <td style="padding: 4px; font-family: monospace; white-space: nowrap;"><a href="${escapeHtml(getProfileJsonUrl(r.card))}" target="_blank" rel="noopener noreferrer" title="Open ${escapeHtml(r.card)}'s profile data (JSON) in a new tab" style="color: #38bdf8; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 3px;">${escapeHtml(r.card)}</a>${isPrivateCard(r.card) ? ' <span class="fools-lock" title="Private profile: last seen and last post are hidden" style="cursor: help;">🔒</span>' : ''}</td>
                                <td class="fools-lb-name" title="${escapeHtml(id.name)}" style="padding: 4px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${nameCellHtml(id.name)}</td>
                                <td style="padding: 4px; white-space: nowrap;">${ratingCellHtml(r.card)}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>`;

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
                    <div style="font-size: 10px; opacity: 0.7; margin: -4px 0 8px;">Click a Forum ID to open its profile data (raw JSON) in a new tab. 🔒 = private profile. Rating = your average 1-5 score for their posts.</div>
                    <table style="width: 100%; font-size: 11px; border-collapse: collapse;">
                        <thead>
                            <tr style="border-bottom: 1px solid ${THEME.sky}; text-align: left; opacity: 0.8;">
                                <th style="padding: 4px;">#</th>
                                <th style="padding: 4px;">Avatar</th>
                                <th style="padding: 4px;">Forum ID</th>
                                <th style="padding: 4px;">Name</th>
                                <th style="padding: 4px;" title="Your all-time average 1-5 score for their posts (red below 2.0, yellow 2.0-3.5, green 3.6+)">Rating</th>
                                <th style="padding: 4px; text-align: right;">Posts</th>
                                <th style="padding: 4px; text-align: right;">Topics</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${userEntries.map((u, idx) => `
                                <tr data-card="${escapeHtml(u.card)}" style="border-bottom: 1px solid #222;">
                                    <td style="padding: 4px; font-family: monospace;">${idx + 1}</td>
                                    <td class="fools-lb-avatar" style="padding: 4px;">${avatarCellHtml(u.card, u.name, u.avatar)}</td>
                                    <td style="padding: 4px; font-family: monospace; white-space: nowrap;"><a href="${escapeHtml(getProfileJsonUrl(u.card))}" target="_blank" rel="noopener noreferrer" title="Open ${escapeHtml(u.card)}'s profile data (JSON) in a new tab" style="color: #38bdf8; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 3px;">${escapeHtml(u.card)}</a>${isPrivateCard(u.card) ? ' <span class="fools-lock" title="Private profile: last seen and last post are hidden" style="cursor: help;">🔒</span>' : ''}</td>
                                    <td class="fools-lb-name" title="${escapeHtml(u.name)}" style="padding: 4px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${nameCellHtml(u.name)}</td>
                                    <td style="padding: 4px; white-space: nowrap;">${ratingCellHtml(u.card)}</td>
                                    <td style="padding: 4px; text-align: right; font-family: monospace;">${u.count}</td>
                                    <td style="padding: 4px; text-align: right; font-family: monospace;">${u.uniqueTopics}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `}
            </div>

            <div style="margin-bottom: 16px;">
                <h4 style="margin: 0 0 8px; color: ${THEME.sky}; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Top 5 Rated Users</h4>
                ${topRatedHtml}
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
            width: 720px;
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

        bindAvatarFallbacks(lbModal);
        refreshLeaderboardIdentities(lbModal, userEntries.map(u => u.card));
        refreshTopRatedIdentities(lbModal, topRated.map(r => r.card));
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
        const rat = readJSON('wow_post_ratings', {});
        const ratingsCount = rat && typeof rat === 'object' && !Array.isArray(rat) ? Object.keys(rat).length : 0;
        const wk = readJSON('wow_weekly_leaderboard', null);
        let posts = 0;
        if (wk && wk.users && typeof wk.users === 'object') {
            posts = Object.values(wk.users).reduce((a, u) => a + ((u && u.count) || 0), 0);
        }
        return {
            ignores: getIgnoreList().length,
            privCount,
            ratings: ratingsCount,
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

    function buildLeaderboardExport() {
        const weekly = readJSON('wow_weekly_leaderboard', null);
        if (!weekly || typeof weekly !== 'object' || !weekly.users) return null;

        const ratingStats = getRatingStats();
        const users = Object.entries(weekly.users)
            .map(([userCard, u]) => {
                const rs = ratingSummary(ratingStats.get(userCard));
                return {
                    userCard,
                    name: (u && u.name) || null,
                    avatar: (u && u.avatar) || null,
                    posts: (u && u.count) || 0,
                    topics: Object.keys((u && u.topics) || {}).length,
                    rating: rs ? { average: rs.tenths / 10, ratings: rs.count } : null
                };
            })
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
            ratingScale: '1 (poor) to 5 (great); rating is your own all-time average for that user, rounded to one decimal',
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
        if (key === 'wow_post_ratings') {
            if (!isObj(val)) return { error: 'is not an object' };
            const clean = {};
            Object.entries(val).forEach(([pid, e]) => {
                if (isObj(e) && typeof e.u === 'string' && e.u && Number.isInteger(e.r) && e.r >= 1 && e.r <= 5) {
                    clean[pid] = { u: e.u, r: e.r, t: typeof e.t === 'string' ? e.t : '', d: typeof e.d === 'string' ? e.d : '' };
                }
            });
            if (Object.keys(val).length > 0 && Object.keys(clean).length === 0) return { error: 'contains no valid ratings' };
            return { value: clean };
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
        if (key === 'wow_post_ratings') return `Post ratings: ${Object.keys(value).length} rating(s)`;
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

    function persistIgnoreList(list) {
        localStorage.setItem('wow_ignore_list', JSON.stringify(list));
        const ta = document.getElementById('fools-input');
        if (ta) ta.value = list.join('\n');
        updateMetrics();
        tick();
    }

    // --- LOW RATED & IGNORED USERS MANAGEMENT LIST ---
    function showLowRated() {
        const old = document.getElementById('fools-low-modal');
        if (old) old.remove();

        const stats = getRatingStats();
        const weekly = getWeeklyData();
        const privateLog = readJSON('wow_private_profiles', {});
        const ignores = getIgnoreList();

        const isPrivateCard = (c) =>
            !!privateLog && typeof privateLog === 'object' && !Array.isArray(privateLog) &&
            Object.prototype.hasOwnProperty.call(privateLog, c);
        const isIgnored = (c) => ignores.some(n => n.toLowerCase() === c.toLowerCase());
        const identOf = (c) => {
            const u = Object.prototype.hasOwnProperty.call(weekly.users || {}, c) ? weekly.users[c] : null;
            return { name: (u && u.name) || '', avatar: (u && u.avatar) || '' };
        };

        const listMap = new Map();

        // 1. Add low-rated users (average rating < 2.8)
        stats.forEach((st, card) => {
            const tenths = Math.round(st.sum * 10 / st.count);
            if (tenths < 28) {
                listMap.set(card.toLowerCase(), { card, st, avg: st.sum / st.count, tenths, source: 'rating' });
            }
        });

        // 2. Add all users from ignore list (including native ignores)
        ignores.forEach(card => {
            const key = card.toLowerCase();
            if (!listMap.has(key)) {
                const st = stats.get(card) || { sum: 0, count: 0 };
                const avg = st.count ? st.sum / st.count : 0;
                const tenths = st.count ? Math.round(st.sum * 10 / st.count) : 999;
                listMap.set(key, { card, st, avg, tenths, source: 'ignore' });
            }
        });

        const low = [...listMap.values()].sort((a, b) => (a.tenths - b.tenths) || (b.st.count - a.st.count) || (a.card < b.card ? -1 : 1));

        const lm = document.createElement('div');
        lm.id = 'fools-low-modal';
        lm.style.cssText = modalCss(`
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 9999999;
            width: 720px;
            max-width: calc(100vw - 40px);
            max-height: 85vh;
            overflow-y: auto;
        `);

        const rowsHtml = low.map((r, i) => {
            const id = identOf(r.card);
            const sum = ratingSummary(r.st);
            const ratingDisplay = sum
                ? `<span title="Your average: ${sum.text}">${starSvg(sum.color)} <span style="font-family: monospace;">${sum.text}</span></span>`
                : '<span style="opacity: 0.4;">– (Unrated)</span>';
            const ignored = isIgnored(r.card);

            return `
                <tr data-card="${escapeHtml(r.card)}" style="border-bottom: 1px solid #222;">
                    <td style="padding: 4px; font-family: monospace;">${i + 1}</td>
                    <td class="fools-lb-avatar" style="padding: 4px;">${avatarCellHtml(r.card, id.name, id.avatar)}</td>
                    <td style="padding: 4px; font-family: monospace; white-space: nowrap;"><a href="${escapeHtml(getProfileJsonUrl(r.card))}" target="_blank" rel="noopener noreferrer" title="Open ${escapeHtml(r.card)}'s profile data (JSON) in a new tab" style="color: #38bdf8; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 3px;">${escapeHtml(r.card)}</a>${isPrivateCard(r.card) ? ' <span class="fools-lock" title="Private profile: last seen and last post are hidden" style="cursor: help;">🔒</span>' : ''}</td>
                    <td class="fools-lb-name" title="${escapeHtml(id.name)}" style="padding: 4px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${nameCellHtml(id.name)}</td>
                    <td style="padding: 4px; white-space: nowrap;">${ratingDisplay}</td>
                    <td style="padding: 4px; text-align: right; font-family: monospace;" title="Number of ratings">${r.st.count}</td>
                    <td style="padding: 4px; text-align: right;"><button class="fools-btn fools-ignore-toggle" data-card="${escapeHtml(r.card)}" data-ignored="${ignored ? '1' : '0'}">${ignored ? '↩ Unignore' : '🚫 Ignore'}</button></td>
                </tr>`;
        }).join('');

        const blizzPrefsUrl = appUserId ? getIgnorePrefsUrl(appUserId) : `${window.location.origin}/en/wow`;

        lm.innerHTML = `
            <div id="lowHeader" style="display: flex; align-items: center; justify-content: space-between;">
                <h3 style="margin: 0; font-size: 16px; letter-spacing: 1px; text-transform: uppercase; color: ${THEME.text};">Low Rated &amp; Ignored Users</h3>
                <button id="lowClose" class="fools-btn" title="Close">×</button>
            </div>
            <p style="margin: 6px 0 12px; font-size: 11px; line-height: 1.4; opacity: 0.85;">
                Manages users rated below 2.8 and everyone on your ignore list.
                ${appUserId ? `<br><a href="${escapeHtml(blizzPrefsUrl)}" target="_blank" rel="noopener noreferrer" style="color: ${THEME.sky}; font-weight: bold; text-decoration: underline;">Manage your Blizzard native ignore settings ↗</a>` : ''}
            </p>
            ${low.length === 0
                ? '<div style="font-size: 11px; opacity: 0.7;">No low-rated or ignored users found yet.</div>'
                : `<div style="font-size: 10px; opacity: 0.7; margin-bottom: 8px;">${low.length} user${low.length === 1 ? '' : 's'} total. Click Ignore to add them to your ignore list.</div>
                <table id="lbLowRated" style="width: 100%; font-size: 11px; border-collapse: collapse;">
                    <thead>
                        <tr style="border-bottom: 1px solid ${THEME.sky}; text-align: left; opacity: 0.8;">
                            <th style="padding: 4px;">#</th>
                            <th style="padding: 4px;">Avatar</th>
                            <th style="padding: 4px;">Forum ID</th>
                            <th style="padding: 4px;">Name</th>
                            <th style="padding: 4px;">Rating</th>
                            <th style="padding: 4px; text-align: right;">Votes</th>
                            <th style="padding: 4px;"></th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>`}
            <div style="margin-top: 12px; font-size: 10px; opacity: 0.7;">Rows already hidden on the topic list come back after you refresh the page.</div>
        `;

        document.body.appendChild(lm);
        styleButtons(lm);

        const closeBtn = lm.querySelector('#lowClose');
        closeBtn.style.padding = '0';
        closeBtn.style.width = '22px';
        closeBtn.style.height = '22px';
        closeBtn.style.borderRadius = '50%';
        closeBtn.style.fontSize = '13px';
        closeBtn.style.lineHeight = '20px';
        closeBtn.addEventListener('click', () => lm.remove());
        lm.querySelectorAll('.fools-ignore-toggle').forEach(b => { b.style.padding = '4px 8px'; });

        makeDraggable(lm, lm.querySelector('#lowHeader'));
        bindAvatarFallbacks(lm);
        refreshTopRatedIdentities(lm, low.map(r => r.card), '#lbLowRated');

        const setBtn = (btn, ignored) => {
            btn.setAttribute('data-ignored', ignored ? '1' : '0');
            btn.textContent = ignored ? '↩ Unignore' : '🚫 Ignore';
        };

        lm.querySelectorAll('.fools-ignore-toggle').forEach(btn => {
            btn.addEventListener('click', async () => {
                const card = btn.getAttribute('data-card');

                if (btn.getAttribute('data-ignored') !== '1') {
                    const list = getIgnoreList();
                    if (!list.some(n => n.toLowerCase() === card.toLowerCase())) {
                        list.push(card);
                    }
                    persistIgnoreList(list);
                    setBtn(btn, true);

                    await copyToClipboard(card);
                    if (appUserId) {
                        showIgnoreModalDialog('ignore', card);
                    }
                    return;
                }

                btn.disabled = true;
                const natives = await fetchNativeIgnores();
                btn.disabled = false;
                const stillNative = !!natives && natives.some(n => String(n).toLowerCase() === card.toLowerCase());

                if (stillNative) {
                    showIgnoreModalDialog('native_conflict', card);
                    return;
                }

                persistIgnoreList(getIgnoreList().filter(n => n.toLowerCase() !== card.toLowerCase()));
                setBtn(btn, false);
            });
        });
    }

    function showDataManager() {
        const old = document.getElementById('fools-data-modal');
        if (old) old.remove();

        const sum = getDataSummary();
        const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
        const lines = {
            wow_ignore_list: `Ignore list (${plural(sum.ignores, 'user')})`,
            wow_private_profiles: `Private profile log (${plural(sum.privCount, 'profile')})`,
            wow_post_ratings: `Post ratings (${plural(sum.ratings, 'rating')})`,
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
                ${wipeRow('wow_post_ratings')}
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
                if (!confirm(`Restore from "${file.name}"?\n\nThis will overwrite your current:\n${listed}\n\nAnything not listed is left alone.`)) {
                    setStatus2('Restore cancelled.');
                    return;
                }

                if (!applyRestore(res.entries)) {
                    setStatus2('⚠️ Restore failed. Previous data restored.');
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
            if (!confirm(`Permanently delete the following?\n\n${listed}\n\nThis cannot be undone.`)) {
                setStatus2('Wipe cancelled.');
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
                        top: -8px;
                        right: 5px;
                        display: grid;
                        grid-template-columns: auto auto;
                        gap: 3px 6px;
                        font-family: monospace;
                        font-size: 10px;
                        color: ${THEME.text};
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
                    <button id="fools-manage-data" class="fools-btn">🗂️ Manage Data</button>
                    <button id="fools-low-rated" class="fools-btn">📉 Low Rated</button>
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
            <div style="border-top: 1px solid ${THEME.sky}; margin: 10px 0 8px; padding-top: 8px; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; opacity: 0.7;">Ratings</div>
            <div style="font-size: 11px; line-height: 1.4; margin-bottom: 6px;">The <strong>Rate post…</strong> dropdown under each author on topic pages scores that post: 1 Poor, 2 Weak, 3 Okay, 4 Good, 5 Great. Your own posts are skipped.</div>
            <div style="font-size: 11px; line-height: 1.6;">${starSvg('#ef4444')} <strong>Red</strong> - average below 2.0</div>
            <div style="font-size: 11px; line-height: 1.6;">${starSvg('#facc15')} <strong>Yellow</strong> - average 2.0 to 3.5</div>
            <div style="font-size: 11px; line-height: 1.6;">${starSvg('#22c55e')} <strong>Green</strong> - average 3.6 to 5.0</div>
            <div style="font-size: 10px; line-height: 1.4; opacity: 0.8; margin: 4px 0 6px;">All-time average, rounded to one decimal. The number in brackets is how many ratings it is based on. Top 5 Rated needs at least 3.</div>
            <div style="font-size: 11px; line-height: 1.4; margin-bottom: 6px;">The <strong>Low Rated</strong> button lists anyone you have rated below 2.8 or have ignored, with one-click Ignore / Unignore.</div>
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
        document.getElementById('fools-low-rated').onclick = showLowRated;

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
                return node && node.closest && node.closest('#fools-filter-modal, #fools-report-modal, #fools-lb-modal, #fools-data-modal, #fools-low-modal, #fools-pill, #fools-legend, #fools-action-modal');
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
    window.addEventListener('storage', (e) => {
        if (e.key === 'wow_post_ratings' || e.key === null) {
            ratingsCache = null;
            ratingStatsCache = null;
        }
    });
    setInterval(() => schedule(), 5000);

    tick();
})();
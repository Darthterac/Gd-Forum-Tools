// ==UserScript==
// @name         GD Forum Tools
// @namespace    lazyeyez.gdforumtools
// @version      10.1
// @description  Ignore list, topic user data, private profile log and metrics for the WoW General Discussion forums. Runs automatically on every page change.
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
        shadow: '0 6px 26px rgba(189, 183, 107, 0.55)'
    };

    const stats = { scanned: 0, hidden: 0 };
    const profileCache = new Map();
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
            btn.style.padding = '8px 14px';
            btn.style.cursor = 'pointer';
            btn.style.fontSize = '11px';
            btn.style.fontWeight = 'bold';
            btn.style.fontFamily = 'sans-serif';
            btn.addEventListener('mouseenter', () => { btn.style.background = THEME.navyHover; });
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

        const ignoreArr = readJSON('wow_ignore_list', []);
        const ignored = Array.isArray(ignoreArr) ? ignoreArr.length : 0;

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

    function inspectTopicUsers() {
        document.querySelectorAll('a.character-name').forEach(el => {
            const userCard = el.getAttribute('data-user-card');
            if (!userCard) return;
            if (el.dataset.foolsUser === userCard) return;

            el.dataset.foolsUser = userCard;
            if (el.parentNode) {
                el.parentNode.querySelectorAll(':scope > .fools-info').forEach(n => n.remove());
            }

            fetchProfile(userCard)
                .then(profile => {
                    if (el.dataset.foolsUser !== userCard || !el.parentNode) return;
                    el.parentNode.querySelectorAll(':scope > .fools-info').forEach(n => n.remove());
                    el.parentNode.appendChild(renderUserInfo(profile, userCard));
                    updateMetrics();
                })
                .catch(err => {
                    console.error('GD Forum Tools fetch error:', err);
                    setTimeout(() => {
                        if (el.dataset.foolsUser === userCard) delete el.dataset.foolsUser;
                    }, 30000);
                });
        });
    }

    function applyFilter() {
        const currentIgnores = readJSON('wow_ignore_list', []);
        if (!Array.isArray(currentIgnores) || currentIgnores.length === 0) return;

        const rows = document.querySelectorAll(
            'table.topic-list tbody.topic-list-body tr.topic-list-item'
        );

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
                        background: #373321;
                        color: #018bedc2;
                        padding: 10px 15px;
                        font-weight: bold;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        border: 1px solid #011a7d;
                        border-radius: 4px;
                        font-family: monospace;
                        width: 100%;
                        box-sizing: border-box;
                    ">
                        <span>[ Have a Nice Day! (${escapeHtml(matchedCard)}) ]</span>
                        <button class="fools-unignore-btn" data-card="${escapeHtml(matchedCard)}" style="
                            background: #5627a6;
                            color: #8ecbef;
                            border: none;
                            padding: 6px 12px;
                            border-radius: 4px;
                            cursor: pointer;
                            font-family: monospace;
                            font-weight: bold;
                            font-size: 11px;
                        ">Unignore to View</button>
                    </div>
                </td>
            `;

            const bannerDiv = row.querySelector('.fools-banner');
            if (bannerDiv) {
                bannerDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                });
            }

            const unignoreBtn = row.querySelector('.fools-unignore-btn');
            if (unignoreBtn) {
                unignoreBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const cardToUnignore = unignoreBtn.getAttribute('data-card');

                    let ignores = readJSON('wow_ignore_list', []);
                    ignores = ignores.filter(c => String(c).toLowerCase() !== cardToUnignore.toLowerCase());
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
        if (!appUserId || !textarea) return;

        setStatus('Connecting to Blizzard profile...');

        try {
            const response = await fetch(`${window.location.origin}/en/wow/u/${appUserId}.json`);
            if (!response.ok) {
                setStatus('⚠️ Failed to fetch profile JSON.');
                return;
            }

            const data = await response.json();
            if (data && data.user && Array.isArray(data.user.ignored_usernames)) {
                const nativeIgnores = data.user.ignored_usernames;

                if (nativeIgnores.length > 0) {
                    setStatus(`✓ Synced ${nativeIgnores.length} user(s) from Blizzard!`);

                    const currentLines = textarea.value.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
                    const combined = [...new Set([...currentLines, ...nativeIgnores])];

                    textarea.value = combined.join('\n');
                    localStorage.setItem('wow_ignore_list', JSON.stringify(combined));
                    updateMetrics();
                    if (pageKind() === 'gd') applyFilter();
                } else {
                    setStatus('✓ Connected (No native ignores found).');
                }
            } else {
                setStatus('⚠️ Profile loaded, but no ignore list was found.');
            }
        } catch (error) {
            setStatus('⚠️ Error syncing with Blizzard.');
        }
    }

    function renderIdBox() {
        const box = document.getElementById('fools-id-box');
        if (!box) return;

        if (appUserId) {
            box.innerHTML = `
                <div style="margin-bottom: 6px;"><strong>Logged In As:</strong></div>
                <div style="word-break: break-all; margin-bottom: 8px; font-family: monospace;">${escapeHtml(appUserId)}</div>
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

    function exportCsv() {
        const privateProfiles = readJSON('wow_private_profiles', {});

        let csv = 'UserCard,FirstSeen,LastSeen,TotalSightings,UniqueTopics,Topics,Alts\n';

        for (const [userCard, data] of Object.entries(privateProfiles)) {
            const alts = Array.isArray(data.altNames) ? data.altNames.join(';') : '';
            const total = Array.isArray(data.sightings) ? data.sightings.length : 0;
            const uniqueTopics = data.topicSightings ? Object.keys(data.topicSightings).length : 0;
            const topicList = data.topicSightings ? Object.keys(data.topicSightings).join(';') : '';
            csv += `"${userCard}","${data.firstSeen || ''}","${data.lastSeen || ''}",${total},${uniqueTopics},"${topicList}","${alts}"\n`;
        }

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `wow-private-profiles-${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        alert('CSV exported!');
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
        const savedIgnores = readJSON('wow_ignore_list', []);

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
            <div id="fools-header">
                <button id="fools-legend-btn" class="fools-btn" title="Show / hide the icon legend" style="position: absolute; top: 10px; left: 12px;">?</button>
                <div id="fools-metrics" title="Click for the legend" style="
                    cursor: pointer;
                    position: absolute;
                    top: 10px;
                    right: 12px;
                    display: grid;
                    grid-template-columns: auto auto;
                    gap: 3px 10px;
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

            <div style="margin-top: 12px; display: flex; justify-content: space-between; gap: 8px;">
                <button id="fools-save" class="fools-btn" style="flex: 1;">Save / Run</button>
                <button id="fools-close" class="fools-btn" style="flex: 1;">Minimize</button>
            </div>

            <button id="fools-view-private" class="fools-btn" style="width: 100%; margin-top: 12px;">📋 View Private Profiles</button>
            <button id="fools-export-private" class="fools-btn" style="width: 100%; margin-top: 8px;">📥 Export CSV</button>
            <button id="fools-clear-private" class="fools-btn" style="width: 100%; margin-top: 8px;">🗑️ Clear Private Log</button>
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
            <div style="border-top: 1px solid ${THEME.sky}; margin: 10px 0 8px; padding-top: 8px; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; opacity: 0.7;">On the topic list</div>
            <div style="font-size: 11px; line-height: 1.4;"><strong>[ Have a Nice Day! ]</strong> - the author is on your ignore list. Unignore to View restores the row.</div>
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

        document.getElementById('fools-view-private').onclick = showReport;
        document.getElementById('fools-export-private').onclick = exportCsv;

        document.getElementById('fools-clear-private').onclick = () => {
            if (confirm('Are you sure? This will delete all tracked private profile data.')) {
                localStorage.removeItem('wow_private_profiles');
                alert('Private profile log cleared!');
                updateMetrics();
            }
        };

        if (appUserId) {
            syncNativeIgnores();
        } else {
            setStatus('Enter your User ID to sync Blizzard ignores.');
        }
    }

    function tick() {
        tickTimer = null;
        if (!document.body) return;

        const kind = pageKind();
        if (kind) buildUi();
        syncVisibility();

        if (kind === 'topic') inspectTopicUsers();
        if (kind === 'gd') applyFilter();
    }

    function schedule(mutations) {
        if (Array.isArray(mutations) && mutations.length) {
            const onlyOurs = mutations.every(m => {
                const node = m.target.nodeType === 1 ? m.target : m.target.parentElement;
                return node && node.closest && node.closest('#fools-filter-modal, #fools-report-modal, #fools-pill, #fools-legend');
            });
            if (onlyOurs) return;
        }
        if (!tickTimer) tickTimer = setTimeout(tick, 250);
    }

    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', () => schedule());
    setInterval(() => schedule(), 5000);

    tick();
})();

(function () {
    'use strict';

    const $ = id => document.getElementById(id);
    const FAVORITES_KEY = 'dg_live_favorites_v1';
    const LAST_KEY = 'dg_live_last_v1';
    const PAGE_SIZE = 240;
    const dom = {
        video: $('liveVideo'),
        videoShell: $('videoShell'),
        emptyState: $('emptyState'),
        playerToast: $('playerToast'),
        currentLogo: $('currentLogo'),
        currentName: $('currentName'),
        currentMeta: $('currentMeta'),
        favoriteBtn: $('favoriteBtn'),
        retryBtn: $('retryBtn'),
        pipBtn: $('pipBtn'),
        fullscreenBtn: $('fullscreenBtn'),
        statusDot: $('statusDot'),
        statusText: $('statusText'),
        playMode: $('playMode'),
        searchInput: $('searchInput'),
        groupSelect: $('groupSelect'),
        channelList: $('channelList'),
        channelCount: $('channelCount'),
        filterCount: $('filterCount'),
        loadMoreBtn: $('loadMoreBtn'),
        sourceSummary: $('sourceSummary'),
        refreshBtn: $('refreshBtn'),
        navStatus: $('navStatus'),
        toast: $('toast')
    };

    const state = {
        channels: [],
        groups: [],
        selected: null,
        query: '',
        group: 'all',
        view: 'all',
        limit: PAGE_SIZE,
        loading: false,
        loadToken: 0,
        favorites: readFavorites(),
        renderTimer: null
    };

    let hlsPlayer = null;
    let nativeCleanup = null;
    let activeLoad = 0;
    let activeMode = '';

    function readFavorites() {
        try {
            const value = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
            return new Set(Array.isArray(value) ? value.filter(Boolean) : []);
        } catch (error) {
            return new Set();
        }
    }

    function saveFavorites() {
        try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(state.favorites))); } catch (error) { }
    }

    function readLast() {
        try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch (error) { return null; }
    }

    function saveLast(channel) {
        if (!channel) return;
        try { localStorage.setItem(LAST_KEY, JSON.stringify({ sourceId: channel.sourceId, id: channel.id, url: channel.url })); } catch (error) { }
    }

    function channelKey(channel) {
        if (!channel) return '';
        return String(channel.sourceId || '') + '|' + String(channel.id || '') + '|' + String(channel.url || '');
    }

    function findChannel(reference) {
        if (!reference) return null;
        return state.channels.find(channel => {
            if (reference.sourceId && channel.sourceId !== reference.sourceId) return false;
            if (reference.id && channel.id === reference.id) return true;
            return Boolean(reference.url && channel.url === reference.url);
        }) || null;
    }

    function channelFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const id = params.get('id');
        if (!id) return null;
        return findChannel({ sourceId: params.get('source') || '', id, url: params.get('url') || '' });
    }

    function updateUrl(channel) {
        const params = new URLSearchParams();
        if (channel) {
            if (channel.sourceId) params.set('source', channel.sourceId);
            if (channel.id) params.set('id', channel.id);
        }
        const query = params.toString();
        try {
            window.history.replaceState(null, '', '/live' + (query ? '?' + query : ''));
        } catch (error) { }
    }

    function setNavStatus(kind, message) {
        dom.navStatus.className = 'nav-status' + (kind ? ' ' + kind : '');
        dom.navStatus.replaceChildren();
        const icon = document.createElement('i');
        icon.className = 'fas fa-circle';
        dom.navStatus.append(icon, document.createTextNode(' ' + message));
    }

    function setStatus(kind, message) {
        dom.statusDot.className = 'status-dot' + (kind ? ' ' + kind : '');
        dom.statusText.textContent = message;
    }

    function setPlayMode(message) {
        if (!message) {
            dom.playMode.hidden = true;
            dom.playMode.textContent = '';
            return;
        }
        dom.playMode.hidden = false;
        dom.playMode.textContent = message;
    }

    function showEmpty(title, detail) {
        dom.emptyState.hidden = false;
        const strong = dom.emptyState.querySelector('strong');
        const span = dom.emptyState.querySelector('span');
        if (strong) strong.textContent = title;
        if (span) span.textContent = detail;
    }

    function hideEmpty() {
        dom.emptyState.hidden = true;
    }

    function showToast(message, timeout) {
        dom.toast.textContent = String(message || '');
        dom.toast.hidden = false;
        clearTimeout(showToast.timer);
        showToast.timer = setTimeout(() => { dom.toast.hidden = true; }, timeout || 3200);
    }

    function showPlayerToast(message, timeout) {
        dom.playerToast.textContent = String(message || '');
        dom.playerToast.hidden = false;
        clearTimeout(showPlayerToast.timer);
        showPlayerToast.timer = setTimeout(() => { dom.playerToast.hidden = true; }, timeout || 3600);
    }

    function listMessage(iconClass, title, detail) {
        const box = document.createElement('div');
        box.className = 'list-message';
        const icon = document.createElement('i');
        icon.className = iconClass;
        const strong = document.createElement('div');
        strong.textContent = title;
        const span = document.createElement('div');
        span.textContent = detail || '';
        box.append(icon, strong, span);
        return box;
    }

    function filteredChannels() {
        const query = state.query.trim().toLowerCase();
        return state.channels.filter(channel => {
            if (state.view === 'favorites' && !state.favorites.has(channel.url)) return false;
            if (state.group !== 'all' && (channel.group || '未分组') !== state.group) return false;
            if (!query) return true;
            const haystack = [channel.name, channel.group, channel.sourceName, channel.rawName]
                .filter(Boolean).join(' ').toLowerCase();
            return haystack.includes(query);
        });
    }

    function updateGroupOptions(groups) {
        const current = state.group;
        dom.groupSelect.replaceChildren();
        const all = document.createElement('option');
        all.value = 'all';
        all.textContent = '全部分组';
        dom.groupSelect.append(all);
        groups.forEach(group => {
            const option = document.createElement('option');
            option.value = group;
            option.textContent = group;
            dom.groupSelect.append(option);
        });
        if (current !== 'all' && !groups.includes(current)) state.group = 'all';
        dom.groupSelect.value = state.group;
    }

    function updateFavoriteButton() {
        const active = Boolean(state.selected && state.favorites.has(state.selected.url));
        dom.favoriteBtn.disabled = !state.selected;
        dom.favoriteBtn.classList.toggle('favorite', active);
        const icon = dom.favoriteBtn.querySelector('i');
        if (icon) icon.className = active ? 'fas fa-star' : 'far fa-star';
        dom.favoriteBtn.title = active ? '取消收藏频道' : '收藏频道';
    }

    function updateCurrentUi() {
        const channel = state.selected;
        dom.currentLogo.replaceChildren();
        if (!channel) {
            const icon = document.createElement('i');
            icon.className = 'fas fa-tv';
            dom.currentLogo.append(icon);
            dom.currentName.textContent = '电视直播';
            dom.currentMeta.textContent = '请选择一个频道';
            updateFavoriteButton();
            return;
        }
        if (channel.logo) {
            const image = document.createElement('img');
            image.src = channel.logo;
            image.alt = '';
            image.referrerPolicy = 'no-referrer';
            image.onerror = () => {
                dom.currentLogo.replaceChildren();
                const icon = document.createElement('i');
                icon.className = 'fas fa-tv';
                dom.currentLogo.append(icon);
            };
            dom.currentLogo.append(image);
        } else {
            const icon = document.createElement('i');
            icon.className = 'fas fa-tv';
            dom.currentLogo.append(icon);
        }
        dom.currentName.textContent = channel.name || '未命名频道';
        dom.currentMeta.textContent = [channel.group || '未分组', channel.sourceName || ''].filter(Boolean).join(' · ');
        dom.retryBtn.disabled = false;
        dom.fullscreenBtn.disabled = false;
        dom.pipBtn.disabled = !document.pictureInPictureEnabled;
        updateFavoriteButton();
    }

    function makeChannelItem(channel) {
        const item = document.createElement('div');
        item.className = 'channel-item';
        item.tabIndex = 0;
        item.setAttribute('role', 'button');
        item.setAttribute('aria-label', '播放 ' + (channel.name || '频道'));
        if (state.selected && state.selected.url === channel.url) item.classList.add('active');

        const logo = document.createElement('div');
        logo.className = 'channel-logo';
        const letter = (channel.name || '?').trim().charAt(0).toUpperCase() || '?';
        logo.textContent = letter;
        if (channel.logo) {
            const image = document.createElement('img');
            image.src = channel.logo;
            image.alt = '';
            image.loading = 'lazy';
            image.referrerPolicy = 'no-referrer';
            image.onerror = () => image.remove();
            logo.append(image);
        }

        const copy = document.createElement('div');
        copy.className = 'channel-copy';
        const name = document.createElement('div');
        name.className = 'channel-name';
        name.textContent = channel.name || '未命名频道';
        const meta = document.createElement('div');
        meta.className = 'channel-meta';
        meta.textContent = [channel.group || '未分组', channel.sourceName || ''].filter(Boolean).join(' · ');
        copy.append(name, meta);

        const star = document.createElement('button');
        star.type = 'button';
        star.className = 'channel-star' + (state.favorites.has(channel.url) ? ' active' : '');
        star.title = state.favorites.has(channel.url) ? '取消收藏' : '收藏频道';
        const starIcon = document.createElement('i');
        starIcon.className = state.favorites.has(channel.url) ? 'fas fa-star' : 'far fa-star';
        star.append(starIcon);
        star.addEventListener('click', event => {
            event.stopPropagation();
            toggleFavorite(channel);
        });

        item.append(logo, copy, star);
        item.addEventListener('click', () => selectChannel(channel));
        item.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                selectChannel(channel);
            }
        });
        return item;
    }

    function renderList(resetLimit) {
        if (resetLimit) state.limit = PAGE_SIZE;
        const list = filteredChannels();
        dom.filterCount.textContent = list.length ? list.length + ' 个' : '';
        dom.channelList.replaceChildren();

        if (state.loading && !state.channels.length) {
            dom.channelList.append(listMessage('fas fa-spinner fa-spin', '正在读取直播源', '频道较多时可能需要几秒钟'));
            dom.loadMoreBtn.hidden = true;
            return;
        }
        if (!list.length) {
            let title = '没有找到频道';
            let detail = '换一个关键词或切换分组试试';
            if (state.view === 'favorites') {
                title = '还没有收藏频道';
                detail = '点频道右侧的星标即可收藏';
            } else if (!state.channels.length) {
                title = '站点还没有配置直播源';
                detail = '请管理员在后台「电视直播」里添加 M3U 订阅';
            }
            dom.channelList.append(listMessage('fas fa-tv', title, detail));
            dom.loadMoreBtn.hidden = true;
            return;
        }

        const fragment = document.createDocumentFragment();
        list.slice(0, state.limit).forEach(channel => fragment.append(makeChannelItem(channel)));
        dom.channelList.append(fragment);
        dom.loadMoreBtn.hidden = list.length <= state.limit;
        dom.loadMoreBtn.textContent = '加载更多频道（剩余 ' + Math.max(0, list.length - state.limit) + '）';
        requestAnimationFrame(() => {
            const active = dom.channelList.querySelector('.channel-item.active');
            if (active) active.scrollIntoView({ block: 'nearest' });
        });
    }

    function selectChannel(channel, options) {
        if (!channel) return;
        const opts = options || {};
        state.selected = channel;
        saveLast(channel);
        if (opts.updateUrl !== false) updateUrl(channel);
        hideEmpty();
        updateCurrentUi();
        renderList(false);
        if (opts.autoplay !== false) playChannel(channel);
    }

    function toggleFavorite(channel) {
        const target = channel || state.selected;
        if (!target) return;
        const active = state.favorites.has(target.url);
        if (active) state.favorites.delete(target.url);
        else state.favorites.add(target.url);
        saveFavorites();
        updateFavoriteButton();
        renderList(false);
        showToast(active ? '已取消收藏' : '已收藏频道');
    }

    function updateSourceSummary(sources) {
        const list = Array.isArray(sources) ? sources : [];
        const failed = list.filter(source => source.error);
        if (!list.length) {
            dom.sourceSummary.textContent = '没有启用的直播源';
            dom.sourceSummary.title = '';
            return;
        }
        dom.sourceSummary.textContent = '已启用 ' + list.length + ' 个源' + (failed.length ? ' · ' + failed.length + ' 个读取失败' : '');
        dom.sourceSummary.title = failed.map(source => source.name + '：' + source.error).join('\n');
    }

    async function loadChannels(force) {
        if (state.loading) return;
        state.loading = true;
        dom.refreshBtn.disabled = true;
        const previous = state.selected ? { sourceId: state.selected.sourceId, id: state.selected.id, url: state.selected.url } : null;
        setNavStatus('', '正在读取频道');
        if (!state.channels.length) renderList(true);
        try {
            const response = await fetch('/api/live/channels' + (force ? '?force=1' : ''), { cache: 'no-store' });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || '频道接口返回 HTTP ' + response.status);
            state.channels = (Array.isArray(data.channels) ? data.channels : []).filter(channel => channel && channel.url);
            state.groups = Array.isArray(data.groups) ? data.groups : [];
            updateGroupOptions(state.groups);
            updateSourceSummary(data.sources);
            dom.channelCount.textContent = state.channels.length + ' 个频道 · ' + (Number(data.activeSources) || 0) + ' 个源';

            if (data.enabled === false) {
                showEmpty('直播功能未开启', '管理员可以在后台「电视直播」中启用');
                state.channels = [];
                renderList(true);
                setNavStatus('bad', '直播未启用');
                return;
            }

            if (!state.channels.length) {
                state.selected = null;
                updateCurrentUi();
                showEmpty('暂时没有可用频道', '请稍后刷新，或让管理员检查直播源');
                renderList(true);
                setNavStatus('bad', '没有可用频道');
                return;
            }

            const refreshed = previous ? findChannel(previous) : null;
            if (refreshed) {
                state.selected = refreshed;
                updateCurrentUi();
            } else if (!state.selected) {
                const initial = channelFromUrl() || findChannel(readLast()) || state.channels[0];
                if (initial) {
                    state.selected = initial;
                    saveLast(initial);
                    updateUrl(initial);
                    updateCurrentUi();
                    hideEmpty();
                    playChannel(initial);
                }
            }
            renderList(true);
            setNavStatus('ok', state.channels.length + ' 个频道');
        } catch (error) {
            setNavStatus('bad', '频道加载失败');
            setStatus('error', error.message || '频道加载失败');
            showEmpty('频道加载失败', error.message || '请检查服务器网络后重试');
            dom.channelList.replaceChildren(listMessage('fas fa-triangle-exclamation', '加载失败', error.message || ''));
            showToast(error.message || '频道加载失败');
        } finally {
            state.loading = false;
            dom.refreshBtn.disabled = false;
        }
    }

    function detachPlayback() {
        if (hlsPlayer) {
            try { hlsPlayer.destroy(); } catch (error) { }
            hlsPlayer = null;
        }
        if (nativeCleanup) {
            try { nativeCleanup(); } catch (error) { }
            nativeCleanup = null;
        }
        try { dom.video.pause(); } catch (error) { }
        dom.video.removeAttribute('src');
        try { dom.video.load(); } catch (error) { }
    }

    function failPlayback(message) {
        detachPlayback();
        setStatus('error', message || '直播流加载失败');
        setPlayMode('连接失败');
        showPlayerToast(message || '直播流加载失败');
    }

    function attemptPlay(token) {
        if (token !== activeLoad) return;
        const result = dom.video.play();
        if (result && typeof result.catch === 'function') {
            result.catch(() => {
                if (token !== activeLoad) return;
                setStatus('', '频道已加载，点击播放器开始播放');
                showPlayerToast('浏览器拦截了自动播放，请点播放键');
            });
        }
    }

    function setupHls(mediaUrl, mode, channel, token) {
        const HlsClass = window.Hls;
        if (!HlsClass || !HlsClass.isSupported()) {
            setupNative(mediaUrl, mode, channel, token);
            return;
        }
        let mediaRecovered = false;
        const hls = new HlsClass({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 30,
            maxBufferLength: 30,
            manifestLoadingTimeOut: 15000,
            levelLoadingTimeOut: 15000,
            fragLoadingTimeOut: 24000
        });
        hlsPlayer = hls;
        hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
            if (token !== activeLoad) return;
            attemptPlay(token);
        });
        hls.on(HlsClass.Events.ERROR, (event, data) => {
            if (!data || !data.fatal || token !== activeLoad) return;
            if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR && !mediaRecovered) {
                mediaRecovered = true;
                setStatus('connecting', '正在恢复解码...');
                try { hls.recoverMediaError(); } catch (error) { }
                return;
            }
            if (mode === 'direct' && channel.proxyUrl) {
                fallbackToProxy(channel, token, '直连失败，正在切换服务器代理');
                return;
            }
            failPlayback('直播流加载失败，请换台或稍后重试');
        });
        try {
            hls.loadSource(mediaUrl);
            hls.attachMedia(dom.video);
            attemptPlay(token);
        } catch (error) {
            if (mode === 'direct' && channel.proxyUrl) fallbackToProxy(channel, token, '直连失败，正在切换服务器代理');
            else failPlayback(error.message || '直播流初始化失败');
        }
    }

    function setupNative(mediaUrl, mode, channel, token) {
        const onError = () => {
            dom.video.removeEventListener('error', onError);
            if (token !== activeLoad) return;
            if (mode === 'direct' && channel.proxyUrl) {
                fallbackToProxy(channel, token, '直连失败，正在切换服务器代理');
                return;
            }
            failPlayback('当前频道无法播放，请换台或稍后重试');
        };
        nativeCleanup = () => dom.video.removeEventListener('error', onError);
        dom.video.addEventListener('error', onError);
        dom.video.src = mediaUrl;
        dom.video.load();
        attemptPlay(token);
    }

    function setupStream(mediaUrl, mode, channel, token) {
        if (token !== activeLoad) return;
        activeMode = mode;
        setStatus('connecting', mode === 'proxy' ? '正在通过服务器连接...' : '正在直连频道...');
        setPlayMode(mode === 'proxy' ? '服务器代理' : '直连');
        const nativeMedia = /\.(mp4|m4v|webm|ogg)(?:$|\?)/i.test(channel.url || '');
        if (/\.flv(?:$|\?)/i.test(channel.url || '')) {
            failPlayback('当前版本暂不支持 FLV 直播，请换一个 HLS 频道');
            return;
        }
        if (nativeMedia) setupNative(mediaUrl, mode, channel, token);
        else setupHls(mediaUrl, mode, channel, token);
    }

    function fallbackToProxy(channel, token, message) {
        if (token !== activeLoad) return;
        if (!channel.proxyUrl) {
            failPlayback('直连失败，并且没有可用的服务器代理地址');
            return;
        }
        detachPlayback();
        showPlayerToast(message || '正在切换服务器代理');
        setupStream(channel.proxyUrl, 'proxy', channel, token);
    }

    function playChannel(channel) {
        if (!channel || !channel.url) return;
        const token = ++activeLoad;
        detachPlayback();
        hideEmpty();
        activeMode = '';
        const url = channel.url;
        if (!/^https?:\/\//i.test(url)) {
            failPlayback('频道地址不是有效的 HTTP/HTTPS 地址');
            return;
        }
        if (window.location.protocol === 'https:' && /^http:\/\//i.test(url) && channel.proxyUrl) {
            showPlayerToast('HTTP 频道在 HTTPS 页面下已自动使用本站代理');
            setupStream(channel.proxyUrl, 'proxy', channel, token);
            return;
        }
        setupStream(url, 'direct', channel, token);
    }

    function toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => { });
            return;
        }
        const shell = dom.videoShell;
        if (shell.requestFullscreen) shell.requestFullscreen().catch(() => showToast('浏览器不支持全屏'));
        else if (dom.video.webkitEnterFullscreen) dom.video.webkitEnterFullscreen();
        else showToast('浏览器不支持全屏');
    }

    async function togglePictureInPicture() {
        if (!document.pictureInPictureEnabled || !dom.video.requestPictureInPicture) {
            showToast('当前浏览器不支持画中画');
            return;
        }
        try {
            if (document.pictureInPictureElement) await document.exitPictureInPicture();
            else await dom.video.requestPictureInPicture();
        } catch (error) {
            showToast('画中画打开失败');
        }
    }

    dom.video.addEventListener('playing', () => {
        if (!state.selected) return;
        setStatus('playing', activeMode === 'proxy' ? '直播中 · 服务器代理' : '直播中 · 直连');
    });

    dom.video.addEventListener('waiting', () => {
        if (!state.selected) return;
        setStatus('connecting', '缓冲中...');
    });

    dom.retryBtn.addEventListener('click', () => playChannel(state.selected));
    dom.fullscreenBtn.addEventListener('click', toggleFullscreen);
    dom.pipBtn.addEventListener('click', togglePictureInPicture);

    document.addEventListener('keydown', event => {
        const target = event.target;
        const typing = target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName);
        if (event.key === '/' && !typing) {
            event.preventDefault();
            dom.searchInput.focus();
            return;
        }
        if (typing) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            const list = filteredChannels();
            if (!list.length) return;
            event.preventDefault();
            const current = state.selected ? list.findIndex(channel => channel.url === state.selected.url) : -1;
            const delta = event.key === 'ArrowDown' ? 1 : -1;
            const nextIndex = current < 0 ? 0 : (current + delta + list.length) % list.length;
            selectChannel(list[nextIndex]);
        } else if (event.key.toLowerCase() === 'f') {
            toggleFullscreen();
        }
    });

    dom.loadMoreBtn.addEventListener('click', () => {
        state.limit += PAGE_SIZE;
        renderList(false);
    });

    dom.searchInput.addEventListener('input', () => {
        state.query = dom.searchInput.value || '';
        clearTimeout(state.renderTimer);
        state.renderTimer = setTimeout(() => renderList(true), 80);
    });

    dom.groupSelect.addEventListener('change', () => {
        state.group = dom.groupSelect.value || 'all';
        renderList(true);
    });

    document.querySelectorAll('.filter-btn').forEach(button => {
        button.addEventListener('click', () => {
            state.view = button.dataset.view || 'all';
            document.querySelectorAll('.filter-btn').forEach(item => item.classList.toggle('active', item === button));
            renderList(true);
        });
    });

    dom.favoriteBtn.addEventListener('click', () => toggleFavorite(state.selected));
    dom.refreshBtn.addEventListener('click', () => loadChannels(true));

    loadChannels(false);
})();

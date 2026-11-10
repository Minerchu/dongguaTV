'use strict';

const CACHE_NAME = 'donggua-shell-v1';
const CORE_ASSETS = [
    '/',
    '/style.css',
    '/manifest.webmanifest',
    '/assets/donggua-icon.png',
    '/assets/donggua-192.png',
    '/assets/favicon.png',
    '/pwa.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(CORE_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

function canHandle(request) {
    if (request.method !== 'GET') return false;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return false;
    if (request.headers.has('range')) return false;
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/tmdb/')) return false;
    if (url.pathname.startsWith('/player') || url.pathname.startsWith('/admin')) return false;
    if (url.pathname.startsWith('/wechat-guide')) return false;
    return true;
}

function isShellAsset(url) {
    return url.pathname === '/style.css'
        || url.pathname === '/manifest.webmanifest'
        || url.pathname === '/pwa.js'
        || url.pathname.startsWith('/assets/')
        || url.pathname.startsWith('/vendor/');
}

self.addEventListener('fetch', event => {
    const request = event.request;
    if (!canHandle(request)) return;
    const url = new URL(request.url);

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then(response => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put('/', copy));
                    }
                    return response;
                })
                .catch(() => caches.match('/'))
        );
        return;
    }

    if (!isShellAsset(url)) return;
    event.respondWith(
        caches.match(request).then(cached => {
            const network = fetch(request)
                .then(response => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(() => cached);
            return cached || network;
        })
    );
});

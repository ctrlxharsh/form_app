const CACHE_NAME = 'pijam-v2';

// App shell to cache on install
const APP_SHELL = [
    '/',
    '/login',
    '/grading',
    '/manifest.json',
];

// Install event - cache app shell
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // Cache what we can, don't fail on errors
            return Promise.allSettled(
                APP_SHELL.map(url =>
                    cache.add(url).catch(err => console.log('Failed to cache:', url, err))
                )
            );
        })
    );
    self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name.startsWith('pijam-') && name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') return;

    // Skip API requests - they need to go to network
    if (url.pathname.startsWith('/api/')) return;

    // Skip external requests
    if (url.origin !== self.location.origin) return;

    // For navigation requests (HTML pages)
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    // Cache the page for offline use
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseClone);
                    });
                    return response;
                })
                .catch(() => {
                    // Offline - try cache, then fallback to home
                    return caches.match(request).then((cached) => {
                        if (cached) return cached;
                        return caches.match('/');
                    });
                })
        );
        return;
    }

    // For static assets (JS, CSS, images)
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            // Return from cache if available
            if (cachedResponse) {
                // Update cache in background
                event.waitUntil(
                    fetch(request).then((response) => {
                        if (response.ok) {
                            caches.open(CACHE_NAME).then((cache) => {
                                cache.put(request, response);
                            });
                        }
                    }).catch(() => { })
                );
                return cachedResponse;
            }

            // Fetch from network
            return fetch(request).then((response) => {
                // Cache successful responses
                if (response.ok) {
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseToCache);
                    });
                }
                return response;
            }).catch(() => {
                // Return empty response for failed asset requests
                return new Response('', { status: 503 });
            });
        })
    );
});

const CACHE_NAME = 'pijam-v5';

// App shell to cache on install
const APP_SHELL = [
    '/',
    '/login',
    '/grading',
    '/manifest.webmanifest',
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
                .catch(async () => {
                    // Offline - try cache, then fallback to home (ignoring Vary headers for Next.js)
                    const cached = await caches.match(request, { ignoreVary: true });
                    if (cached) return cached;
                    const home = await caches.match('/', { ignoreVary: true });
                    if (home) return home;
                    
                    // Safe fallback HTML page if cache is empty/stale
                    return new Response(
                        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Offline</title>' +
                        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
                        '<style>body{font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:50px;color:#333;background:#f9f9f9}' +
                        'h1{color:#ff4d4d}a{color:#0066cc;text-decoration:none}button{padding:10px 20px;background:#0066cc;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:16px;margin-top:20px}</style></head>' +
                        '<body><h1>You are Offline</h1><p>This assessment portal page is not cached for offline use yet.</p>' +
                        '<button onclick="window.location.href=\'/\'">Go to Dashboard</button></body></html>',
                        {
                            status: 503,
                            headers: { 'Content-Type': 'text/html' }
                        }
                    );
                })
        );
        return;
    }

    // For client-side RSC payload fetches (Next.js App Router navigation)
    if (request.headers.get('RSC') === '1' || url.searchParams.has('_rsc')) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.ok) {
                        // Cache the RSC payload under a clean request to avoid Vary mismatch and _rsc query parameter differences
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            const cleanUrl = new URL(request.url);
                            cleanUrl.searchParams.delete('_rsc');
                            const cleanRequest = new Request(cleanUrl.toString(), { headers: { 'RSC': '1' } });
                            cache.put(cleanRequest, responseClone);
                        });
                    }
                    return response;
                })
                .catch(async () => {
                    // Offline - try cache with clean request, ignoring Vary headers
                    const cleanUrl = new URL(request.url);
                    cleanUrl.searchParams.delete('_rsc');
                    const cleanRequest = new Request(cleanUrl.toString(), { headers: { 'RSC': '1' } });
                    const cached = await caches.match(cleanRequest, { ignoreVary: true });
                    if (cached) return cached;
                    return new Response('', { status: 503 });
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

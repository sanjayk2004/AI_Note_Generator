const CACHE_NAME = 'study-ai-cache-v2'; // FIXED: Bumped version to bust old cache
const ASSETS = [
    '/',
    '/static/css/style.css',
    '/static/js/script.js',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Poppins:wght@400;500;600;700;800&family=Outfit:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
    'https://cdn.jsdelivr.net/npm/marked/marked.min.js'
];

// Install Service Worker and cache resources
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        }).then(() => self.skipWaiting())
    );
});

// Activate Service Worker and clean up old caches
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch events: Network first, fallback to Cache for page/assets. Pass API requests to network.
self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);

    // FIXED: More comprehensive API route exclusion
    // Don't intercept API/export routes or non-GET requests
    if (e.request.method !== 'GET') return;

    // FIXED: Explicitly bypass all API endpoints to prevent stale cache interference
    const apiPaths = [
        '/upload', 
        '/process-text',
        '/generate', 
        '/chat', 
        '/export', 
        '/history', 
        '/clear-history', 
        '/download',
        '/health'
    ];
    if (apiPaths.some(path => url.pathname.startsWith(path))) return;

    // FIXED: Bypass JSON requests (API responses)
    if (e.request.headers.get('accept')?.includes('application/json')) return;

    // FIXED: Bypass requests with auth tokens or API keys
    if (e.request.headers.get('authorization')) return;

    e.respondWith(
        fetch(e.request)
            .then((response) => {
                // If response is valid, clone and cache it
                if (response.ok && response.type === 'basic') {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(e.request, responseClone);
                    });
                }
                return response;
            })
            .catch(() => {
                // Fallback to cache if network fails
                return caches.match(e.request);
            })
    );
});
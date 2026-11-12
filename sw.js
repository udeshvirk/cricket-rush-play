// Offline support. VERSION is stamped with the commit when the game is published (tools/build-play.sh), so players get the new game.
const VERSION = 'cricket-rush-43771c3';
const SHELL = ['./', 'index.html', 'render3d.js', 'commentary.js', 'player-production/config.js', 'player-production/motion.js', 'vendor/three.min.js', 'vendor/postprocessing.min.js', 'vendor/GLTFLoader.js', 'vendor/SkeletonUtils.js', 'vendor/player-rb.js', 'vendor/equipment-model.js', 'vendor/grip-model.js', 'vendor/fielder-clips.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

const FONTS = 'https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;900&family=Saira+Condensed:wght@500;600;700&display=swap';   // the same address as in index.html

// Save the game's files one by one (so one slow file doesn't stop the rest), then the fonts if they can be reached.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(async c => {
    await Promise.all(SHELL.map(f => c.add(new Request(f, { cache: 'reload' }))));
    try {
      const css = await fetch(FONTS); if (css.ok) {
        await c.put(FONTS, css.clone());
        const files = [...(await css.text()).matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]);
        await Promise.all(files.map(u => fetch(u).then(r => r.ok && c.put(u, r)).catch(() => {})));
      }
    } catch (err) {}
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// the network's answer, or nothing if it takes longer than ms (a phone that is "connected" with no internet can hang for a minute)
const quick = (req, ms) => new Promise((ok, bad) => { const t = setTimeout(() => bad(new Error('slow')), ms); fetch(req).then(r => { clearTimeout(t); ok(r); }, err => { clearTimeout(t); bad(err); }); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // the game page: the network first (so updates arrive), but only for 3 seconds; then the saved copy
  if (req.mode === 'navigate') {
    e.respondWith(quick(req, 3000).then(r => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put('index.html', copy)); } return r; })
      .catch(() => caches.match('index.html').then(hit => hit || fetch(req))));
    return;
  }
  // everything else (scripts, icons, fonts): the saved copy; fetched and saved on first use. A font that can't be had is
  // answered with an empty file, so the page never waits for it.
  const font = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (url.origin === location.origin || font) {
    e.respondWith(caches.match(req, { ignoreSearch: url.origin === location.origin }).then(hit => hit || (font ? quick(req, 3000) : fetch(req)).then(r => {
      if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return r;
    }).catch(err => { if (font) return new Response('', { status: 200, headers: { 'Content-Type': 'text/css' } }); throw err; })));
  }
});

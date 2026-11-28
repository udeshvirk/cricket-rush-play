// Offline support. VERSION is stamped with the commit when the game is published (tools/build-play.sh), so players get the new game.
const VERSION = 'cricket-rush-bd5d01d';
const SHELL = ['./', 'index.html', 'privacy.html', 'credits.html', 'vendor/three-LICENSE.txt', 'vendor/player-rb-LICENSE.txt', 'vendor/postprocessing-LICENSE.txt', 'vendor/equipment-LICENSE.txt', 'vendor/fielder-clips-LICENSE.txt', 'vendor/fonts/OFL-Barlow.txt', 'presentation.css', 'vendor/fonts/barlow-condensed-800.ttf', 'tournament.js', 'franchise-teams.js', 'render3d.js', 'commentary.js', 'identity-migration.js', 'player-production/config.js', 'player-production/locomotion.js', 'player-production/equipment-preview.js', 'player-production/motion.js', 'player-production/batting-clips.js', 'player-production/cut-recordings.js', 'player-production/defence-recordings.js', 'player-production/drive-recordings.js', 'player-production/on-drive-recordings.js', 'player-production/straight-drive-recordings.js', 'player-production/leg-recordings.js', 'player-production/slog-recordings.js', 'player-production/stance-recordings.js', 'player-production/sweep-recordings.js', 'player-production/stokes-recordings.js', 'player-production/walkoff-recordings.js', 'player-production/diagnostics.js', 'vendor/three.min.js', 'vendor/postprocessing.min.js', 'vendor/GLTFLoader.js', 'vendor/SkeletonUtils.js', 'vendor/player-rb.js', 'vendor/equipment-model.js', 'vendor/grip-model.js', 'vendor/fielder-clips.js', 'manifest.webmanifest', 'brand/stumpflare-mark.svg', 'icons/stumpflare-192.png', 'icons/stumpflare-512.png', 'icons/stumpflare-maskable-512.png', 'icons/stumpflare-apple-180.png', 'icons/player-faces.jpg'];

// All presentation assets, including the headline font, are served locally.
// Some hosts redirect pages (Cloudflare Pages sends index.html to ./ and privacy.html to privacy). A browser refuses a redirected
// answer for a page it opens, so the saved copy is a fresh, plain response: otherwise the game would not open offline.
const plain = async r => r.redirected ? new Response(await r.blob(), { status: r.status, statusText: r.statusText, headers: r.headers }) : r;
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(async c => {
    await Promise.all(SHELL.map(async f => {
      const req = new Request(f, { cache: 'reload' }), r = await fetch(req);
      if (!r.ok) throw new Error('could not save ' + f + ' (' + r.status + ')');
      await c.put(req, await plain(r));
    }));
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
  // Cache each document separately: visiting legal/press pages must never replace the game.
  if (req.mode === 'navigate' && url.origin === location.origin) {
    const root = new URL('./', self.location.href).pathname;
    const isGame = url.pathname === root || url.pathname === root + 'index.html';
    // Cloudflare Pages answers privacy.html with a redirect to privacy (and the browser remembers it), so both name one saved page.
    const page = url.pathname.startsWith(root) ? url.pathname.slice(root.length) : '';
    const key = isGame ? 'index.html' : page && !page.includes('.') && SHELL.includes(page + '.html') ? page + '.html' : req;
    e.respondWith(quick(req, 3000).then(async r => {
      if (r.ok) { const c = await caches.open(VERSION); await c.put(key, r.clone()); }
      return r;
    }).catch(async () => (await caches.match(key, { ignoreSearch: true })) ||
      new Response('This page is not available offline yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } })));
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

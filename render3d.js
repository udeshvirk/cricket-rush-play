// Stumpflare: the 3D view (three.js). The game itself (index.html) runs the match and the 2D guides;
// this file only draws the world from the game's state: the same camera, ball and player joints.
// The game calls Cricket3D(G) with a view of its state; it returns null if WebGL isn't available (the game keeps its 2D picture).
window.Cricket3D = function (G) {
  'use strict';
  if (!window.THREE) return null;
  const { touch, LIGHTS, BOARDS, STAND_IN, STAND_OUT, STAND_H, PITCH, CREASE, ROPE, lerp, people, ballPos, cam, deg, $ } = G;
  const T = THREE;
  const presentationSlice = !!window.CR_PLAYER_PRODUCTION?.slice;
  const renderQuery = new URLSearchParams(location.search);
  // Opt-in detailed player presentation; reference presentation variants retain their own settings.
  const LOOK_PLAYER = !!window.CR_PLAYER_PRODUCTION?.enabled && renderQuery.get('look') === 'player' && !window.CR_PLAYER_PRODUCTION?.reference;
  const PLAYER_FIT = LOOK_PLAYER && renderQuery.get('fit') !== 'old';
  const LOOK_REFINED = renderQuery.get('look') === 'refined' && !window.CR_PLAYER_PRODUCTION?.enabled && !window.CR_PLAYER_PRODUCTION?.reference;
  if (T.ColorManagement) T.ColorManagement.legacyMode = false;   // colours given as '#hex' are sRGB, as in CSS
  const view = document.getElementById('view3d');
  let renderer;
  try {
    renderer = new T.WebGLRenderer({ canvas: view, antialias: true, powerPreference: 'high-performance' });
  } catch (e) { view.style.display = 'none'; return null; }

  // ---------------------------------------------------------------- settings
  const KEY = 'cricket-rush-gfx';
  let on = true;   // the 3D view is the default; 2D only for players who chose it
  try { on = localStorage.getItem(KEY) !== '2d'; } catch (e) {}
  const lowEnd = touch;   // phones and tablets: lighter shadows and resolution
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;

  const scene = new T.Scene();
  scene.fog = new T.Fog(0x16224a, 190, 520);
  scene.background=new T.Color(0x14243b);
  const camera = new T.PerspectiveCamera(30, 1, 0.3, 900);
  const profiling = new URLSearchParams(location.search).get('profile') === '1';
  const perf = profiling && window.CricketDiagnostics ? window.CricketDiagnostics.create({
    userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio || 1,
    webgl2: renderer.capabilities.isWebGL2, threeRevision: T.REVISION,
    renderer: renderer.getContext().getParameter(renderer.getContext().RENDERER),
    query: location.search
  }) : null;
  let perfLast = null;
  if (perf) {
    renderer.info.autoReset = false;
    window.CR_PERF = { snapshot: perf.snapshot, samples: perf.samples, reset() { perf.reset(); perfLast = null; } };
    document.addEventListener('visibilitychange', () => { perfLast = null; });
  }
  const V = (a) => new T.Vector3(a[0], a[1], a[2]);

  // canvas textures. Kept in ordinary memory (willReadFrequently): a phone that drops the GPU while the game is in the
  // background also wipes GPU-backed canvases, and the grass and pitch came back black when 3D was turned on again.
  const SOFT2D = { willReadFrequently: true };
  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d', SOFT2D), w, h);
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; }
    return t;
  }
  const glowTex = canvasTex(128, 128, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.2, 'rgba(255,248,225,0.55)'); r.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  });
  const blobTex = canvasTex(64, 64, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(0,0,0,0.55)'); r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  });
  const noise = (g, w, h, n, cols, size) => {
    for (let i = 0; i < n; i++) { g.fillStyle = cols[(Math.random() * cols.length) | 0]; g.fillRect(Math.random() * w, Math.random() * h, size, size); }
  };

  // ---------------------------------------------------------------- sky
  let stars = null;
  const sky = new T.Mesh(new T.SphereGeometry(600, 32, 16), new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new T.Color(0x0b1838) }, mid: { value: new T.Color(0x24407a) }, bot: { value: new T.Color(0x6f6f9e) } },   // late dusk: deep blue above, a pale band on the horizon
    vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying float h; void main(){ vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.6, h)) : mix(bot, mid, smoothstep(-0.05, 0.12, h)); gl_FragColor = vec4(c, 1.0);\n #include <tonemapping_fragment>\n #include <encodings_fragment>\n }',
  }));
  scene.add(sky);
  if(presentationSlice) {
    sky.material.uniforms.top.value.set('#608db7');
    sky.material.uniforms.mid.value.set('#adcadc');
    sky.material.uniforms.bot.value.set('#dce3dc');
    scene.fog.color.set('#b7cbd2');
    scene.background.set('#adcadc');
  }
  {
    const n = 900, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = 0.18 + Math.random() * 1.2, r = 560;
      pos[i * 3] = Math.cos(e) * Math.sin(a) * r; pos[i * 3 + 1] = Math.sin(e) * r; pos[i * 3 + 2] = Math.cos(e) * Math.cos(a) * r;
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
    stars = new T.Points(g, new T.PointsMaterial({ color: 0xc8d2ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: presentationSlice ? 0 : 0.7 }));
    scene.add(stars);
  }

  // ---------------------------------------------------------------- lights: four floodlight towers
  const hemi = new T.HemisphereLight(window.CR_PLAYER_PRODUCTION?.reference?0xc4cbd7:0xb9c8ff,0x3a4a30,window.CR_PLAYER_PRODUCTION?.reference ? .62 : .6);
  scene.add(hemi);
  const towerGlows = [], towerBanks = [];   // floodlit air: plenty of soft light from all round
  if(presentationSlice) {
    // Broad daylight fill keeps eyes readable underneath the visor.
    scene.add(new T.HemisphereLight(0xdfeeff,0x82745b,.55));
  }
  const lightDirs = [];
  LIGHTS.forEach((L, i) => {
    const top = [L[0], 46, L[2]];
    const d = new T.DirectionalLight(0xfff3dd, i === 0 ? 1.25 : 0.42);
    if(presentationSlice) d.intensity=i===0?1.5:.08;
    d.position.set(top[0], top[1], top[2]); d.target.position.set(0, 0, 8);
    scene.add(d); scene.add(d.target);
    if (i === 0) {
      d.castShadow = true;
      const s = window.CR_PLAYER_PRODUCTION?.reference ? (lowEnd?2048:4096) : (lowEnd?1024:2048);
      d.shadow.mapSize.set(s, s);
      const c = d.shadow.camera; c.left = -60; c.right = 60; c.top = 60; c.bottom = -60; c.near = 20; c.far = 260;
      d.shadow.bias = -0.0004; d.shadow.normalBias = 0.03;
      if(window.CR_PLAYER_PRODUCTION?.reference) {
        c.left=-24;c.right=24;c.top=24;c.bottom=-24;
        d.shadow.bias=-.00004;d.shadow.normalBias=.003;
      }
    }
    lightDirs.push(d);
    // the tower and its lamp bank
    const tower = new T.Mesh(new T.CylinderGeometry(0.5, 1.1, 46, 8), new T.MeshStandardMaterial({ color: 0x222a44, roughness: 0.8, metalness: 0.3 }));
    tower.position.set(L[0], 23, L[2]); scene.add(tower);
    const bank = new T.Mesh(new T.BoxGeometry(11, 6, 0.8), new T.MeshBasicMaterial({ map: canvasTex(128, 64, (g, w, h) => {
      g.fillStyle = '#2a3150'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) { g.fillStyle = '#fffbe8'; g.fillRect(4 + x * 15.5, 4 + y * 15, 11, 11); }
    }) }));
    bank.position.set(top[0], top[1] + 2, top[2]); bank.lookAt(0, 0, 8); scene.add(bank); towerBanks.push(bank);
    const glow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xfff4d8, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
    glow.visible = !presentationSlice;
    glow.position.copy(bank.position).multiplyScalar(0.985); glow.scale.set(60, 60, 1); scene.add(glow); towerGlows.push(glow);
  });

  // ---------------------------------------------------------------- ground
  const outside = new T.Mesh(new T.CircleGeometry(300, 48), new T.MeshStandardMaterial({ color: 0x0b160f, roughness: 1 }));
  outside.rotation.x = -Math.PI / 2; outside.position.y = -0.06; scene.add(outside);

  const grassTex = canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#295f3b'; g.fillRect(0, 0, w, h);
    const k = w / (BOARDS * 2), band = 7 * k;
    for (let x = 0; x < w; x += band * 2) { g.fillStyle = 'rgba(16,44,20,0.035)'; g.fillRect(x, 0, band, h); }
    // mowing stripes across the field (light, dark, light ...), with soft edges
    for (let y = 0; y < h; y += band * 2) {
      const gr = g.createLinearGradient(0, y, 0, y + band);
      gr.addColorStop(0, 'rgba(8,34,12,0)'); gr.addColorStop(0.12, 'rgba(8,34,12,0.17)'); gr.addColorStop(0.88, 'rgba(8,34,12,0.17)'); gr.addColorStop(1, 'rgba(8,34,12,0)');
      g.fillStyle = gr; g.fillRect(0, y, w, band);
    }
    noise(g, w, h, 26000, ['rgba(255,255,255,0.035)', 'rgba(0,0,0,0.05)', 'rgba(20,60,20,0.08)'], 2);
    const r = g.createRadialGradient(w / 2, h / 2, w * 0.1, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,220,0.07)'); r.addColorStop(1, 'rgba(0,0,0,0.14)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
  const field = new T.Mesh(new T.CircleGeometry(BOARDS, 128), new T.MeshStandardMaterial({ map: grassTex, roughness: 0.95 }));
  field.rotation.x = -Math.PI / 2; field.receiveShadow = true; scene.add(field);
  const apron = new T.Mesh(new T.RingGeometry(BOARDS, STAND_IN + 0.5, 128, 1), new T.MeshStandardMaterial({ color: 0x1a5a22, roughness: 1 }));
  apron.rotation.x = -Math.PI / 2; apron.position.y = -0.01; apron.receiveShadow = true; scene.add(apron);

  // the square and the pitch (with the creases painted on)
  const PW = 3.7, PL = PITCH + 3.2, z0 = -1.6;
  const pitchTex = canvasTex(256, 2048, (g, w, h) => {
    const X = x => (x + PW / 2) / PW * w, Z = z => (z - z0) / PL * h;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#aa9778'; g.fillRect(X(-1.52), 0, X(1.52) - X(-1.52), h);
    const clay=g.createLinearGradient(0,0,w,0);
    clay.addColorStop(0,'#a59373');clay.addColorStop(.28,'#b8a584');clay.addColorStop(.65,'#bca988');clay.addColorStop(1,'#a79677');
    g.fillStyle=clay; g.fillRect(X(-1.4),0,X(1.4)-X(-1.4),h);
    g.save(); g.beginPath(); g.rect(X(-1.52), 0, X(1.52) - X(-1.52), h); g.clip();
    noise(g, w, h, 9000, ['rgba(120,90,50,0.10)', 'rgba(255,255,240,0.06)'], 2); g.restore();
    // Soft, irregular wear in the landing/guard areas rather than painted oval spots.
    g.save();g.beginPath();g.rect(X(-1.5),0,X(1.5)-X(-1.5),h);g.clip();
    let soilSeed=47;const soilRand=()=>((soilSeed=Math.imul(soilSeed,1664525)+1013904223>>>0)/4294967296);
    for(const zc of [1.2,3.5,PITCH-1.2,PITCH-3.5]){
      for(let i=0;i<32;i++){
        const x=X((soilRand()-.5)*1.4),z=Z(zc+(soilRand()-.5)*1.6),r=5+soilRand()*15;
        const scuff=g.createRadialGradient(x,z,0,x,z,r);scuff.addColorStop(0,'rgba(92,72,43,.13)');scuff.addColorStop(1,'rgba(92,72,43,0)');
        g.fillStyle=scuff;g.fillRect(x-r,z-r,r*2,r*2);
      }
    }
    g.strokeStyle='rgba(80,67,46,.14)';g.lineWidth=.7;
    for(let i=0;i<50;i++){
      const x=X((soilRand()-.5)*2.7),z=soilRand()*h;g.beginPath();g.moveTo(x,z);
      g.lineTo(x+soilRand()*5-2,z+4+soilRand()*9);g.lineTo(x+soilRand()*8-4,z+12+soilRand()*10);g.stroke();
    }
    g.restore();
    g.fillStyle = '#f6f2e6';
    const t = 0.05;   // crease lines are 5 cm wide
    const line = (xa, za, xb, zb) => za === zb ? g.fillRect(X(xa), Z(za - t / 2), X(xb) - X(xa), Z(za + t / 2) - Z(za - t / 2))
                                               : g.fillRect(X(xa - t / 2), Z(za), X(xa + t / 2) - X(xa - t / 2), Z(zb) - Z(za));
    for (const z of [0, PITCH]) line(-1.32, z, 1.32, z);
    for (const z of [CREASE, PITCH - CREASE]) line(-1.83, z, 1.83, z);
    for (const x of [-1.32, 1.32]) { line(x, -1.22, x, CREASE); line(x, PITCH - CREASE, x, PITCH + 1.22); }
  });
  pitchTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const pitch = new T.Mesh(new T.PlaneGeometry(PW, PL), new T.MeshStandardMaterial({ map: pitchTex, roughness: 0.85, transparent: true, depthWrite: false }));
  pitch.rotation.x = -Math.PI / 2; pitch.position.set(0, 0.008, z0 + PL / 2); pitch.receiveShadow = true; scene.add(pitch);

  // rope, advertising boards, sight screens
  const rope = new T.Mesh(new T.TorusGeometry(ROPE, 0.09, 6, 220), new T.MeshStandardMaterial({ color: 0xf2eee2, roughness: 0.6 }));
  rope.rotation.x = Math.PI / 2; rope.position.y = 0.09; scene.add(rope);
  const ADS = [['STUMPFLARE', '#0a1024', '#ffb02e'], ['FLOODLIGHT FM', '#13306e', '#f3efe4'], ['SIXER COLA', '#c43a4d', '#ffffff'],
               ['GULLY BANK', '#0f5b57', '#f6d36b'], ['NIGHT OWL TEA', '#ffb02e', '#0a1024'], ['SPIN KING', '#5a47b8', '#ffffff']];
  const adTex = canvasTex(3072, 64, (g, w, h) => {
    const pw = w / ADS.length;
    ADS.forEach(([t, bg, fg], i) => {
      g.fillStyle = bg; g.fillRect(i * pw, 0, pw, h);
      g.fillStyle = fg; g.font = '900 40px "Rush Display", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(t, i * pw + pw / 2, h / 2 + 2);
    });
  }, true);
  adTex.repeat.set(-4, 1);
  const boards = new T.Mesh(new T.CylinderGeometry(BOARDS, BOARDS, 1, 160, 1, true), new T.MeshBasicMaterial({ map: adTex, side: T.BackSide }));
  boards.position.y = 0.5; scene.add(boards);
  for (const z of [-(BOARDS - 1.2), PITCH + BOARDS - 21.3]) {
    const ss = new T.Mesh(new T.BoxGeometry(9, 3.6, 0.4), new T.MeshStandardMaterial({ color: 0x1a2140, roughness: 0.9 }));
    ss.position.set(0, 1.8, z); scene.add(ss);
  }

  // ---------------------------------------------------------------- stands and crowd
  let standMesh;
  {
    const pts = [new T.Vector2(STAND_IN, 0), new T.Vector2(STAND_IN, 1.4)];
    const steps = 14;
    for (let i = 0; i < steps; i++) {
      const r = lerp(STAND_IN, STAND_OUT, i / steps), r2 = lerp(STAND_IN, STAND_OUT, (i + 1) / steps), y = lerp(1.4, STAND_H, (i + 1) / steps);
      pts.push(new T.Vector2(r, y), new T.Vector2(r2, y));
    }
    pts.push(new T.Vector2(STAND_OUT + 0.5, STAND_H + 5), new T.Vector2(STAND_OUT + 8, STAND_H + 6));
    const stand = new T.Mesh(new T.LatheGeometry(pts, 96), new T.MeshLambertMaterial({ color: 0x39456b, side: T.DoubleSide }));
    scene.add(stand); standMesh = stand;
    // a lit strip along the front of the upper deck
    const strip = new T.Mesh(new T.CylinderGeometry(STAND_OUT + 0.6, STAND_OUT + 0.6, 0.5, 96, 1, true), new T.MeshBasicMaterial({ color: 0x2ed3c6, side: T.BackSide }));
    strip.position.y = STAND_H + 0.8; scene.add(strip);
    // the roof: a wide canopy leaning out over the seats, pale underneath, with a line of lights along its front edge
    const roof = new T.Mesh(new T.LatheGeometry([new T.Vector2(STAND_OUT + 9, STAND_H + 8), new T.Vector2(STAND_OUT - 2, STAND_H + 11.5), new T.Vector2(STAND_OUT - 13, STAND_H + 12.5)], 96),
                            new T.MeshLambertMaterial({ color: 0xaab4d0, emissive: 0x2a3350, side: T.DoubleSide }));
    scene.add(roof);
    const lip = new T.Mesh(new T.TorusGeometry(STAND_OUT - 13, 0.22, 5, 160), new T.MeshBasicMaterial({ color: 0xfff6dc }));
    lip.rotation.x = Math.PI / 2; lip.position.y = STAND_H + 12.4; scene.add(lip);
    for (let i = 0; i < 48; i++) {   // the columns holding it up, at the back
      const a = i / 48 * Math.PI * 2, c = new T.Mesh(new T.BoxGeometry(0.7, 9, 0.7), stand.material);
      c.position.set(Math.sin(a) * (STAND_OUT + 7.5), STAND_H + 4.5, Math.cos(a) * (STAND_OUT + 7.5)); c.rotation.y = a; scene.add(c);
    }
  }
  // the crowd: one seated spectator per seat (some empty), all drawn in one go. Each has a shirt colour, a skin tone and a
  // phase; when the crowd cheers they bob up and throw their arms in the air (done in the vertex shader)
  const crowdU = { uCheer: { value: 0 }, uTime: { value: 0 } };
  {
    const parts = [];
    const add = (geo, part, x, y, z) => { geo = geo.toNonIndexed(); geo.translate(x, y, z); const n = geo.attributes.position.count;
      geo.setAttribute('part', new T.BufferAttribute(new Float32Array(n).fill(part), 1)); parts.push(geo); };
    { const b = new T.CylinderGeometry(0.2, 0.26, 0.56, 7); b.scale(1, 1, 0.62); add(b, 0, 0, 0.45, 0); }   // body: sloping shoulders, not a box
    add(new T.IcosahedronGeometry(0.15, 1), 1, 0, 0.88, 0.01);               // head
    add(new T.BoxGeometry(0.08, 0.42, 0.08), 2, 0.2, 0.9, 0.02);             // arms (raised; shown when cheering)
    add(new T.BoxGeometry(0.08, 0.42, 0.08), 2, -0.2, 0.9, 0.02);
    const geo = new T.BufferGeometry();
    for (const k of ['position', 'normal', 'part']) {
      const arrs = parts.map(g => g.attributes[k].array), len = arrs.reduce((a, b) => a + b.length, 0), out = new Float32Array(len);
      let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
      geo.setAttribute(k, new T.BufferAttribute(out, k === 'part' ? 1 : 3));
    }
    const steps = 14, density = lowEnd ? 0.55 : 1, seats = [];
    for (let i = 0; i < steps; i++) {
      const r = lerp(STAND_IN, STAND_OUT, (i + 0.55) / steps), y = lerp(1.4, STAND_H, (i + 1) / steps);
      const n = Math.floor(2 * Math.PI * r / 0.62 * density);
      for (let k = 0; k < n; k++) if (Math.random() > 0.1) seats.push([(k + Math.random() * 0.3) / n * Math.PI * 2, r, y]);
    }
    const N = seats.length;
    const shirtA = new Float32Array(N * 3), skinA = new Float32Array(N * 3), phaseA = new Float32Array(N);
    const SHIRTS = ['#e8e4da', '#2a62d8', '#f2c230', '#1f8f4e', '#d23b4a', '#ff8a1f', '#6f7ea8', '#8f6fd0', '#18a9c9', '#f0f0f0', '#3b62c4', '#c9c1a8', '#e8e4da', '#f2c230'];
    const SKINS = ['#8d5a3b', '#b07650', '#c99872', '#e0b48f', '#6b4029'], c = new T.Color();
    const mesh = new T.InstancedMesh(geo, null, N), m = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(), ps = new T.Vector3(), Y = new T.Vector3(0, 1, 0);
    seats.forEach(([a, r, y], i) => {
      const x = Math.sin(a) * r, z = Math.cos(a) * r, k = 1.25 + Math.random() * 0.3;   // drawn large, so rows overlap and the stand looks full
      m.compose(ps.set(x, y, z), q.setFromAxisAngle(Y, Math.atan2(-x, -z)), sc.set(k, k, k)); mesh.setMatrixAt(i, m);
      c.set(SHIRTS[(Math.random() * SHIRTS.length) | 0]).multiplyScalar(0.7 + Math.random() * 0.3);
      if(!window.CR_PLAYER_PRODUCTION?.reference)c.lerp(new T.Color('#526479'),.18);
      if(LOOK_PLAYER)c.lerp(new T.Color('#53616d'),.46).multiplyScalar(.75);
      c.toArray(shirtA, i * 3);
      c.set(SKINS[(Math.random() * SKINS.length) | 0]).multiplyScalar(0.95); c.toArray(skinA, i * 3);
      phaseA[i] = Math.random();
    });
    geo.setAttribute('aShirt', new T.InstancedBufferAttribute(shirtA, 3));
    geo.setAttribute('aSkin', new T.InstancedBufferAttribute(skinA, 3));
    geo.setAttribute('aPhase', new T.InstancedBufferAttribute(phaseA, 1));
    const mat = new T.MeshLambertMaterial({ color: 0xffffff });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, crowdU);
      sh.vertexShader = 'uniform float uCheer, uTime;\nattribute float part, aPhase;\nattribute vec3 aShirt, aSkin;\nvarying vec3 vCrowd;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vCrowd = part > 0.5 && part < 1.5 ? (position.y > 0.93 || position.z < -0.03 ? vec3(0.07, 0.05, 0.04) + aPhase * vec3(0.12, 0.08, 0.04) : aSkin) : part > 1.5 ? aSkin : aShirt;   // hair on top and behind; bare arms
  float up = uCheer * step(0.35, aPhase);
  if (part > 1.5) transformed.y = mix(0.72, transformed.y, up);    // arms fold away when calm
  transformed.y += max(0.0, sin(uTime * 9.0 + aPhase * 6.283)) * uCheer * 0.22;`);
      sh.fragmentShader = 'varying vec3 vCrowd;\n' + sh.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( vCrowd, opacity );')
        .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive + vCrowd * 0.16;');
    };
    mat.customProgramCacheKey = () => 'crowd-3';
    mesh.material = mat; mesh.frustumCulled = false;
    scene.add(mesh);
  }
  function updateCrowd() {
    crowdU.uCheer.value = Math.min(1, (G.cheer || 0) * 1.4); crowdU.uTime.value = G.clock || 0;
  }

  // ---------------------------------------------------------------- stumps
  const stumpMat = new T.MeshStandardMaterial({ color: 0xf1e6c8, roughness: 0.5 });
  const stumpGeo = new T.CylinderGeometry(0.018, 0.018, 0.71, 8); stumpGeo.translate(0, 0.355, 0);
  const bailGeo = new T.CylinderGeometry(0.011, 0.011, 0.11, 6); bailGeo.rotateZ(Math.PI / 2);
  function makeStumps(z) {
    const s = [], b = [];
    for (let i = -1; i <= 1; i++) { const m = new T.Mesh(stumpGeo, stumpMat); m.position.set(i * 0.1, 0, z); m.castShadow = true; scene.add(m); s.push(m); }
    for (const x of [-0.055, 0.055]) { const m = new T.Mesh(bailGeo, stumpMat); m.position.set(x, 0.72, z); m.castShadow = true; scene.add(m); b.push(m); }
    return { s, b, z };
  }
  const stumpsNear = makeStumps(0), stumpsFar = makeStumps(PITCH);

  // ---------------------------------------------------------------- the ball
  // the toss coin (G.coin): gold, a star on the heads side and stumps on the tails side; drawn larger than life so it reads on screen
  const coinFace = draw => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d', SOFT2D);
    const gr = g.createRadialGradient(48, 44, 6, 64, 64, 64); gr.addColorStop(0, '#ffe7a3'); gr.addColorStop(0.6, '#f0b43c'); gr.addColorStop(1, '#b8801f');
    g.fillStyle = gr; g.beginPath(); g.arc(64, 64, 64, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffe08a'; g.lineWidth = 4; g.beginPath(); g.arc(64, 64, 54, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#7a4f0e'; draw(g); const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t; };
  const coinHeads = coinFace(g => { g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 15 : 34, a = i * Math.PI / 5 - Math.PI / 2; g.lineTo(64 + r * Math.cos(a), 64 + r * Math.sin(a)); } g.fill(); });
  const coinTails = coinFace(g => { g.fillRect(38, 36, 52, 8); for (const x of [41, 59, 77]) g.fillRect(x, 48, 10, 48); });
  const coinGold = new T.MeshStandardMaterial({ color: 0xe0a83a, metalness: 0.8, roughness: 0.35 });
  const coinMesh = new T.Mesh(new T.CylinderGeometry(0.075, 0.075, 0.012, 40), [coinGold,
    new T.MeshStandardMaterial({ map: coinHeads, metalness: 0.55, roughness: 0.4 }), new T.MeshStandardMaterial({ map: coinTails, metalness: 0.55, roughness: 0.4 })]);
  coinMesh.castShadow = true; coinMesh.visible = false; scene.add(coinMesh);
  const ballMesh = new T.Mesh(new T.SphereGeometry(window.CR_PLAYER_PRODUCTION?.reference ? .036 : .045, 14, 10), new T.MeshBasicMaterial({ color: 0xffffff }));
  scene.add(ballMesh);
  // A compact highlight keeps the ball readable without washing out the
  // blade at impact. The old 55 cm halo was six times the ball's diameter.
  const ballGlow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false, blending: T.AdditiveBlending }));
  ballGlow.scale.set(0.18, 0.18, 1); scene.add(ballGlow);
  if(window.CR_PLAYER_PRODUCTION?.reference){ballGlow.scale.set(.12,.12,1);ballGlow.material.opacity=.18;}
  const blobGeo = new T.PlaneGeometry(1, 1); blobGeo.rotateX(-Math.PI / 2);
  const blobMat = new T.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
  const ballShadow = new T.Mesh(blobGeo, blobMat); ballShadow.scale.set(0.2, 1, 0.2); scene.add(ballShadow);
  const TRAIL = 12, trailPos = new Float32Array(TRAIL * 3), trailGeo = new T.BufferGeometry();
  trailGeo.setAttribute('position', new T.BufferAttribute(trailPos, 3));
  const trail = new T.Line(trailGeo, new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, blending: T.AdditiveBlending }));
  trail.frustumCulled = false; scene.add(trail);
  // a faint comet behind the ball on a six only (the owner found a glowing ball on every big hit too much)
  const COMET = 12, comet = Array.from({ length: COMET }, () => { const sp = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xfff2d0, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending }));
    sp.visible = false; scene.add(sp); return sp; });

  // ---------------------------------------------------------------- players
  const SKIN = ['#8d5a3b', '#b07650', '#c99872', '#e0b48f', '#6b4029'].map(c => new T.MeshStandardMaterial({ color: c, roughness: 0.7 }));
  const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
  const mat = c => new T.MeshStandardMaterial({ color: c, roughness: 0.7 });
  const M3 = {
    batShirt: mat('#3d7dff'), batPants: mat('#173f99'), bowlShirt: mat('#ffd23c'), bowlPants: mat('#0e6b40'), batTrim: mat('#ffffff'), bowlTrim: mat('#ffffff'),
    umpShirt: mat('#efece3'), umpPants: mat('#23262d'),   // the umpires: cream shirt, dark trousers, no team colours
    helmet: new T.MeshStandardMaterial({ color: 0x173f99, roughness: LOOK_REFINED || LOOK_PLAYER ? 0.7 : 0.62, metalness: 0.05 }),
    grille: new T.MeshStandardMaterial({ color: window.CR_PLAYER_PRODUCTION?.reference ? 0x434a4c : 0x9aa0aa,
      metalness: LOOK_REFINED ? .72 : .8, roughness: window.CR_PLAYER_PRODUCTION?.reference ? .48 : LOOK_REFINED ? .42 : .3 }),
    pads: mat('#f6f4ee'), gloves: mat('#f6f4ee'), shoe: mat('#f0f0f0'), sole: mat('#222222'),
    blade: new T.MeshStandardMaterial({ color: 0xe3c58e, roughness: 0.55 }), grip: mat('#26221e'), cap: mat('#ffd23c'),
  };
  // body shapes: limbs and trunk are turned profiles (radius along the length), so they have muscle, taper and rounded ends.
  // Each runs from y = -0.5 (the joint it starts at) to 0.5, radius 1 = the limb's width, so seg() can stretch it between joints.
  const lathe = (pts, n = 14) => {
    const v = [new T.Vector2(0, -0.5)];
    for (const [y, r] of pts) v.push(new T.Vector2(r, y));
    v.push(new T.Vector2(0, 0.5));
    const g = new T.LatheGeometry(v, n); g.computeVertexNormals(); return g;
  };
  const SHAPE = {
    thigh: lathe([[-0.5, 1.0], [-0.42, 1.2], [-0.15, 1.18], [0.2, 0.98], [0.45, 0.78], [0.5, 0.6]]),
    calf: lathe([[-0.5, 0.75], [-0.42, 0.9], [-0.2, 1.08], [0.05, 0.92], [0.35, 0.62], [0.5, 0.5]]),
    pad: lathe([[-0.52, 0.8], [-0.45, 1.05], [-0.3, 1.0], [0.4, 0.92], [0.5, 0.75]]),
    upper: lathe([[-0.5, 0.9], [-0.4, 1.12], [-0.1, 1.08], [0.25, 0.95], [0.45, 0.82], [0.5, 0.65]]),
    fore: lathe([[-0.5, 0.75], [-0.4, 0.98], [-0.2, 1.05], [0.2, 0.8], [0.45, 0.62], [0.5, 0.5]]),
    neck: lathe([[-0.5, 1.15], [-0.3, 1.0], [0.3, 0.95], [0.5, 0.9]], 10),
    // the trunk, in a box of 1 x 1 x 1: hips, a narrower waist, a broad chest, sloping shoulders
    trunk: lathe([[-0.5, 0.4], [-0.38, 0.43], [-0.18, 0.39], [0.05, 0.43], [0.25, 0.5], [0.38, 0.5], [0.45, 0.42], [0.5, 0.3], [0.53, 0.14]], 20),
  };
  const cyl = new T.CylinderGeometry(1, 1, 1, 12);
  const sph = new T.SphereGeometry(1, 16, 12);
  const dome = new T.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const bar = new T.TorusGeometry(1, 0.035, 5, 16, Math.PI * 0.9);
  const box = new T.BoxGeometry(1, 1, 1);
  const UP = new T.Vector3(0, 1, 0);
  const va = new T.Vector3(), vb = new T.Vector3(), vd = new T.Vector3(), vs = new T.Vector3(), vf = new T.Vector3(), vu = new T.Vector3(), vx = new T.Vector3(), vy = new T.Vector3();
  const mB = new T.Matrix4();
  const HAIR = mat('#1b1410'), SHADE = new T.MeshStandardMaterial({ color: 0x111111, roughness: 0.2, metalness: 0.6 });

  // ---------------------------------------------------------------- bat and pads, built in code
  const gMerge = geos => {   // one geometry from several (positions, normals, uv if all have it)
    const g = new T.BufferGeometry(), P = [], N = [], U = [], uv = geos.every(q => q.attributes.uv);
    for (let q of geos) { q = q.index ? q.toNonIndexed() : q; P.push(...q.attributes.position.array); N.push(...q.attributes.normal.array); if (uv) U.push(...q.attributes.uv.array); }
    g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(N, 3));
    if (uv) g.setAttribute('uv', new T.Float32BufferAttribute(U, 2)); return g;
  };
  const gTube = (pts, rad, seg = 24, sides = 7) => new T.TubeGeometry(new T.CatmullRomCurve3(pts, false, 'centripetal'), seg, rad, sides, false);
  // rings of points joined into a skin (each ring the same length); flat = hard edges
  function gLoft(rings, closed = true, flat = false, uvOf = null) {
    const n = rings[0].length, pos = [], uv = [], idx = [];
    for (const r of rings) for (const p of r) { pos.push(p.x, p.y, p.z); if (uvOf) uv.push(...uvOf(p)); }
    for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < (closed ? n : n - 1); k++) {
      const a = i * n + k, b = i * n + (k + 1) % n, c = a + n, d = b + n; idx.push(a, b, c, b, d, c);
    }
    let g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); if (uvOf) g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); if (flat) g = g.toNonIndexed(); g.computeVertexNormals(); return g;
  }
  // The bat, in the grip's space: +y up the handle, the top of the handle at 0, the toe at -0.86; the face looks along +z.
  const BATGEAR = (() => {
    const HZ = -0.006, V = (x, y, z) => new T.Vector3(x, y, z);
    const wood = canvasTex(128, 512, (g, w, h) => {
      g.fillStyle = '#e6cf9f'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 26; i++) { const x = Math.random() * w; g.strokeStyle = 'rgba(150,110,60,' + (0.08 + Math.random() * 0.16) + ')'; g.lineWidth = 0.6 + Math.random() * 1.4;
        g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 3, h * 0.3, x - 3, h * 0.7, x + 1, h); g.stroke(); }
      const sh = g.createLinearGradient(0, 0, w, 0); sh.addColorStop(0, 'rgba(120,80,30,0.16)'); sh.addColorStop(0.2, 'rgba(0,0,0,0)'); sh.addColorStop(0.8, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(120,80,30,0.16)');
      g.fillStyle = sh; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(190,60,50,0.10)'; g.beginPath(); g.ellipse(w / 2, h * 0.68, w * 0.2, h * 0.07, 0, 0, 7); g.fill();   // a few ball marks in the middle
    });
    // the blade: cross-sections from the shoulders to the toe; the back swells to a ridge that is deepest low down
    const rings = [], Y0 = -0.3, Y1 = -0.86;
    for (let i = 0; i <= 22; i++) {
      const t = i / 22, y = Y0 + (Y1 - Y0) * t;
      const hw = 0.054 * (t < 0.1 ? 0.3 + 0.7 * Math.sin(t / 0.1 * Math.PI / 2) : t > 0.96 ? 1 - 0.12 * Math.pow((t - 0.96) / 0.04, 2) : 1);   // shoulders, rounded toe
      const ridge = 0.016 + 0.036 * Math.pow(Math.sin(Math.min(1, t / 0.72) * Math.PI / 2), 1.5) * (t > 0.72 ? 1 - 0.75 * Math.pow((t - 0.72) / 0.28, 1.6) : 1);
      const edge = 0.0135 + 0.006 * Math.sin(t * Math.PI), bow = 0.003, zf = 0.0124 - 0.004 * Math.pow(Math.abs(t - 0.45) * 1.6, 2);
      rings.push([V(-hw, y, zf - bow), V(-hw * 0.5, y, zf - bow * 0.25), V(0, y, zf), V(hw * 0.5, y, zf - bow * 0.25), V(hw, y, zf - bow),
                  V(hw, y, zf - bow - edge), V(hw * 0.45, y, zf - edge - ridge * 0.6), V(0, y, zf - 0.012 - ridge), V(-hw * 0.45, y, zf - edge - ridge * 0.6), V(-hw, y, zf - bow - edge)]);
    }
    const uvB = p => [p.x / 0.108 + 0.5, (p.y - Y1) / (Y0 - Y1)];
    const mid = r => { const c = V(0, r[0].y, 0); for (const p of r) c.z += p.z / r.length; return r.map(() => c.clone()); };
    const blade = gLoft([mid(rings[0]), ...rings, mid(rings[22])], true, false, uvB);
    // the handle: cane wrapped in a rubber grip with ribs, a cap on top, and the splice running down into the blade
    const hr = [], grip = [];
    for (let i = 0; i <= 10; i++) { const y = -0.005 - 0.3 * i / 10, r = 0.0155 + (i === 0 ? -0.003 : 0); const ring = []; for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; ring.push(V(Math.cos(a) * r, y, HZ + Math.sin(a) * r)); } hr.push(ring); }
    const cap0 = hr[0].map(() => V(0, 0, HZ));
    grip.push(gLoft([cap0, ...hr.slice(0, 10)], true));
    for (let i = 0; i < 16; i++) { const y = -0.02 - i * 0.0165, t = new T.TorusGeometry(0.0158, 0.0022, 5, 14); t.rotateX(Math.PI / 2); t.translate(0, y, HZ); grip.push(t); }
    const splice = gLoft([[V(-0.017, -0.285, HZ + 0.012), V(0.017, -0.285, HZ + 0.012), V(0.017, -0.285, HZ - 0.012), V(-0.017, -0.285, HZ - 0.012)],
                          [V(-0.017, -0.31, 0.0128), V(0.017, -0.31, 0.0128), V(0.017, -0.31, -0.02), V(-0.017, -0.31, -0.02)],
                          [V(-0.001, -0.43, 0.0128), V(0.001, -0.43, 0.0128), V(0.001, -0.43, -0.03), V(-0.001, -0.43, -0.03)]], true, true, uvB);
    // stickers: a made-up maker's label on the face and the back
    const label = canvasTex(128, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      const rr = (x, y, a, b, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + a, y, x + a, y + b, r); g.arcTo(x + a, y + b, x, y + b, r); g.arcTo(x, y + b, x, y, r); g.arcTo(x, y, x + a, y, r); g.closePath(); };
      g.fillStyle = '#c8202c'; rr(14, 8, 100, 240, 16); g.fill();
      g.fillStyle = '#10131c'; g.beginPath(); g.moveTo(14, 150); g.lineTo(114, 110); g.lineTo(114, 150); g.lineTo(14, 190); g.closePath(); g.fill();
      g.fillStyle = '#f6c945'; g.beginPath(); g.moveTo(14, 196); g.lineTo(114, 156); g.lineTo(114, 166); g.lineTo(14, 206); g.closePath(); g.fill();
      g.save(); g.translate(64, 62); g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '900 34px "Rush Display", Impact, sans-serif'; g.fillText('FLARE', 0, 0); g.font = '700 13px "Rush Display", Impact, sans-serif'; g.fillText('SIXER PRO', 0, 30); g.restore();
    });
    const st = (z, flip) => { const p = new T.PlaneGeometry(0.066, 0.2); if (flip) p.rotateY(Math.PI); p.translate(0, -0.455, z); return p; };
    const g = new T.Group(), M = (geo, m) => { const x = new T.Mesh(geo, m); x.castShadow = true; x.frustumCulled = false; g.add(x); return x; };
    M3.blade.map = wood; M3.blade.color.set(0xffffff); M3.blade.roughness = 0.5; M3.blade.side = T.DoubleSide; M3.blade.needsUpdate = true;
    M(gMerge([blade, splice]), M3.blade);
    M(gMerge(grip), new T.MeshStandardMaterial({ color: 0x1b1d24, roughness: 0.85 }));
    const stm = new T.MeshStandardMaterial({ map: label, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 });
    M(st(0.0132, false), stm).castShadow = false;
    return g;
  })();
  // A batting pad, in the space placeEq uses: the knee at 0, the ankle 0.44 below, the front of the leg along +z.
  const PADGEAR = LOOK_PLAYER && window.CricketEquipmentPreview ? window.CricketEquipmentPreview.pad(T) : (() => {
    const V = (x, y, z) => new T.Vector3(x, y, z), parts = [], straps = [];
    const arc = (y, rx, rz, a0, a1, n, dz = 0) => { const p = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; p.push(V(Math.sin(a) * rx, y, dz + Math.cos(a) * rz - 0.012)); } return p; };
    // the shell that wraps the front of the shin, flaring over the boot
    const shell = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12, y = -0.05 - 0.425 * t, fl = t > 0.85 ? (t - 0.85) / 0.15 : 0; shell.push(arc(y, 0.07 - 0.008 * t + 0.01 * fl, 0.074 - 0.01 * t + 0.022 * fl, -1.75, 1.75, 16)); }
    parts.push(gLoft(shell, false));
    // seven cane ribs down the shin
    for (let k = -3; k <= 3; k++) { const a = k * 0.36, p = []; for (let i = 0; i <= 8; i++) { const t = i / 8, y = -0.062 - 0.4 * t; p.push(V(Math.sin(a) * (0.073 - 0.008 * t), y, Math.cos(a) * (0.078 - 0.01 * t) - 0.012)); } parts.push(gTube(p, 0.0115, 10, 6)); }
    // the knee roll: three fat bolsters across the knee
    for (const y of [-0.036, 0.0, 0.036]) parts.push(gTube(arc(y, 0.08, 0.088, -1.5, 1.5, 12), 0.0195, 16, 7));
    // the top hat above the knee, with three soft ribs and a rounded top
    const hat = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8, y = 0.05 + 0.15 * t, k = 1 - 0.5 * Math.pow(t, 3); hat.push(arc(y, 0.078 * (1 - 0.12 * t), 0.08 * (1 - 0.1 * t), -1.45 * k, 1.45 * k, 14)); }
    parts.push(gLoft(hat, false));
    for (const a of [-0.55, 0, 0.55]) { const p = []; for (let i = 0; i <= 5; i++) { const t = i / 5; p.push(V(Math.sin(a) * 0.08 * (1 - 0.12 * t), 0.06 + 0.125 * t, Math.cos(a) * 0.083 * (1 - 0.1 * t) - 0.012)); } parts.push(gTube(p, 0.014, 8, 6)); }
    // a wing on each side of the knee, and the straps round the back
    for (const sgn of [-1, 1]) { const w = new T.SphereGeometry(1, 10, 8); w.scale(0.012, 0.06, 0.034); w.translate(sgn * 0.08, -0.005, -0.004); parts.push(w); }
    for (const y of [-0.11, -0.26, -0.41]) straps.push(gTube(arc(y, 0.058 - (y < -0.3 ? 0.008 : 0), 0.062, 1.7, 2 * Math.PI - 1.7, 12), 0.0065, 14, 5));
    const g = new T.Group(), M = (geo, m) => { const x = new T.Mesh(geo, m); x.castShadow = true; x.frustumCulled = false; x.scale.set(1.26, 1, 1.34); g.add(x); };   // wide enough to cover the player's trouser leg
    M3.pads.side = T.DoubleSide; M3.pads.roughness = 0.7; M3.pads.color.set(0xdcd9cf);   // off-white, so the floodlights don't burn it out
    M(gMerge(parts), M3.pads); M(gMerge(straps), new T.MeshStandardMaterial({ color: 0xd9d6cc, roughness: 0.9 }));
    return g;
  })();

  // ---------------------------------------------------------------- helmet and cap, built in code to fit the head
  // Coordinates are metres from the head bone (the top of the neck), +z = the face. Brow 0.135 up, eyes 0.10, nose tip 0.06 (0.146 out),
  // chin -0.005, ears +-0.085 across at 0.06, top of the hair 0.235.
  const HEAD_SIZE = +(renderQuery.get('head')) || (LOOK_PLAYER ? 1.1 : 1.3);
  // how big to draw a head at p: HEAD_SIZE when it is small on screen, 1 when it is big (see Person.fit); ?head= forces one size
  function headSizeAt(p) {
    if (renderQuery.get('head')) return HEAD_SIZE;
    const d = Math.hypot(p.x - cam.pos[0], p.y - cam.pos[1], p.z - cam.pos[2]);   // (on narrow screens the lens is wider: camera.fov)
    const frac = 0.25 / (2 * Math.max(0.5, d) * Math.tan(Math.max(cam.fov, camera.fov || 0) * Math.PI / 360));   // a head's share of the screen height
    return 1 + (HEAD_SIZE - 1) * T.MathUtils.smoothstep(0.06 - frac, 0, 0.03);
  }
  const HEADGEAR = (() => {
    const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const merge = geos => {   // one geometry from several (positions, normals)
      const g = new T.BufferGeometry(), P = [], N = [];
      for (let q of geos) { q = q.index ? q.toNonIndexed() : q; P.push(...q.attributes.position.array); N.push(...q.attributes.normal.array); }
      g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(N, 3)); return g;
    };
    // part of an egg shape: centre c, radii r, from the top down to a lower edge whose height depends on the direction round the head
    function shell(c, r, edge, nt = 56, np = 18) {
      const pos = [], idx = [], rim = [];
      for (let i = 0; i <= nt; i++) {
        const th = i / nt * Math.PI * 2 - Math.PI, pm = Math.acos(Math.max(-1, Math.min(1, (edge(th) - c[1]) / r[1])));
        for (let k = 0; k <= np; k++) { const ph = pm * k / np; pos.push(c[0] + r[0] * Math.sin(ph) * Math.sin(th), c[1] + r[1] * Math.cos(ph), c[2] + r[2] * Math.sin(ph) * Math.cos(th)); }
        rim.push(new T.Vector3(pos[pos.length - 3], pos[pos.length - 2], pos[pos.length - 1]));
      }
      for (let i = 0; i < nt; i++) for (let k = 0; k < np; k++) { const a = i * (np + 1) + k, b = a + np + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      return { g, rim, at: th => { const pm = Math.acos(Math.max(-1, Math.min(1, (edge(th) - c[1]) / r[1]))); return new T.Vector3(c[0] + r[0] * Math.sin(pm) * Math.sin(th), edge(th), c[2] + r[2] * Math.sin(pm) * Math.cos(th)); } };
    }
    // a peak: a curved sheet from the shell's front edge outward, with a rounded lip
    function peak(sh, half, len, drop, n = 28, thick = 0.006) {
      const inner = [], outer = [], pos = [], idx = [];
      for (let i = 0; i <= n; i++) {
        const th = (i / n * 2 - 1) * half, w = Math.pow(Math.cos(th / half * Math.PI / 2), 0.55), p = sh.at(th);
        inner.push(p); outer.push(new T.Vector3(p.x + Math.sin(th) * len * 0.35 * w, p.y - drop * w, p.z + len * w));
      }
      for (const dy of [0, -thick]) for (let i = 0; i <= n; i++) for (const p of [inner[i], outer[i]]) pos.push(p.x, p.y + dy, p.z);
      for (let l = 0; l < 2; l++) for (let i = 0; i < n; i++) { const a = l * (n + 1) * 2 + i * 2; if (l) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      const lip = new T.TubeGeometry(new T.CatmullRomCurve3(outer.map(p => new T.Vector3(p.x, p.y - thick / 2, p.z))), n * 2, thick / 2 + 0.0008, 6);
      return [g, lip];
    }
    const tube = (pts, rad, closed = false, seg = 40) => new T.TubeGeometry(new T.CatmullRomCurve3(pts, closed, 'centripetal'), seg, rad, 6, closed);
    // ---- helmet: shell with ear guards, peak, a steel grille and a chin strap
    const hEdge = th => { const a = Math.abs(th); return 0.138 - 0.108 * sm(0.95, 1.3, a) + 0.03 * sm(2.2, 2.9, a); };   // brow in front, down over the ears, up a little behind
    const hs = shell([0, 0.1, -0.004], [0.115, 0.15, 0.139], hEdge);
    const helmetShell = merge([hs.g, tube(hs.rim.slice(0, -1), 0.0045, true, 120), ...peak(hs, 0.9, 0.05, 0.006)]);
    const bars = [], GX = 0.117, GZ = 0.176, bar = (y, th) => new T.Vector3(GX * Math.sin(th), y - 0.012 * (1 - Math.cos(th)) * 0, -0.004 + GZ * Math.cos(th) * (0.82 + 0.18 * Math.cos(th)));
    for (const y of [0.072, 0.04, 0.008, -0.024]) { const p = []; for (let i = 0; i <= 16; i++) p.push(bar(y, (i / 16 * 2 - 1) * 1.5)); bars.push(tube(p, 0.0034, false, 48)); }
    for (const th of [-0.2, 0.2]) bars.push(tube([bar(0.072, th), bar(0.024, th), bar(-0.024, th)], 0.0034, false, 8));
    for (const s of [-1, 1]) {
      bars.push(tube([bar(0.072, s * 0.95), bar(0.024, s * 0.98), bar(-0.024, s * 0.95)], 0.0034, false, 8));
      bars.push(tube([bar(0.072, s * 1.5), bar(0.024, s * 1.53), bar(-0.024, s * 1.5)], 0.0045, false, 8));        // the side post it bolts to
      const bolt = new T.CylinderGeometry(0.009, 0.009, 0.008, 10); bolt.rotateZ(Math.PI / 2); bolt.translate(s * 0.119, 0.05, 0.012); bars.push(bolt);
    }
    const strap = [];
    for (const s of [-1, 1]) strap.push(tube([new T.Vector3(s * 0.108, 0.04, -0.01), new T.Vector3(s * 0.094, 0.0, 0.03), new T.Vector3(s * 0.062, -0.022, 0.085), new T.Vector3(0, -0.026, 0.118)], 0.0042, false, 16));
    // ---- cap: crown, button and a long curved peak
    const cEdge = th => { const a = Math.abs(th); return 0.15 - 0.032 * sm(0.9, 1.5, a) - 0.012 * sm(1.8, 2.8, a); };
    const cs = shell([0, 0.1, 0.002], [0.107, 0.142, 0.131], cEdge);
    const btn = new T.SphereGeometry(0.011, 10, 6); btn.scale(1, 0.5, 1); btn.translate(0, 0.243, 0.002);
    const capGeo = merge([cs.g, tube(cs.rim.slice(0, -1), 0.003, true, 120), btn, ...peak(cs, 0.98, 0.082, 0.02, 28, 0.005)]);
    const band = [];   // six panel seams, a touch darker
    for (let i = 0; i < 6; i++) { const th = i / 6 * Math.PI * 2 + Math.PI / 6, p = []; for (let k = 1; k <= 8; k++) { const ph = Math.acos((cEdge(th > Math.PI ? th - 2 * Math.PI : th) - 0.1) / 0.142) * k / 8; p.push(new T.Vector3(0.1075 * Math.sin(ph) * Math.sin(th), 0.1 + 0.1425 * Math.cos(ph), 0.002 + 0.1315 * Math.sin(ph) * Math.cos(th))); } p.unshift(new T.Vector3(0, 0.2425, 0.002)); band.push(tube(p, 0.0016, false, 16)); }
    const two = m => { m.side = T.DoubleSide; return m; };
    const steel = new T.MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.75, roughness: 0.42 }), strapM = new T.MeshStandardMaterial({ color: 0x15171c, roughness: 0.9 });
    const seamM = new T.MeshStandardMaterial({ color: 0x000000, roughness: 0.9, transparent: true, opacity: 0.25 });
    // ---- the umpire's hat: a tapered crown that sits down over the head, a dark band and a wide brim that dips a little
    // it sits on the head just above the brow, so the face shows under the brim (Person tips it back a little too)
    const crown = new T.CylinderGeometry(0.094, 0.108, 0.088, 40, 1, false); crown.translate(0, 0.212, 0); crown.scale(1, 1, 1.2);
    const hband = new T.CylinderGeometry(0.1095, 0.1102, 0.022, 40, 1, true); hband.translate(0, 0.18, 0); hband.scale(1, 1, 1.2);
    const brim = new T.LatheGeometry([[0.104, 0.17], [0.13, 0.169], [0.17, 0.162], [0.21, 0.148], [0.215, 0.144]].map(([x, y]) => new T.Vector2(x, y)), 40);
    brim.scale(1, 1, 1.12);
    for (const g of [crown, hband, brim]) g.translate(0, -0.035, 0);   // down onto the head so it doesn't float
    const hatM = new T.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.8 }), hatBand = new T.MeshStandardMaterial({ color: 0xefece3, roughness: 0.8 });   // black, a light band
    return { helmet: [[helmetShell, two(M3.helmet)], [merge(bars), steel], [merge(strap), strapM]], cap: [[capGeo, two(M3.cap)], [merge(band), seamM]],
             hat: [[crown, hatM], [hband, two(hatBand)], [brim, two(hatM)]] };
  })();
  // the wicketkeeper's gloves: big padded mitts built in code, in the batting glove's frame (origin = palm centre, fingers -Y,
  // palm -X for the left hand; the right is mirrored): white leather, padded finger rolls on the back, a thumb, a tan rubber palm
  // and a cuff in the fielding side's colour (M3.cap)
  const KEEPGLOVE = (() => {
    const g = new T.Group(), leather = new T.MeshStandardMaterial({ color: 0xf1efe8, roughness: 0.62 }),
      rubber = new T.MeshStandardMaterial({ color: 0xa8784a, roughness: 0.85 });
    const add = (geo, m) => { const x = new T.Mesh(geo, m); x.castShadow = true; x.frustumCulled = false; g.add(x); return x; };
    const body = new T.CapsuleGeometry(0.072, 0.13, 6, 16); body.scale(0.5, 1, 1.05); body.translate(0.006, -0.055, 0); add(body, leather);
    for (const z of [-0.048, -0.016, 0.016, 0.048]) {   // finger rolls on the back
      const r = new T.CapsuleGeometry(0.017, 0.15, 4, 8); r.translate(0.03, -0.075, z); add(r, leather);
    }
    const th = new T.CapsuleGeometry(0.03, 0.07, 4, 10); th.rotateX(-0.55); th.translate(-0.006, -0.005, 0.085); add(th, leather);   // the thumb
    const palm = new T.SphereGeometry(0.07, 16, 10); palm.scale(0.16, 1.45, 0.95); palm.translate(-0.03, -0.06, 0); add(palm, rubber);
    const cuff = new T.CylinderGeometry(0.06, 0.056, 0.06, 18, 1, false); cuff.scale(0.72, 1, 1); cuff.translate(0, 0.095, 0); add(cuff, M3.cap);
    return g;
  })();

  function part(geo, m, parent) { const x = new T.Mesh(geo, m); x.castShadow = true; x.matrixAutoUpdate = true; parent.add(x); return x; }
  function seg(mesh, a, b, r) {
    va.set(a[0], a[1], a[2]); vb.set(b[0], b[1], b[2]); vd.subVectors(vb, va);
    const L = vd.length() || 1e-3;
    mesh.position.addVectors(va, vb).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(UP, vd.divideScalar(L));
    mesh.scale.set(r, L, r);
  }
  // like seg, but flattened: wide across the body (side), thinner front to back
  function segFlat(mesh, a, b, side, rw, rd, push) {
    va.set(a[0], a[1], a[2]); vb.set(b[0], b[1], b[2]); vd.subVectors(vb, va);
    const L = vd.length() || 1e-3; vd.divideScalar(L);
    vx.copy(side).addScaledVector(vd, -side.dot(vd)).normalize();
    vy.crossVectors(vx, vd).normalize();
    mB.makeBasis(vx.multiplyScalar(rw), vd.multiplyScalar(L), vy.clone().multiplyScalar(rd));
    mB.setPosition((va.x + vb.x) / 2 + vy.x * push, (va.y + vb.y) / 2 + vy.y * push, (va.z + vb.z) / 2 + vy.z * push);
    mesh.matrix.copy(mB);
  }
  function ball3(mesh, p, sx, sy, sz) { mesh.position.set(p[0], p[1], p[2]); mesh.scale.set(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz); }
  // a name and number on the back of the shirt
  function backTex() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4; t.flipY = false;
    return { c, t, who: '' };
  }
  function drawBack(b, name, ink, key, own) {   // key: the player's own name, for a number that stays with him; own: a number he picked
    if (b.who === name + ink + (own || '')) return; b.who = name + ink + (own || '');
    const g = b.c.getContext('2d', SOFT2D); g.clearRect(0, 0, 256, 256);
    if (!name) { b.t.needsUpdate = true; return; }   // a plain shirt (the umpires)
    const sur = (name.split(' ').pop() || '').toUpperCase().slice(0, 10), num = own || 1 + (hash(key || name) % 98);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = ink;
    g.font = '800 30px "Rush Display", Impact, sans-serif'; g.fillText(sur, 128, 62);
    g.font = '900 118px "Rush Display", Impact, sans-serif'; g.fillText(String(num), 128, 150);
    b.t.needsUpdate = true;
  }

  // ---------------------------------------------------------------- the player's body (vendor/player-rb.js, built by tools/rb-player/build.py
  // from a Microsoft Rocketbox avatar, MIT licence). Its skeleton is driven from the game's joints every frame: each bone is placed at the matching
  // joint and turned so it points at the next one, with the knee / elbow bend or the body's facing fixing the twist.
  const RIG = { tried: false, tmpl: null, rest: {} };
  const PRODUCTION = window.CR_PLAYER_PRODUCTION;
  function playerPreviewFailed(error) {
    PRODUCTION.error=String(error?.message || error);
    console.warn('Player preview failed:',error);
    if(!document.getElementById('player-preview-error')) {
      const notice=document.createElement('div');notice.id='player-preview-error';notice.setAttribute('role','alert');
      notice.textContent='Player preview could not load. The original player is shown. Open the player comparison page to retry.';
      notice.style.cssText='position:fixed;bottom:12px;left:12px;right:12px;z-index:10000;background:#542d20;color:white;padding:12px;border-radius:6px;font:14px system-ui';
      document.body.appendChild(notice);
    }
  }
  function loadProduction() {
    if (!PRODUCTION || !PRODUCTION.enabled || PRODUCTION.tried || !RIG.tmpl) return;
    PRODUCTION.tried = true;
    new T.GLTFLoader().load(PRODUCTION.url, g => {
      try {
        PRODUCTION.validate(RIG.tmpl, g.scene);
        const rig = {rest:{}};
        g.scene.updateMatrixWorld(true);
        g.scene.traverse(o => { if(o.isBone) rig.rest[o.name]=o.getWorldPosition(new T.Vector3()); });
        restFrames(rig);
        PRODUCTION.rig=rig; PRODUCTION.template = g.scene; PRODUCTION.ready = true;
        pool.forEach((p, i) => { if (PRODUCTION.slots.includes(i)) p.attach(); });
      } catch (e) { playerPreviewFailed(e); }
    }, undefined, playerPreviewFailed);
  }
  const INVIS = new T.MeshBasicMaterial({ visible: false });
  // (V2 player: this paints only the BODY under the separate kit meshes, so where the kit leaves a gap the body shows the
  // same team colour instead of a seam)
  // one material per player: the kit is cut per pixel along clean lines in the rest pose (waist, collar, sleeves, ankles),
  // so the edges are sharp whatever the triangles; the collar and sleeve ends get a trim in the team's second colour
  function kitMaterial() {
    const k = RIG.kit, V3 = a => new T.Vector3(a[0], a[1], a[2]);
    const u = { uShirt: { value: new T.Color() }, uPants: { value: new T.Color() }, uSkin: { value: new T.Color() }, uShoe: { value: new T.Color('#f2f2f2') },
                uTrim: { value: new T.Color() }, uGlove: { value: 0 }, uKit: { value: new T.Vector3(k.waist, k.neck, k.ankle) },
                uShL: { value: V3(k.shL) }, uElL: { value: V3(k.elL) }, uShR: { value: V3(k.shR) }, uElR: { value: V3(k.elR) } };
    const m = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
    m.userData.u = u;
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = 'attribute vec3 _rest;\nattribute vec4 _part;\nvarying vec3 vRest;\nvarying vec4 vPart;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRest = _rest; vPart = _part;');
      sh.fragmentShader = 'uniform vec3 uShirt, uPants, uSkin, uShoe, uTrim, uKit, uShL, uElL, uShR, uElR;\nuniform float uGlove;\nvarying vec3 vRest;\nvarying vec4 vPart;\nfloat kRough;\n' +
        sh.fragmentShader.replace('#include <color_fragment>', `
  vec3 kc = uShirt; kRough = 0.86; bool own = false;
  float neckLine = uKit.y - 0.045 - 0.03 * smoothstep(0.0, 0.09, vRest.z);
  if (vPart.w > 0.5) { kc = vColor.rgb; kRough = 0.25; own = true; }
  else if (vPart.z > 0.5 && uGlove > 0.5) { kc = vec3(0.94, 0.93, 0.9) * vColor.r; kRough = 0.7; own = true; }
  else if (vPart.z > 0.5 || vPart.y > 0.5) { kc = uSkin * vColor.rgb; kRough = 0.55; own = true; }
  else if (abs(vPart.x) > 0.5) {
    vec3 s = vPart.x > 0.0 ? uShL : uShR, e = vPart.x > 0.0 ? uElL : uElR;
    float t = dot(vRest - s, e - s) / dot(e - s, e - s);
    if (t > 1.72 && uGlove > 0.5) { kc = vec3(0.94, 0.93, 0.9); kRough = 0.7; }
    else if (t > 0.62) { kc = uSkin * vColor.rgb; kRough = 0.55; own = true; } else if (t > 0.57) kc = uTrim;
  }
  else if (vRest.y < uKit.z + 0.035) { kc = uShoe; kRough = 0.45; }
  else if (vRest.y > neckLine && abs(vRest.x) < 0.11) { kc = uSkin * vColor.rgb; kRough = 0.55; own = true; }
  else if (vRest.y > neckLine - 0.014 && abs(vRest.x) < 0.12) kc = uTrim;
  else if (vRest.y < uKit.x) { kc = uPants; kRough = 0.8; }
  diffuseColor.rgb = kc;`).replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = kRough;');
    };
    m.customProgramCacheKey = () => 'cricket-kit-v2';
    return m;
  }
  // the textured player (vendor/player-rb.js): photo-textured cloth and skin. The cloth is neutral in the texture and takes the
  // team's colours here (mask: red = shirt, green = trousers, blue = bare skin); the skin takes each player's tone
  const RB_KEY = { body: 'rb-body-2', head: 'rb-head-3' };
  const BARE_ALL = /[?&]bare=1/.test(location.search);   // testing: no helmets or caps (the face pictures for Settings → My player)
  // faces: [face, shade] choices per team (the shade darkens a lighter face, for more variety); any team not listed uses them all
  // faces 10-16 were added in November 2026 (dark-haired tan 12, bearded 14, goatee 16, blond 15, curly 10), 17-19 are older
  // men (grey hair, grey beard, balding) for the umpires. A team's players take the pool in turn (see Person.fit), so with
  // eleven or more entries no two teammates share a face.
  const TAN = [[6, 1], [14, 1], [5, 1], [16, 1], [12, 0.8], [6, 0.82], [1, 0.6], [4, 0.58], [14, 0.85], [0, 0.6], [5, 0.85], [16, 0.88], [3, 0.56], [8, 0.7], [10, 0.62], [13, 0.6]],
        FAIR = [[0, 1], [10, 1], [1, 1], [15, 1], [2, 1], [11, 1], [3, 1], [13, 1], [4, 1], [12, 1], [8, 1], [6, 1], [1, 0.85]],
        DARK = [[7, 1], [9, 1], [5, 0.8], [16, 0.62], [7, 0.85], [14, 0.6], [9, 1.1], [6, 0.7], [12, 0.52], [16, 0.55], [14, 0.52], [1, 0.45]],
        MIX = [...FAIR, [7, 1], [9, 1], [5, 1], [14, 1], [16, 1], [6, 1]], UMP = [[17, 1], [18, 1], [19, 1], [17, 0.8], [18, 0.85]];
  const FACE_POOL = { ind: TAN, pak: TAN, sl: TAN, ban: TAN, afg: TAN, aus: FAIR, eng: FAIR, nz: FAIR, ire: FAIR, wi: DARK, sa: MIX, rsa: MIX, zim: MIX };
  // Your own player's photo on his face (My players, 22 November 2026, owner). The photo arrives lined up on the game's guide
  // (index.html MYP_GUIDE: eyes and mouth at fixed places), and every face picture shares one layout (FACE_MARKS, measured on
  // the textures), so one affine map through both eyes and the mouth lays the photo onto the face. His picked face gives the
  // rest of the head (hair, ears, neck), tinted to the photo's skin; the photo is feathered in inside the guide's oval. Built once
  // per photo and face (photoFaces), as { map, skin } like RIG.faces. ?photoface=0 turns it off.
  const PHOTO_GUIDE = { eyeL: [0.385, 0.43], eyeR: [0.615, 0.43], mouth: [0.5, 0.68], oval: [0.5, 0.5, 0.29, 0.37], feather: 0.7, k: 0.94 };
  const FACE_MARKS = { eyeL: [332 / 768, 217 / 768], eyeR: [436 / 768, 217 / 768], mouth: [384 / 768, 308 / 768] };
  const photoFaces = new Map();
  function affine3(p, q) {   // the 2D affine map taking points p[0..2] to q[0..2]: [a, b, c, d, e, f] as in canvas setTransform
    const [[x1, y1], [x2, y2], [x3, y3]] = p, D = x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2);
    const solve = v => [(v[0] * (y2 - y3) + v[1] * (y3 - y1) + v[2] * (y1 - y2)) / D, (v[0] * (x3 - x2) + v[1] * (x1 - x3) + v[2] * (x2 - x1)) / D,
                        (v[0] * (x2 * y3 - x3 * y2) + v[1] * (x3 * y1 - x1 * y3) + v[2] * (x1 * y2 - x2 * y1)) / D];
    const [a, c, e] = solve(q.map(v => v[0])), [b, d, f] = solve(q.map(v => v[1]));
    return [a, b, c, d, e, f];
  }
  function regionMean(data, N, x0, x1, y0, y1) {   // mean colour (0-255) of the opaque pixels in a box (fractions of N)
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = Math.round(y0 * N); y < Math.round(y1 * N); y++) for (let x = Math.round(x0 * N); x < Math.round(x1 * N); x++) {
      const i = (y * N + x) * 4; if (data[i + 3] < 230) continue; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
    return n ? [r / n, g / n, b / n] : null;
  }
  function buildPhotoFace(img, base) {
    const bi = base.map.image, N = bi.width || 768, W = img.width, H = img.height, G = PHOTO_GUIDE;
    const cv = document.createElement('canvas'); cv.width = cv.height = N; const x = cv.getContext('2d', { willReadFrequently: true });
    x.drawImage(bi, 0, 0, N, N);
    const ph = document.createElement('canvas'); ph.width = ph.height = N; const y = ph.getContext('2d', { willReadFrequently: true });
    const A = affine3([G.eyeL, G.eyeR, G.mouth].map(([u, v]) => [u * W, v * H]), [FACE_MARKS.eyeL, FACE_MARKS.eyeR, FACE_MARKS.mouth].map(([u, v]) => [u * N, v * N]));
    y.setTransform(...A); y.imageSmoothingQuality = 'high'; y.drawImage(img, 0, 0);
    // the feathered oval, in the photo's own space so it follows the same map
    const [cx, cy, rx, ry] = G.oval, m = new DOMMatrix(A).translate(cx * W, cy * H).scale(rx * W * G.k, ry * H * G.k);
    y.globalCompositeOperation = 'destination-in'; y.setTransform(m);
    const gr = y.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, '#000'); gr.addColorStop(G.feather, '#000'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    y.fillStyle = gr; y.fillRect(-1, -1, 2, 2); y.setTransform(1, 0, 0, 1, 0, 0); y.globalCompositeOperation = 'source-over';
    // skin: the same patch build.py takes a face's skin from (below the eyes, across the nose)
    const P = regionMean(y.getImageData(0, 0, N, N).data, N, 0.40, 0.60, 0.30, 0.36), bd = x.getImageData(0, 0, N, N), B = regionMean(bd.data, N, 0.40, 0.60, 0.30, 0.36);
    if (P && B) {   // the head round the photo takes its colour (not the eyes and teeth atlas, bottom left)
      const k = [0, 1, 2].map(c => Math.max(0.55, Math.min(1.6, P[c] / Math.max(1, B[c])))), d = bd.data;
      for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) { if (px < 0.36 * N && py > 0.6 * N) continue;
        const i = (py * N + px) * 4; d[i] = Math.min(255, d[i] * k[0]); d[i + 1] = Math.min(255, d[i + 1] * k[1]); d[i + 2] = Math.min(255, d[i + 2] * k[2]); }
      x.putImageData(bd, 0, 0);
    }
    x.drawImage(ph, 0, 0);
    const t = new T.CanvasTexture(cv); t.encoding = T.sRGBEncoding; t.flipY = false; t.needsUpdate = true;
    const sk = P || B || [200, 160, 130];
    return { map: t, skin: new T.Color().setRGB(sk[0] / 255, sk[1] / 255, sk[2] / 255).convertSRGBToLinear(), canvas: cv };
  }
  function photoFace(url, fi) {
    if (renderQuery.get('photoface') === '0') return null;
    const key = fi + '|' + url; let e = photoFaces.get(key);
    if (e) return e.ready ? e : null;
    const base = RIG.faces && RIG.faces[fi % RIG.faces.length];
    if (!base || !base.map || !base.map.image) return null;   // his face picture isn't loaded yet
    e = { ready: false }; photoFaces.set(key, e);
    const pre = window.CR_PHOTO_IMGS && window.CR_PHOTO_IMGS.get(url);
    if (pre && pre.complete && pre.naturalWidth) {
      try { Object.assign(e, buildPhotoFace(pre, base), { ready: true }); return e; } catch (err) { e.failed = true; console.warn('photo face', err); return null; }
    }
    const img = new Image();
    img.onload = () => { try { Object.assign(e, buildPhotoFace(img, base), { ready: true }); } catch (err) { e.failed = true; console.warn('photo face', err); } };
    img.onerror = () => { e.failed = true; };
    img.src = url;
    return null;
  }
  if (typeof window !== 'undefined') window.CR_PHOTOFACES = photoFaces;   // tests: the built face pictures
  // what is written on the shirts: one small canvas per player for the back, one per team for the chest
  const inkFor = c => (0.3 * c.r + 0.6 * c.g + 0.1 * c.b) > 0.42 ? '#141a2c' : '#ffffff';
  const CHEST = {};
  function chestTex(team, shirt) {
    const key = team ? team.id : '-';
    if (CHEST[key]) return CHEST[key];
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4; t.flipY = false;
    const g = c.getContext('2d', SOFT2D), name = (team && team.name || '').toUpperCase();
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = inkFor(shirt);
    let px = 46; g.font = '900 ' + px + 'px "Rush Display", Impact, sans-serif';
    while (px > 16 && g.measureText(name).width > 150) { px -= 2; g.font = '900 ' + px + 'px "Rush Display", Impact, sans-serif'; }
    g.fillText(name, 128, 112);
    return (CHEST[key] = t);
  }
  // Facial hair, painted in the head's shader so every player can have his own without extra textures (all ten faces share
  // one layout: eyes about 0.28 down the texture, nose tip 0.35, mouth 0.405, chin 0.48, the face from x 0.33 to 0.67).
  // uBeard = (stubble, moustache, chin, full beard) strengths 0-1; uHair = its colour. Fine grain from a hash, so it reads as hair.
  const FACIAL_HAIR = `
  float fhHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float fhBlob(vec2 q, vec2 c, vec2 r, float soft) { return 1.0 - smoothstep(1.0 - soft, 1.0, length((q - c) / r)); }
  vec3 facialHair(vec3 col, vec2 q) {
    if (dot(uBeard, vec4(1.0)) < 0.001) return col;
    float lips = fhBlob(q, vec2(0.5, 0.406), vec2(0.046, 0.0125), 0.5);
    float lower = smoothstep(0.372, 0.392, q.y) * (1.0 - smoothstep(0.50, 0.53, q.y));   // from under the nose to under the chin
    float full = fhBlob(q, vec2(0.5, 0.43), vec2(0.165, 0.095), 0.35) * lower;
    float burns = fhBlob(q, vec2(0.335, 0.37), vec2(0.022, 0.07), 0.6) + fhBlob(q, vec2(0.665, 0.37), vec2(0.022, 0.07), 0.6);
    float tache = fhBlob(q, vec2(0.5, 0.389), vec2(0.06, 0.013), 0.55);
    float chin = fhBlob(q, vec2(0.5, 0.448), vec2(0.052, 0.04), 0.5);
    float grain = 0.55 + 0.45 * fhHash(floor(q * 900.0));
    float a = max(max(uBeard.x * 0.62 * max(full, burns * 0.8) * (0.4 + 0.6 * step(0.45, fhHash(floor(q * 1400.0) + 7.0))), uBeard.y * tache), max(uBeard.z * chin, uBeard.w * max(full, burns)));
    a *= (1.0 - lips * 0.9) * grain;
    return mix(col, uHair * (0.7 + 0.6 * grain), clamp(a, 0.0, 0.92));
  }
`;
  // each player's own look from his name: his head's shape (and painted facial hair, off unless ?beard= asks for it); ?beard=s,m,c,f forces one facial hair for everyone, ?hshape=w,l,d one head shape (for checking)
  const LOOKS = {};
  function playerLook(name) {
    if (LOOKS[name]) return LOOKS[name];
    let h = 2166136261; for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
    const r = k => ((h >>> (k * 5)) & 1023) / 1023;
    const forced = renderQuery.get('beard'), b = new T.Vector4(0, 0, 0, 0);   // (a bare Vector4 is 0,0,0,1: a full beard)
    if (forced) b.fromArray(forced.split(',').map(Number).concat([0, 0, 0, 0]).slice(0, 4));
    // painted beards are off: on top of a photo they looked drawn on (owner, November 2026). Beards come from the photo faces
    // that have real ones (14, 16, 18); ?beard= still tries the painted kind.
    const hair = new T.Color().setRGB(0.045, 0.032, 0.024).multiplyScalar(0.8 + 0.5 * r(3));
    const shape = name ? [0.94 + 0.12 * r(4), 0.96 + 0.09 * r(5), 0.97 + 0.06 * r(6)] : [1, 1, 1];
    return LOOKS[name] = { beard: b, hair, shape };
  }
  function rbMaterial(src, body) {
    const m = new T.MeshStandardMaterial({ map: src.map, roughness: body ? (LOOK_REFINED ? 0.86 : 0.82) : (LOOK_REFINED ? 0.72 : 0.7), metalness: 0 });
    const u = m.userData.u = { uMask: { value: RIG.rbMask }, uShirt: { value: new T.Color(1, 1, 1) }, uPants: { value: new T.Color(1, 1, 1) },
                               uTrim: { value: new T.Color(1, 1, 1) }, uSkin: { value: new T.Color(1, 1, 1) },
                               uBeard: { value: new T.Vector4(0, 0, 0, 0) }, uHair: { value: new T.Color(0.05, 0.035, 0.025) } };
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.fragmentShader = 'uniform sampler2D uMask;\nuniform vec3 uShirt, uPants, uTrim, uSkin, uHair;\nuniform vec4 uBeard;\n' + FACIAL_HAIR + sh.fragmentShader.replace('#include <map_fragment>', body ? `#include <map_fragment>
  vec4 mk = texture2D(uMask, vUv);
  float tr = mk.r * mk.g;   // red and green together = the trim (collar, cuffs, side panels, trouser stripe)
  diffuseColor.rgb *= mix(vec3(1.0), uShirt, mk.r - tr) * mix(vec3(1.0), uPants, mk.g - tr) * mix(vec3(1.0), uTrim, tr) * mix(vec3(1.0), uSkin, mk.b);` : `#include <map_fragment>
  if (!(vUv.x < 0.36 && vUv.y > 0.6)) { diffuseColor.rgb *= uSkin; diffuseColor.rgb = facialHair(diffuseColor.rgb, vUv); }   // not the eyes and teeth`)
        .replace('#include <emissivemap_fragment>', body ? '#include <emissivemap_fragment>' : `#include <emissivemap_fragment>
  totalEmissiveRadiance += diffuseColor.rgb * vec3(0.16, 0.08, 0.05);   // a faint warm glow, so the shadow side of a face isn't flat dark (light through skin)`);
    };
    m.customProgramCacheKey = () => RB_KEY[body ? 'body' : 'head'];
    return m;
  }
  const SKIN_TONES = ['#8d5a3b', '#b07650', '#c99872', '#e0b48f', '#6b4029', '#a36b47'].map(c => new T.Color(c));
  const qa = new T.Quaternion(), qb = new T.Quaternion(), m4a = new T.Matrix4(), m4b = new T.Matrix4();
  const v1 = new T.Vector3(), v2 = new T.Vector3(), v3 = new T.Vector3(), v4 = new T.Vector3();
  // bone -> the point it aims at, and how its twist is fixed ('side' = across the body, 'pole' = the joint bend, 'up', 'fwd')
  const AIM = {
    pelvis: ['spine_01', 'hips'], spine_01: ['spine_02', 'side'], spine_02: ['spine_03', 'side'], spine_03: ['neck_01', 'side'],
    neck_01: ['head', 'side'], head: ['headTop', 'look'],
    clavicle_l: ['upperarm_l', 'fwd'], clavicle_r: ['upperarm_r', 'fwd'],
    upperarm_l: ['lowerarm_l', 'poleL'], lowerarm_l: ['hand_l', 'poleL'], hand_l: ['handTip_l', 'poleL'],
    upperarm_r: ['lowerarm_r', 'poleR'], lowerarm_r: ['hand_r', 'poleR'], hand_r: ['handTip_r', 'poleR'],
    thigh_l: ['calf_l', 'kneeL'], calf_l: ['foot_l', 'kneeL'], foot_l: ['ball_l', 'up'], ball_l: ['toe_l', 'up'],
    thigh_r: ['calf_r', 'kneeR'], calf_r: ['foot_r', 'kneeR'], foot_r: ['ball_r', 'up'], ball_r: ['toe_r', 'up'],
  };
  const ORDER = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
                 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r'];
  const PARENT = { pelvis: null, spine_01: 'pelvis', spine_02: 'spine_01', spine_03: 'spine_02', neck_01: 'spine_03', head: 'neck_01',
                   clavicle_l: 'spine_03', upperarm_l: 'clavicle_l', lowerarm_l: 'upperarm_l', hand_l: 'lowerarm_l',
                   clavicle_r: 'spine_03', upperarm_r: 'clavicle_r', lowerarm_r: 'upperarm_r', hand_r: 'lowerarm_r',
                   thigh_l: 'pelvis', calf_l: 'thigh_l', foot_l: 'calf_l', ball_l: 'foot_l', thigh_r: 'pelvis', calf_r: 'thigh_r', foot_r: 'calf_r', ball_r: 'foot_r' };
  const A = a => new T.Vector3(a[0], a[1], a[2]);
  // the bend direction of a two-bone limb: from the middle joint toward the line through its ends (fallback when straight)
  function pole(a, b, c, fb) {
    v1.subVectors(c, a); const L2 = v1.lengthSq();
    const t = L2 > 1e-8 ? v2.subVectors(b, a).dot(v1) / L2 : 0;
    v3.copy(a).addScaledVector(v1, t).sub(b);
    return v3.lengthSq() > 1e-6 ? v3.normalize().clone() : fb.clone();
  }
  function frame(d, s, out) {   // a rotation matrix from an aim direction and a twist hint
    v1.copy(d).normalize(); v2.copy(s).addScaledVector(v1, -s.dot(v1));
    if (v2.lengthSq() < 1e-8) v2.set(v1.y, -v1.x, 0.3); v2.normalize(); v3.crossVectors(v1, v2);
    return out.makeBasis(v1, v2, v3);
  }
  function restFrames(rig = RIG) {   // the rest pose's frames, from the bone positions in the model
    const r = rig.rest, R = rig.restQ = {}, fwd = new T.Vector3(0, 0, 1), side = new T.Vector3(1, 0, 0), up = new T.Vector3(0, 1, 0);
    r.headTop = r.head.clone().add(new T.Vector3(0, 0.16, -0.01));
    for (const s of ['l', 'r']) {
      r['handTip_' + s] = r['middle_01_' + s].clone();
      r['toe_' + s] = r['ball_' + s].clone().add(new T.Vector3(0, 0.006, 0.073));
    }
    const hint = { side, hips: side, fwd, up, look: side,
                   poleL: pole(r.upperarm_l, r.lowerarm_l, r.hand_l, fwd), poleR: pole(r.upperarm_r, r.lowerarm_r, r.hand_r, fwd),
                   kneeL: pole(r.thigh_l, r.calf_l, r.foot_l, fwd), kneeR: pole(r.thigh_r, r.calf_r, r.foot_r, fwd) };
    // finger curl: about the line across the knuckles, toward the palm (which faces the body in the rest pose)
    rig.curl = { grip: {}, relax: {} };
    for (const s of ['l', 'r']) {
      const a = new T.Vector3().subVectors(r['index_01_' + s], r['pinky_01_' + s]).normalize();
      const d = new T.Vector3().subVectors(r['middle_01_' + s], r['hand_' + s]).normalize();
      const palm = new T.Vector3(-Math.sign(r['hand_' + s].x), 0, 0);
      const sg = Math.sign(new T.Vector3().crossVectors(a, d).dot(palm)) || 1;
      for (const [mode, ang] of [['grip', [1.0, 1.2, 0.8]], ['relax', [0.3, 0.45, 0.3]]])
        for (const f of ['index', 'middle', 'ring', 'pinky', 'thumb'])
          for (let k = 1; k <= 3; k++) {
            const t = f === 'thumb' ? (k === 1 ? 0 : ang[k - 1] * 0.5) : ang[k - 1];
            rig.curl[mode][f + '_0' + k + '_' + s] = new T.Quaternion().setFromAxisAngle(a, sg * t);
          }
    }
    // batting gloves on the hand bones: glove origin = palm centre, fingers -Y, palm -X (left); the right glove is mirrored
    rig.glove = {};
    for (const s of ['l', 'r']) {
      const d0 = new T.Vector3().subVectors(r['middle_01_' + s], r['hand_' + s]);
      const palm = new T.Vector3(-Math.sign(r['hand_' + s].x), 0, 0).addScaledVector(d0.clone().normalize(), -0).normalize();
      const Ry = d0.clone().normalize().negate(), Rx = (s === 'l' ? palm.clone().negate() : palm.clone());
      Rx.addScaledVector(Ry, -Rx.dot(Ry)).normalize(); const Rz = new T.Vector3().crossVectors(Rx, Ry);
      rig.glove[s] = { pos: d0.clone().multiplyScalar(0.5).add(new T.Vector3(-Math.sign(r['hand_' + s].x) * 0.012, 0, 0)),
                       quat: new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(Rx, Ry, Rz)), sx: s === 'l' ? 1 : -1 };
    }
    rig.grip = {};
    for (const s of ['l', 'r']) {
      const d0 = new T.Vector3().subVectors(r['middle_01_' + s], r['hand_' + s]);
      const a0 = new T.Vector3().subVectors(r['index_01_' + s], r['pinky_01_' + s]);
      rig.grip[s] = { rest: frame(d0, a0, new T.Matrix4()).clone(), knuckles: a0.clone(),
                      fist: d0.clone().add(new T.Vector3(-Math.sign(r['hand_' + s].x) * 0.028, 0, 0)) };   // the middle of the fist
    }
    for (const b of ORDER) {
      const [to, tw] = AIM[b];
      R[b] = frame(v4.subVectors(r[to], r[b]).clone(), hint[tw], new T.Matrix4()).clone();
    }
  }
  function loadModel() {
    if (RIG.tried || !window.PLAYER_GLB || !T.GLTFLoader || !T.SkeletonUtils) return;
    RIG.tried = true;
    try {
      const bin = Uint8Array.from(atob(window.PLAYER_GLB), c => c.charCodeAt(0)).buffer;
      new T.GLTFLoader().parse(bin, '', g => {
        RIG.tmpl = g.scene; RIG.kit = g.userData.kit; g.scene.updateMatrixWorld(true);
        RIG.faces = (g.userData.faces || []).map(f => ({ skin: new T.Color().setRGB(f.skin[0], f.skin[1], f.skin[2]).convertSRGBToLinear(), map: null }));
        if (g.userData.bodySkin) RIG.bodySkin = new T.Color().fromArray(g.userData.bodySkin).convertSRGBToLinear();
        (g.userData.faces || []).forEach((f, i) => g.parser.getDependency('texture', f.tex).then(t => { t.encoding = T.sRGBEncoding; t.flipY = false; RIG.faces[i].map = t; }));
        g.scene.traverse(o => { if (o.isMesh && o.material.name === 'RB_Body' && o.material.emissiveMap) {   // the kit mask travels in the emissive slot
          RIG.rbMask = o.material.emissiveMap; RIG.rbMask.encoding = T.LinearEncoding; RIG.rbMask.needsUpdate = true; o.material.emissiveMap = null; } });
        g.scene.traverse(o => {   // the body's own skin colour (face vertices), so each player can get his own tone
          if (!o.isMesh || !o.geometry.attributes._part || !o.geometry.attributes.color) return;
          const pa = o.geometry.attributes._part, ca = o.geometry.attributes.color; let r = 0, gg = 0, bb = 0, n = 0;
          for (let i = 0; i < pa.count; i++) if (pa.getY(i) > 0.5 && pa.getW(i) < 0.5) { r += ca.getX(i); gg += ca.getY(i); bb += ca.getZ(i); n++; }
          RIG.skinBase = new T.Color(r / n, gg / n, bb / n);
        });
        g.scene.traverse(o => { if (o.isBone) RIG.rest[o.name] = o.getWorldPosition(new T.Vector3()); });
        restFrames();
        // where the handle runs through a gripping fist: the middle of the loop the curled fingers make (measured in the rest pose)
        const TB = {}; g.scene.traverse(o => { if (o.isBone) TB[o.name] = o; });
        for (const s of ['l', 'r']) {
          const keep = {};
          for (const k in RIG.curl.grip) if (k.endsWith('_' + s)) { keep[k] = TB[k].quaternion.clone(); TB[k].quaternion.copy(RIG.curl.grip[k]); }
          g.scene.updateMatrixWorld(true);
          const c = new T.Vector3(); let n = 0;
          for (const f of ['index', 'middle', 'ring']) for (let k = 1; k <= 3; k++) { c.add(TB[f + '_0' + k + '_' + s].getWorldPosition(v1)); n++; }
          RIG.grip[s].fist = c.multiplyScalar(1 / n).sub(RIG.rest['hand_' + s]);
          for (const k in keep) TB[k].quaternion.copy(keep[k]);
        }
        g.scene.updateMatrixWorld(true);
        pool.forEach(p => p.attach());
        window.CR_MODEL_READY = true; if (window.CR_ON_MODEL) window.CR_ON_MODEL();   // for the tests
        if (PRODUCTION) PRODUCTION.baselineReady = true;
        loadGrip();
      }, e => console.warn('player model', e));
    } catch (e) { console.warn('player model', e); }
  }

  // ---------------------------------------------------------------- equipment model (vendor/equipment-model.js: the open batting glove; CC0)
  const EQ = { tried: false, ready: false };
  // which gloves to show: 'model' = the glove model, 'built' = the gloved fingers painted on the player
  const EQUIP_OPT = Object.assign({ gloves: 'built' }, window.CR_EQUIP || {});
  const EQMAT = { padding: mat('#1a1d24'), strap: mat('#b9bcc2'), sticker: mat('#c9302c') };
  for (const m of Object.values(EQMAT)) m.side = T.DoubleSide;
  const EQMAT_USES = { shell: M3.helmet, grille: M3.grille, cap: M3.cap, pad: M3.pads, willow: M3.blade, grip: M3.grip };
  function loadEquipment() {
    if (EQ.tried || !window.EQUIP_GLB || !T.GLTFLoader) return;
    EQ.tried = true;
    const names = Object.keys(window.EQUIP_GLB); let left = names.length;
    for (const k of names) {
      try {
        const bin = Uint8Array.from(atob(window.EQUIP_GLB[k]), c => c.charCodeAt(0)).buffer;
        const accept = g => {
          g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false;
            const n = o.material.name, side = o.material.side;
            if (side === T.DoubleSide) for (const m of [M3.helmet, M3.grille, M3.cap, M3.pads, M3.blade, M3.grip]) if (EQMAT_USES[n] === m) m.side = T.DoubleSide;
            o.material = n === 'shell' ? M3.helmet : n === 'grille' ? M3.grille : n === 'cap' ? M3.cap : n === 'pad' ? M3.pads
              : n === 'willow' ? M3.blade : n === 'grip' ? M3.grip : EQMAT[n] || o.material; } });
          EQ[k] = g.scene;
          if (--left === 0) { EQ.ready = true; if(PRODUCTION)PRODUCTION.equipmentReady=true; pool.forEach(p => p.attachEquipment()); }
        };
        new T.GLTFLoader().parse(bin, '', accept, e => console.warn('equipment', k, e));
      } catch (e) { console.warn('equipment', k, e); }
    }
  }
  // ---------------------------------------------------------------- the batting grip (vendor/grip-model.js, Cricket Grip V3, CC0)
  // The bat has one transform (from the game's bat pose). The closed gloves sit at two palm anchors on the handle (bat space);
  // each arm is re-solved (two-bone IK) so its wrist lands where its glove needs it, and each wrist turns to match its glove.
  // A glove's fixed place on its hand bone follows from that, so the gloves ride on the hand bones and nothing is duplicated.
  const GRIP_OLD = renderQuery.get('grip') === 'old';
  const GRIP3 = { tried: false, ready: false, side: {}, palmK: 0.5, twist: +(renderQuery.get('gtwist') || 0), handScale: 0.08, size: 1.45, cuffBend: +(renderQuery.get('cbend') ?? 0.6), align: +(renderQuery.get('galign') ?? 1e-3), alignKeep: 4e-5, cuffMax: +(renderQuery.get('cmax') ?? 0.5), elbowUp: +(renderQuery.get('gup') ?? 0.1) };   // size: the gloves are scaled up to fit this player's forearms   // the bare hand shrinks away inside its closed glove (the glove shows the hand)
  // Soften a low-poly mesh: each corner's normal averages the faces that meet there, except across a crease (finger rolls stay distinct)
  function smoothNormals(geo, creaseDeg = 55) {
    if (geo.userData.smoothed) return; geo.userData.smoothed = true;
    const g = geo.index ? geo.toNonIndexed() : geo, P = g.attributes.position, n = P.count, cos = Math.cos(creaseDeg * Math.PI / 180);
    const fn = new Float32Array(n * 3), a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
    for (let i = 0; i < n; i += 3) {
      a.fromBufferAttribute(P, i); b.fromBufferAttribute(P, i + 1); c.fromBufferAttribute(P, i + 2);
      c.sub(b); b.sub(a); b.cross(c); const w = b.length() || 1;   // area-weighted
      for (let k = 0; k < 3; k++) { fn[(i + k) * 3] = b.x; fn[(i + k) * 3 + 1] = b.y; fn[(i + k) * 3 + 2] = b.z; }
    }
    const key = i => P.getX(i).toFixed(4) + ',' + P.getY(i).toFixed(4) + ',' + P.getZ(i).toFixed(4), groups = new Map();
    for (let i = 0; i < n; i++) { const k = key(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
    const out = new Float32Array(n * 3), u = new T.Vector3(), v = new T.Vector3(), s = new T.Vector3();
    for (const ids of groups.values()) for (const i of ids) {
      u.fromArray(fn, i * 3).normalize(); s.set(0, 0, 0);
      for (const j of ids) { v.fromArray(fn, j * 3); if (u.dot(v.clone().normalize()) >= cos) s.add(v); }
      s.normalize(); out[i * 3] = s.x; out[i * 3 + 1] = s.y; out[i * 3 + 2] = s.z;
    }
    g.setAttribute('normal', new T.BufferAttribute(out, 3));
    return g;
  }
  const GLOVE_CUFF = renderQuery.get('gcuff') || 'model';   // 'model': the glove's own padded cuff (part of the glove); 'tube': the old forearm sleeve
  function loadGrip() {
    if (GRIP3.tried || !window.GRIP_GLB || !window.GRIP || !T.GLTFLoader || !RIG.restQ) return;
    GRIP3.tried = true;
    let left = 2;
    for (const [k, s] of [['top_left', 'l'], ['bottom_right', 'r']]) {
      const bin = Uint8Array.from(atob(window.GRIP_GLB[k]), c => c.charCodeAt(0)).buffer;
      new T.GLTFLoader().parse(bin, '', g => {
        let cuff = null;
        g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; o.material.side = T.DoubleSide;
          if (renderQuery.get('gsmooth') !== '0') { const sg = smoothNormals(o.geometry); if (sg && sg !== o.geometry) o.geometry = sg; o.material.flatShading = false; o.material.needsUpdate = true; }
          if (LOOK_REFINED) o.material.roughness = Math.min(0.96, o.material.roughness + 0.035); // matte leather/fabric under stadium lights
          if (o.material.color && !o.material.userData.toned) { o.material.userData.toned = true; const c = o.material.color; if (c.r + c.g + c.b > 2.4) c.multiplyScalar(0.86); }   // whites a touch darker (floodlights)
          if (/cuff/.test(o.name) || /cuff/.test(o.material.name)) { o.geometry.computeBoundingBox(); cuff = o.geometry.boundingBox.getCenter(new T.Vector3()); }
          if (GLOVE_CUFF === 'tube' ? /cuff|accent/.test(o.name) : /accent/.test(o.name)) o.visible = false; } });   // the loose strap flap ('accent') floats off a bent wrist   // the model's rigid cuff can't follow the forearm; Person draws its own (cuffG)
        const r = RIG.rest, anchor = new T.Vector3().fromArray(s === 'l' ? window.GRIP.top : window.GRIP.bottom);
        // the hand inside the glove: wrist to knuckles runs from the cuff through the palm; knuckle line (index - pinky) toward the blade
        const dB = cuff ? cuff.clone().negate().normalize() : new T.Vector3(s === 'l' ? 1 : -1, -1, 0).normalize();
        const aB = new T.Vector3(0, -1, 0);
        const d0 = new T.Vector3().subVectors(r['middle_01_' + s], r['hand_' + s]), a0 = new T.Vector3().subVectors(r['index_01_' + s], r['pinky_01_' + s]);
        const FB = frame(dB, aB, new T.Matrix4()).clone(), F0 = frame(d0, a0, new T.Matrix4()).clone();
        const handInBat = new T.Quaternion().setFromRotationMatrix(FB.clone().multiply(F0.clone().transpose()));   // hand world = bat * handInBat
        // The authored cuff mesh is centered at `cuff` in the palm-root frame. Aim at that measured center;
        // the prior 0.72 calibration stopped short and left the synthetic forearm cuff about 10 mm off it.
        // Keep the old placement for A/B and preserve production/reference fit.
        const cuffScale = GRIP_OLD || (!LOOK_PLAYER && (PRODUCTION?.enabled || PRODUCTION?.reference)) ? 0.72 : 1;
        const cuffB = anchor.clone().add(cuff ? cuff.clone().multiplyScalar(cuffScale * GRIP3.size) : new T.Vector3(s === 'l' ? -0.04 : 0.04, 0.04, 0));
        GRIP3.side[s] = { glove: g.scene, anchor, handInBat, palm: d0.clone().multiplyScalar(GRIP3.palmK), cuff, cuffB, F0: F0.clone().transpose() };
        if (--left === 0) { GRIP3.ready = true; if(PRODUCTION)PRODUCTION.gripReady=true; pool.forEach(p => p.attachGrip()); }
      }, e => console.warn('grip', k, e));
    }
  }
  // two-bone IK: the elbow for a shoulder, a wrist goal and the bend direction (from the game's own elbow)
  function elbowFor(S, Wg, elbow0, L1, L2) {
    const d = v1.subVectors(Wg, S).clone(), D = Math.min(Math.max(d.length(), Math.abs(L1 - L2) + 1e-3), L1 + L2 - 1e-3); d.normalize();
    const along = (D * D + L1 * L1 - L2 * L2) / (2 * D), h = Math.sqrt(Math.max(0, L1 * L1 - along * along));
    const p = v2.subVectors(elbow0, S).clone(); p.addScaledVector(d, -p.dot(d)); if (p.lengthSq() < 1e-8) p.set(0, -1, 0); p.normalize();
    return S.clone().addScaledVector(d, along).addScaledVector(p, h);
  }
  // Keep both cuff targets fixed while choosing a natural elbow bend that
  // clears the blade. Moving only the bat would detach the hands again.
  const bladeEnvelope = new T.Box3(new T.Vector3(-.054,-.86,-.052),new T.Vector3(.054,-.30,.0124));
  // palm (optional): also prefer the bend whose forearm runs into the glove (a folded-back wrist looked like a stuck-on glove)
  function elbowForBat(S, wrist, elbow0, L1, L2, O, Bq, palm, guardFront=null) {
    // Anchor the bend to the chest and shoulder side. The authored elbow can
    // cross the shoulder-to-wrist line, reversing its projected pole abruptly.
    const bend=guardFront && guardFront.weight>0 ? S.clone().addScaledVector(guardFront.direction,.6).addScaledVector(guardFront.outward,.3).add(new T.Vector3(0,-1,0)) : elbow0;
    const base=elbowFor(S,wrist,bend,L1,L2),axis=wrist.clone().sub(S).normalize();
    // A two-handed batting pose uses the anatomical pole directly: re-choosing
    // a bend for glove alignment each frame can flip it across the torso.
    if(guardFront && guardFront.weight>0)return base;
    const along=base.clone().sub(S).dot(axis),centre=S.clone().addScaledVector(axis,along),radial=base.clone().sub(centre);
    const iq=Bq.clone().invert(),a=S.clone().sub(O).applyQuaternion(iq),c=wrist.clone().sub(O).applyQuaternion(iq);
    const sample=new T.Vector3();let best=base,bestScore=Infinity,bestAngle=0;
    const penetrationAt=angle=>{
      const elbow=radial.clone().applyAxisAngle(axis,angle).add(centre),b=elbow.clone().sub(O).applyQuaternion(iq);let score=0;
      for(const [start,end,radius] of [[a,b,.09],[b,c,.065]])for(let i=0;i<=16;i++) {
        sample.lerpVectors(start,end,i/16);const p=Math.max(0,radius-bladeEnvelope.distanceToPoint(sample));score+=p*p;
      }
      return score;
    };
    if(palm && GRIP3.align>0) {
      const line=wrist.clone().sub(palm).normalize(),pen=angle=>penetrationAt(angle);
      let bestA=0,bestS=Infinity;
      for(let angle=-2.1;angle<=2.1001;angle+=.1) {
        const elbow=radial.clone().applyAxisAngle(axis,angle).add(centre),fa=elbow.clone().sub(wrist).normalize();
        const up=Math.max(0,elbow.y-(S.y+wrist.y)/2);   // an elbow raised above the arm's mid-height reads as a chicken wing
        // Keep the guard elbow on the chest side; glove alignment alone can tuck it through the torso.
        const behind=guardFront?Math.max(0,-elbow.clone().sub(S).dot(guardFront.direction)+.025):0;
        const inward=guardFront?Math.max(0,.04-elbow.clone().sub(S).dot(guardFront.outward)):0;
        const sc=(guardFront?.weight||0)*(behind*behind+inward*inward)*.4+pen(angle)+angle*angle*GRIP3.alignKeep+GRIP3.align*(1-fa.dot(line))+GRIP3.elbowUp*up*up;
        if(sc<bestS){bestS=sc;bestA=angle;}
      }
      return radial.clone().applyAxisAngle(axis,bestA).add(centre);
    }
    for(const angle of [0,-.3,.3,-.6,.6,-.9,.9,-1.2,1.2,-1.5,1.5,-1.8,1.8]) {
      const elbow=radial.clone().applyAxisAngle(axis,angle).add(centre),b=elbow.clone().sub(O).applyQuaternion(iq);
      let score=angle*angle*1e-6;
      for(const [start,end,radius] of [[a,b,.09],[b,c,.065]]) for(let i=0;i<=16;i++) {
        sample.lerpVectors(start,end,i/16);
        const penetration=Math.max(0,radius-bladeEnvelope.distanceToPoint(sample));score+=penetration*penetration;
      }
      if(score<bestScore){bestScore=score;best=elbow;bestAngle=angle;}
      if(bestScore===0)break;
    }
    if(bestAngle!==0 && penetrationAt(bestAngle)<1e-10) {
      // Find the first clear bend, rather than jumping in 0.3-radian steps.
      let lo=0,hi=Math.abs(bestAngle);const sign=Math.sign(bestAngle);
      for(let i=0;i<12;i++){const mid=(lo+hi)/2;if(penetrationAt(mid*sign)>1e-10)lo=mid;else hi=mid;}
      best=radial.clone().applyAxisAngle(axis,(hi+.003)*sign).add(centre);
    }
    return best;
  }
  // Reach correction and arm IK must use the same cuff positions, including
  // swapped top/bottom hands and the local reflection for a left-handed grip.
  function gripCuffs(mirrored, axis='z') {
    return Object.fromEntries(['l','r'].map(s=>{
      const role=mirrored?(s==='l'?'r':'l'):s,offset=GRIP3.side[role].cuffB.clone();
      if(mirrored)offset[axis]=-offset[axis];
      return [s,offset];
    }));
  }
  // Rendering constraints only: gameplay contact/scoring still use people().
  // Project the blade outside body/equipment capsules, then the two cuffs into
  // arm reach. Both arm IK chains are solved to the corrected bat below.
  function clearBat(O, Bq, pos, rest, padded, grippedSides = ['l','r'], cuffOffsets = null) {
    const spine=pos.neck_01.clone().sub(pos.pelvis).normalize();
    const capsules=[
      [pos.pelvis.clone().addScaledVector(spine,.08),pos.neck_01.clone().addScaledVector(spine,-.04),.18],
      [pos.head.clone().addScaledVector(spine,.045),pos.headTop,.16]
    ];
    for(const s of ['l','r']) {
      capsules.push([pos['clavicle_'+s],pos['upperarm_'+s],.085]);
      capsules.push([pos['thigh_'+s],pos['calf_'+s],.12]);
      capsules.push([pos['calf_'+s],pos['foot_'+s],padded?.16:.075]);
    }
    for(const z of [0,PITCH])for(const x of [-.1,0,.1])capsules.push([new T.Vector3(x,0,z),new T.Vector3(x,.735,z),.019]);
    const samples=[];
    for(let i=0;i<=12;i++)samples.push(new T.Vector3(0,-.31-.54*i/12,-.02).applyQuaternion(Bq));
    const point=new T.Vector3(),axis=new T.Vector3(),nearest=new T.Vector3(),delta=new T.Vector3();
    for(let iteration=0;iteration<32;iteration++) {
      let deepest=0;const push=new T.Vector3();
      for(const offset of samples) {
        point.copy(O).add(offset);
        for(const [a,b,radius] of capsules) {
          axis.subVectors(b,a);const l2=axis.lengthSq();
          const t=l2?T.MathUtils.clamp(nearest.subVectors(point,a).dot(axis)/l2,0,1):0;
          nearest.copy(a).addScaledVector(axis,t);delta.subVectors(point,nearest);
          const distance=delta.length(),penetration=radius+.064-distance;
          if(penetration>deepest) {
            deepest=penetration;
            if(distance<1e-7)delta.copy(spine).cross(new T.Vector3(0,0,1)).normalize();else delta.multiplyScalar(1/distance);
            push.copy(delta).multiplyScalar(penetration+.002);
          }
        }
      }
      if(deepest>0)O.add(push.clampLength(0,.06));
      let reachError=0;
      for(const s of grippedSides) {
        const wrist=(cuffOffsets?.[s] || GRIP3.side[s].cuffB).clone().applyQuaternion(Bq).add(O),sh=pos['upperarm_'+s];
        const reach=(rest['lowerarm_'+s].distanceTo(rest['upperarm_'+s])+rest['hand_'+s].distanceTo(rest['lowerarm_'+s]))*.985;
        delta.subVectors(wrist,sh);const distance=delta.length();
        if(distance>reach){reachError=Math.max(reachError,distance-reach);O.addScaledVector(delta,-(distance-reach)/distance);}
      }
      if(deepest<.001 && reachError<.001)break;
    }
  }
  const eX = new T.Vector3(), eY = new T.Vector3(), eZ = new T.Vector3();
  // place an equipment piece: its local -Y along 'down', local +Z toward 'face', at 'at', scaled by sy (sx = -1 mirrors it)
  function placeEq(obj, at, down, face, sy, sx = 1) {
    eY.copy(down).normalize().negate();
    eZ.copy(face).addScaledVector(eY, -face.dot(eY)); if (eZ.lengthSq() < 1e-8) eZ.set(0, 0, 1); eZ.normalize();
    eX.crossVectors(eY, eZ);
    obj.matrix.makeBasis(eX.multiplyScalar(sx * sy), eY.multiplyScalar(sy), eZ.multiplyScalar(sy));
    obj.matrix.setPosition(at); obj.matrixWorldNeedsUpdate = true;
  }

  class Person {
    constructor() {
      const g = this.g = new T.Group(); scene.add(g);
      const P = (geo, m) => part(geo, m, g);
      this.thighL = P(SHAPE.thigh, M3.batPants); this.thighR = P(SHAPE.thigh, M3.batPants);
      this.shinL = P(SHAPE.calf, M3.batPants); this.shinR = P(SHAPE.calf, M3.batPants);
      this.padL = P(SHAPE.pad, M3.pads); this.padR = P(SHAPE.pad, M3.pads); this.padL.matrixAutoUpdate = this.padR.matrixAutoUpdate = false;
      this.kneeL = P(sph, M3.batPants); this.kneeR = P(sph, M3.batPants);
      this.footL = P(sph, M3.shoe); this.footR = P(sph, M3.shoe);
      this.soleL = P(box, M3.sole); this.soleR = P(box, M3.sole);
      this.hips = P(sph, M3.batPants);
      this.torso = P(SHAPE.trunk, M3.batShirt); this.torso.matrixAutoUpdate = false;
      this.back = backTex();
      const bm = new T.MeshStandardMaterial({ map: this.back.t, transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
      this.number = new T.Mesh(new T.PlaneGeometry(0.5, 0.5), bm); this.number.position.set(0, 0.17, -0.505); this.number.rotation.y = Math.PI;
      this.torso.add(this.number);
      this.delL = P(sph, M3.batShirt); this.delR = P(sph, M3.batShirt);
      this.upL = P(SHAPE.upper, M3.batShirt); this.upR = P(SHAPE.upper, M3.batShirt); this.foreL = P(SHAPE.fore, SKIN[2]); this.foreR = P(SHAPE.fore, SKIN[2]);
      this.elbL = P(sph, M3.batShirt); this.elbR = P(sph, M3.batShirt);
      this.handL = P(sph, SKIN[2]); this.handR = P(sph, SKIN[2]);
      this.neck = P(SHAPE.neck, SKIN[2]);
      // the head turns as one piece: face, ears, hair, and a helmet or cap
      const h = this.headG = new T.Group(); g.add(h);
      const H = (geo, m) => part(geo, m, h);
      this.skull = H(sph, SKIN[2]); this.skull.scale.set(0.098, 0.118, 0.108);
      this.jaw = H(sph, SKIN[2]); this.jaw.scale.set(0.072, 0.06, 0.07); this.jaw.position.set(0, -0.058, 0.03);
      this.nose = H(sph, SKIN[2]); this.nose.scale.set(0.018, 0.026, 0.024); this.nose.position.set(0, -0.012, 0.105);
      this.earL = H(sph, SKIN[2]); this.earL.scale.set(0.014, 0.03, 0.022); this.earL.position.set(0.097, -0.005, -0.005);
      this.earR = H(sph, SKIN[2]); this.earR.scale.set(0.014, 0.03, 0.022); this.earR.position.set(-0.097, -0.005, -0.005);
      this.hair = H(dome, HAIR); this.hair.scale.set(0.104, 0.11, 0.113); this.hair.position.set(0, 0.012, -0.008); this.hair.rotation.x = -0.25;
      this.shades = H(box, SHADE); this.shades.scale.set(0.15, 0.028, 0.02); this.shades.position.set(0, 0.022, 0.1);
      // helmet and cap (HEADGEAR, built once): measured for the player's head, origin at the head bone
      this.gear = new T.Group(); h.add(this.gear);
      this.helmet = new T.Group(); this.cap = new T.Group(); this.hat = new T.Group(); this.hat.rotation.x = -0.12; this.gear.add(this.helmet, this.cap, this.hat);
      for (const [grp, list] of [[this.helmet, HEADGEAR.helmet], [this.cap, HEADGEAR.cap], [this.hat, HEADGEAR.hat]])
        for (const [geo, m] of list) { const x = new T.Mesh(geo, m); x.castShadow = true; x.frustumCulled = false; grp.add(x); }
      this.handle = P(cyl, M3.grip); this.blade = P(box, M3.blade); this.spine = P(box, M3.blade);
    }
    attachEquipment() {
      const K = o => { const c = o.clone(); c.matrixAutoUpdate = false; return c; };
      this.eqBat = K(BATGEAR); this.eqPadL = K(PADGEAR); this.eqPadR = K(PADGEAR); this.g.add(this.eqBat, this.eqPadL, this.eqPadR);   // the bat and pads are built in code
      if (EQ.glove_left) { this.eqGl = EQ.glove_left.clone(); this.eqGr = EQ.glove_left.clone(); }
      this.eqKl = KEEPGLOVE.clone(); this.eqKr = KEEPGLOVE.clone();   // (built in code; the old model was a batting glove)
      for (const o of [this.eqGl, this.eqGr, this.eqKl, this.eqKr]) if (o) { o.visible = false; this.g.add(o); }
    }
    attachGrip() {
      if (!this.bones || this.gripG || !GRIP3.ready) return;
      this.gripG = {}; this.gripRel = {};
      // a mirrored (left-handed) batter's top hand is his right: it wears the top glove's mirror image, and the left the bottom's
      this.gripGm = {}; this.gloveCuffM = {};
      for (const s of ['l', 'r']) for (const mir of [false, true]) {
        const o = GRIP3.side[mir ? (s === 'l' ? 'r' : 'l') : s].glove.clone(); o.matrixAutoUpdate = false; o.visible = false; this.g.add(o);
        (mir ? this.gripGm : this.gripG)[s] = o;
        if (GLOVE_CUFF === 'model') {   // the glove's padded cuff, taken off so it can bend with the wrist (placed each frame)
          o.updateMatrixWorld(true); const inv = o.matrixWorld.clone().invert(), cg = new T.Group(); cg.matrixAutoUpdate = false; cg.visible = false;
          const parts = []; o.traverse(m => { if (m.isMesh && m.visible && (/cuff/.test(m.name) || /cuff/.test(m.material.name))) parts.push(m); });
          for (const m of parts) { const c = new T.Mesh(m.geometry, m.material); c.castShadow = true; c.frustumCulled = false; c.matrixAutoUpdate = false;
            c.matrix.multiplyMatrices(inv, m.matrixWorld); cg.add(c); m.visible = false; }
          if (parts.length) { this.g.add(cg); if (mir) this.gloveCuffM[s] = cg; else (this.gloveCuff || (this.gloveCuff = {}))[s] = cg; }
        }
      }
      // a padded cuff on each forearm, running into the glove (y = along the forearm, 0 at the wrist)
      if (!GRIP3.cuffGeo) {
        const legacyCuff = GRIP_OLD || (!LOOK_PLAYER && (PRODUCTION?.enabled || PRODUCTION?.reference));
        // A short open sleeve follows the wrist; capped cylinders looked like solid blocks across the gloves.
        const body = legacyCuff
          ? new T.CylinderGeometry(0.041, 0.048, 0.115, 14, 1, false).translate(0, -0.0275, 0)
          : new T.CylinderGeometry(0.036, 0.042, 0.095, 20, 1, true).translate(0, -0.022, 0);   // reaches into the glove's opening
        const band = legacyCuff
          ? new T.CylinderGeometry(0.0495, 0.0495, 0.026, 14, 1, true).translate(0, -0.062, 0)
          : new T.CylinderGeometry(0.0435, 0.044, 0.012, 20, 1, true).translate(0, -0.063, 0);
        GRIP3.cuffGeo = [body, band];
        GRIP3.cuffMat = [new T.MeshStandardMaterial({ color: 0xd6d4cc, roughness: 0.85, side: T.DoubleSide }), new T.MeshStandardMaterial({ color: 0x23262c, roughness: 0.7, side: T.DoubleSide })];
      }
      this.cuffG = {};
      for (const s of ['l', 'r']) {
        const c = new T.Group(); GRIP3.cuffGeo.forEach((geo, i) => { const m = new T.Mesh(geo, GRIP3.cuffMat[i]); m.castShadow = true; m.frustumCulled = false; c.add(m); });
        c.matrixAutoUpdate = false; c.visible = false; this.g.add(c); this.cuffG[s] = c;
      }
    }
    attach() {
      const useProduction = PRODUCTION && PRODUCTION.ready && PRODUCTION.slots.includes(pool.indexOf(this));
      if (this.model) {
        scene.remove(this.model);
        this.model.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) m.dispose(); });
      }
      this.kit = null; this.isProduction = !!useProduction; this.rig = useProduction ? PRODUCTION.rig : RIG;
      this.gripRel = {}; // A cached glove frame belongs to the previously attached skeleton.
      const root = T.SkeletonUtils.clone(useProduction ? PRODUCTION.template : RIG.tmpl);
      this.model = root; this.bones = {}; this.parts = {};
      root.traverse(o => {
        if (o.isBone) this.bones[o.name] = o;
        if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true;
          const n = o.material.name;
          if(useProduction && PLAYER_FIT && n==='KIT_Trousers' && renderQuery.get('hips')!=='old') o.geometry=window.CricketEquipmentPreview.smoothHips(o.geometry);
          if(useProduction && PLAYER_FIT && /^(SKIN_Human|KIT_Jersey|KIT_Trousers)$/.test(n)) o.geometry=window.CricketEquipmentPreview.fitBody(o.geometry);
          if(useProduction && PLAYER_FIT && renderQuery.get('clothes') !== 'tight' && /^(KIT_Jersey|KIT_Trousers)$/.test(n)) o.geometry=window.CricketEquipmentPreview.fitClothes(o.geometry,n);
          o.material = n === 'RB_Body' || n === 'RB_Head' ? rbMaterial(o.material, n === 'RB_Body') : !useProduction && o.geometry.attributes._part ? (this.kit = kitMaterial()) : o.material.clone(); this.parts[n] = o;
          if (n === 'RB_Back' || n === 'RB_Chest') { o.castShadow = false; o.material.dispose();
            o.material = new T.MeshStandardMaterial({ map: n === 'RB_Back' ? this.back.t : null, transparent: true, roughness: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }); }
          if (n === 'KIT_Emblem') o.visible = false; }   // the V2 chest badge's shape is broken; hidden until it's remade
      });
      // The optional source Root is a bind-pose wrapper, not a gameplay joint.
      if(useProduction && this.bones.Root) this.bones.Root.position.set(0,0,0);
      scene.add(root);
      // the shape-built body stays for the equipment (pads, gloves, helmet, cap, bat, shirt number); the rest is hidden
      this.hideLegacyBody();
    }
    hideLegacyBody() {
      for (const k of ['thighL', 'thighR', 'shinL', 'shinR', 'kneeL', 'kneeR', 'footL', 'footR', 'soleL', 'soleR', 'hips', 'delL', 'delR',
                       'upL', 'upR', 'foreL', 'foreR', 'elbL', 'elbR', 'neck', 'skull', 'jaw', 'nose', 'earL', 'earR', 'hair', 'shades']) this[k].visible = false;
    }
    fit(pr, fwd, side, skinIdx, shirt, pants) {
      this.sourceBat = pr.bat || null;
      const rig=this.rig || RIG;
      const j = pr.j, B = this.bones, r = rig.rest, W = this.wq || (this.wq = {}), Wp = this.wp || (this.wp = {});
      const pos = {};
      const pel = A(j.pelvis), neck = A(j.neck), headC = A(j.head);
      // the trunk: the rest spine, turned and stretched to run from the pelvis to the neck
      const up = v4.subVectors(neck, pel).clone(), Lt = up.length(), Lr = r.neck_01.y - r.pelvis.y;
      const hipSide = A(j.hipL).sub(A(j.hipR)).normalize();
      const trunkQ = qa.setFromRotationMatrix(frame(up, side, m4a)).clone().multiply(qb.setFromRotationMatrix(frame(v4.subVectors(r.neck_01, r.pelvis).clone(), new T.Vector3(1, 0, 0), m4b)).invert());
      pos.pelvis = pel;
      for (const b of ['spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r']) pos[b] = v1.subVectors(r[b], r.pelvis).multiplyScalar(b.startsWith('spine') ? Lt / Lr : 1).applyQuaternion(trunkQ).add(pel).clone();
      pos.clavicle_l.copy(v1.subVectors(r.clavicle_l, r.spine_03).applyQuaternion(trunkQ).add(pos.spine_03));
      pos.clavicle_r.copy(v1.subVectors(r.clavicle_r, r.spine_03).applyQuaternion(trunkQ).add(pos.spine_03));
      pos.neck_01 = neck;
      pos.head = v1.subVectors(headC, neck).normalize().multiplyScalar(r.head.distanceTo(r.neck_01)).add(neck).clone();
      pos.headTop = v1.subVectors(headC, pos.head).normalize().multiplyScalar(0.16).add(pos.head).clone();
      for (const s of ['l', 'r']) {
        const S = s.toUpperCase(), sh = A(j['sh' + S]), el = A(j['el' + S]), hd = A(j['hand' + S]);
        pos['upperarm_' + s] = sh; pos['lowerarm_' + s] = el;
        const fd = v1.subVectors(hd, el).normalize().clone();
        pos['hand_' + s] = hd.clone().addScaledVector(fd, -0.06);
        pos['handTip_' + s] = hd.clone().addScaledVector(fd, 0.05);
        const hip = A(j['hip' + S]), kn = A(j['knee' + S]), ft = A(j['foot' + S]);
        pos['thigh_' + s] = hip; pos['calf_' + s] = kn;
        const ank = ft.clone(); ank.y += r['foot_' + s].y;
        pos['foot_' + s] = ank;
        const footDirection=j['footDir'+S]?A(j['footDir'+S]):fwd;
        const yaw=Math.atan2(footDirection.x,footDirection.z),pitch=j['footPitch'+S]?.[0]||0,footAxis=new T.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
        const toe = v1.subVectors(r['ball_' + s], r['foot_' + s]).applyAxisAngle(new T.Vector3(0, 1, 0), yaw).applyAxisAngle(footAxis,pitch).clone();
        pos['ball_' + s] = ank.clone().add(toe);
        pos['toe_' + s] = pos['ball_' + s].clone().add(new T.Vector3(Math.sin(yaw) * 0.073, 0.006, Math.cos(yaw) * 0.073).applyAxisAngle(footAxis,pitch));
      }
      const lookV = pr.look ? new T.Vector3(pr.look[0], 0, pr.look[2]).normalize() : fwd.clone().setY(0).normalize();
      const hint = { side, hips: hipSide, fwd, up: new T.Vector3(0, 1, 0), look: new T.Vector3(lookV.z, 0, -lookV.x),
                     poleL: pole(pos.upperarm_l, pos.lowerarm_l, pos.hand_l, fwd), poleR: pole(pos.upperarm_r, pos.lowerarm_r, pos.hand_r, fwd),
                     kneeL: pole(pos.thigh_l, pos.calf_l, pos.foot_l, fwd), kneeR: pole(pos.thigh_r, pos.calf_r, pos.foot_r, fwd) };
      {
        hint.spineLow=hipSide.clone().lerp(side,.28).normalize();
        hint.spineMid=hipSide.clone().lerp(side,.65).normalize();
      }
      // the two-handed grip: the bat from the game's pose, the wrists moved to the gloves' anchors and the elbows re-solved
      this.armFit = {}; this.bat3 = null; this.gripResidual = null; this.gloveMir = false; let gripQ = null;
      const G3 = GRIP3.ready && this.gripG && pr.bat;
      if (G3 && !pr.bat.carry) {
        const bh = A(pr.bat.hands), bt = A(pr.bat.tip), Y = bh.clone().sub(bt).normalize();     // bat +Y: from the blade to the handle
        // Retain a width axis through the swing. Rebuilding from a fixed face
        // normal flips the blade 180 degrees as it passes horizontal.
        // a mirrored (left-handed) batter: the grip is the mirror image of a right-hander's. The bat's frame below is then the
        // mirror of his with its face axis reversed, so each hand takes the other hand's place on the handle, mirrored
        // front to back (bat z), and wears the other glove mirrored the same way (?mirax=x tries the other axis)
        const mir = !!pr.mirrored, ax = renderQuery.get('mirax') === 'x' ? 'x' : 'z';
        const mx3 = v => { const c = v.clone(); if (mir) c[ax] = -c[ax]; return c; }, role = s => mir ? (s === 'l' ? 'r' : 'l') : s;
        this.gloveMir = mir;
        const X = pr.bat.width ? A(pr.bat.width) : A(j.shR).sub(A(j.shL)).multiplyScalar(mir ? -1 : 1);   // (the shoulders swap sides in the mirror)
        X.addScaledVector(Y,-X.dot(Y));if(X.lengthSq()<1e-8)X.copy(side).addScaledVector(Y,-side.dot(Y));X.normalize();
        if (GRIP3.twist) X.applyAxisAngle(Y, GRIP3.twist);
        const Bq = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(X, Y, new T.Vector3().crossVectors(X, Y)));
        const mid = mx3(GRIP3.side.l.anchor.clone().add(GRIP3.side.r.anchor).multiplyScalar(0.5));
        const O = bh.clone().sub(mid.applyQuaternion(Bq));                                           // the grip's middle where the game holds the bat
        const authoredO=O.clone(),cuffs=gripCuffs(mir,ax);
        clearBat(O,Bq,pos,r,pr.team==='bat' || pr.keeper,['l','r'],cuffs);
        this.bat3 = { O, Bq, authoredO }; gripQ = {}; this.gripResidual = {};
        for (const s of ['l', 'r']) {
          const S3 = GRIP3.side[role(s)];
          const wrist = cuffs[s].clone().applyQuaternion(Bq).add(O), palm = mx3(S3.anchor).applyQuaternion(Bq).add(O);
          const sh = pos['upperarm_' + s], L1 = r['lowerarm_' + s].distanceTo(r['upperarm_' + s]), L2 = r['hand_' + s].distanceTo(r['lowerarm_' + s]);
          if(PRODUCTION?.audit)this.armFit[s]={shoulder:sh.toArray(),wrist:wrist.toArray(),elbow:pos['lowerarm_'+s].toArray(),L1,L2,O:O.toArray(),Bq:Bq.toArray(),palm:palm.toArray(),front:fwd.toArray(),outward:side.clone().multiplyScalar(s==='l'?1:-1).toArray(),guard:pr.bat.guardWeight||0};
          pos['lowerarm_' + s] = elbowForBat(sh, wrist, pos['lowerarm_' + s], L1, L2, O, Bq, palm, {direction:fwd,outward:side.clone().multiplyScalar(s==='l'?1:-1),weight:1});
          pos['hand_' + s] = pos['lowerarm_' + s].clone().add(v1.subVectors(wrist, pos['lowerarm_' + s]).normalize().multiplyScalar(L2));
          this.gripResidual[s] = pos['hand_' + s].distanceTo(wrist);
          // the (hidden, shrunk) hand points from the wrist into the glove, knuckles along the handle
          const knuck = new T.Vector3(0, -1, 0).applyQuaternion(Bq);
          gripQ[s] = new T.Quaternion().setFromRotationMatrix(frame(v1.subVectors(palm, pos['hand_' + s]).clone(), knuck, m4a).multiply(rig.grip[s].rest.clone().transpose()));
          pos['handTip_' + s] = pos['hand_' + s].clone().add(v1.subVectors(palm, pos['hand_' + s]).multiplyScalar(2));
          this['glovePose_' + s] = { p: palm, q: Bq };
        }
        hint.poleL = pole(pos.upperarm_l, pos.lowerarm_l, pos.hand_l, fwd); hint.poleR = pole(pos.upperarm_r, pos.lowerarm_r, pos.hand_r, fwd);
      }
      if(G3 && pr.bat.carry) {
        const s=pr.bat.carryHand || (A(pr.bat.hands).distanceTo(pos.hand_l)<A(pr.bat.hands).distanceTo(pos.hand_r)?'l':'r'),S3=GRIP3.side[s];
        const Y=A(pr.bat.hands).sub(A(pr.bat.tip)).normalize(),X=pr.bat.width?A(pr.bat.width):side.clone();
        X.addScaledVector(Y,-X.dot(Y));
        if(X.lengthSq()<1e-8)X.set(1,0,0);X.normalize();
        const Bq=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(X,Y,new T.Vector3().crossVectors(X,Y)));
        const O=pos['hand_'+s].clone().sub(S3.cuffB.clone().applyQuaternion(Bq));
        clearBat(O,Bq,pos,r,pr.team==='bat' || pr.keeper,[s]);
        const wrist=S3.cuffB.clone().applyQuaternion(Bq).add(O),palm=S3.anchor.clone().applyQuaternion(Bq).add(O),sh=pos['upperarm_'+s];
        const L1=r['lowerarm_'+s].distanceTo(r['upperarm_'+s]),L2=r['hand_'+s].distanceTo(r['lowerarm_'+s]);
        pos['lowerarm_'+s]=elbowForBat(sh,wrist,pos['lowerarm_'+s],L1,L2,O,Bq,palm);
        pos['hand_'+s]=pos['lowerarm_'+s].clone().add(wrist.clone().sub(pos['lowerarm_'+s]).normalize().multiplyScalar(L2));
        pos['handTip_'+s]=pos['hand_'+s].clone().add(palm.clone().sub(pos['hand_'+s]).multiplyScalar(2));
        gripQ={[s]:new T.Quaternion().setFromRotationMatrix(frame(palm.clone().sub(pos['hand_'+s]),new T.Vector3(0,-1,0).applyQuaternion(Bq),new T.Matrix4()).multiply(rig.grip[s].rest.clone().transpose()))};
        this.bat3={O,Bq};this.gripResidual={[s]:pos['hand_'+s].distanceTo(wrist)};
        this['glovePose_'+s]={p:palm,q:Bq};
        hint[s==='l'?'poleL':'poleR']=pole(sh,pos['lowerarm_'+s],pos['hand_'+s],fwd);
      }
      // world rotations, then local ones down the hierarchy (the bind pose has no rotation, so rest frames are world frames)
      for (const b of ORDER) {
        const [to, tw] = AIM[b];
        const rollHint=b==='spine_01'?hint.spineLow:b==='spine_02'?hint.spineMid:hint[tw];
        frame(v4.subVectors(pos[to], pos[b]).clone(), rollHint, m4a);
        m4b.copy(rig.restQ[b]).transpose();
        const q = (W[b] || (W[b] = new T.Quaternion())).setFromRotationMatrix(m4a.multiply(m4b));
        Wp[b] = pos[b];
        const p = PARENT[b], bone = B[b];
        if (!p) { bone.quaternion.copy(q); bone.position.copy(pos[b]); continue; }
        qb.copy(W[p]).invert();
        bone.quaternion.copy(qb).multiply(q);
        bone.position.subVectors(pos[b], Wp[p]).applyQuaternion(qb);
      }
      if (gripQ) for (const s of Object.keys(gripQ)) {   // wrists turned to their gloves
        B['hand_' + s].quaternion.copy(qb.copy(W['lowerarm_' + s]).invert()).multiply(gripQ[s]); W['hand_' + s].copy(gripQ[s]);
      }
      const gloved3 = !!(G3 && pr.team === 'bat' && pr.gloves);
      if (this.gripG) {
        for (const s of ['l', 'r']) {
          const hq = W['hand_' + s], hp = pos['hand_' + s], rel = this.gripRel[s];
          if (gripQ && gripQ[s] && this.gloveMir) {}   // (a mirrored grip isn't remembered: one-handed, the gloves are the usual ones)
          else if (gripQ && gripQ[s]) {   // remember where the glove sits on the hand, for when he lets go with one hand
            const iq = hq.clone().invert(), gp = this['glovePose_' + s];
            this.gripRel[s] = { q: iq.clone().multiply(gp.q), p: gp.p.clone().sub(hp).applyQuaternion(iq) };
            if (!rig.closedGloveRel) rig.closedGloveRel = {};
            rig.closedGloveRel[s] = this.gripRel[s];   // shared, for players who haven't gripped yet (the non-striker)
          } else {
            const R = rel || (rig.closedGloveRel && rig.closedGloveRel[s]) || { q: GRIP3.side[s].handInBat.clone().invert(), p: GRIP3.side[s].palm.clone() };
            this['glovePose_' + s] = { q: hq.clone().multiply(R.q), p: R.p.clone().applyQuaternion(hq).add(hp) };
          }
          const mirG = this.gloveMir && gloved3, gp = this['glovePose_' + s], o = (mirG ? this.gripGm : this.gripG)[s], other = (mirG ? this.gripG : this.gripGm)[s];
          other.visible = false; const oc = (mirG ? this.gloveCuff : this.gloveCuffM); if (oc && oc[s]) oc[s].visible = false;
          o.visible = gloved3; o.matrix.compose(gp.p, gp.q, mirG && renderQuery.get('mirax') !== 'x' ? v3.set(GRIP3.size, GRIP3.size, -GRIP3.size) : v3.set(mirG ? -GRIP3.size : GRIP3.size, GRIP3.size, GRIP3.size)); o.matrixWorldNeedsUpdate = true;
          B['hand_' + s].scale.setScalar(gloved3 ? GRIP3.handScale : 1);
          const gc = (mirG ? this.gloveCuffM : this.gloveCuff) && (mirG ? this.gloveCuffM : this.gloveCuff)[s];
          if (gc) { gc.visible = gloved3;
            if (gloved3) {   // turn the cuff about the wrist, part of the way from the glove's line to the forearm's
              const dg = v1.subVectors(hp, gp.p).normalize(), df = v2.subVectors(pos['lowerarm_' + s], hp).normalize();
              (this.lastHand || (this.lastHand = {}))[s] = Math.acos(Math.min(1, Math.max(-1, dg.dot(df)))) * 180 / Math.PI;
              const tgt = v4.copy(dg).lerp(df, GRIP3.cuffBend).normalize(); qa.setFromUnitVectors(dg, tgt);
              const ang = 2 * Math.acos(Math.min(1, Math.abs(qa.w))), cap = GRIP3.cuffMax; if (ang > cap) qa.slerp(qb.identity(), 1 - cap / ang);   // never so far it leaves the glove
              m4b.makeTranslation(-hp.x, -hp.y, -hp.z); m4a.makeRotationFromQuaternion(qa).premultiply(m4b.clone().invert()).multiply(m4b);
              gc.matrix.multiplyMatrices(m4a, o.matrix); gc.matrixWorldNeedsUpdate = true; } }
          const cf = this.cuffG[s]; cf.visible = gloved3 && GLOVE_CUFF === 'tube';
          if (gloved3) { cf.matrix.compose(hp, qb.setFromUnitVectors(v1.set(0, 1, 0), v2.subVectors(hp, pos['lowerarm_' + s]).normalize()), v3.set(1, 1, 1)); cf.matrixWorldNeedsUpdate = true; }
        }
      }
      // hands on the bat (without the grip gloves): each gripping hand turns so its knuckle line runs along the handle, and the bat goes through the top fist
      this.batFix = null;
      if (pr.bat && !G3) {
        const bh = A(pr.bat.hands), bt = A(pr.bat.tip), bd = bt.clone().sub(bh).normalize();
        const grips = pr.bat.carry ? [bh.distanceTo(pos.hand_l) < bh.distanceTo(pos.hand_r) ? 'l' : 'r'] : ['l', 'r'];
        let top = null;
        for (const s of grips) {
          // turn the hand so its fist lands on the handle: the wrist-to-fist line points at the handle, the knuckles along it
          const G = rig.grip[s], hp = pos['hand_' + s], reach = G.fist.length();
          const foot = bh.clone().addScaledVector(bd, v1.subVectors(hp, bh).dot(bd)), dist = hp.distanceTo(foot);
          const slide = Math.sqrt(Math.max(0, reach * reach - dist * dist));
          const P1 = foot.clone().addScaledVector(bd, slide), P2 = foot.clone().addScaledVector(bd, -slide);
          const P = P1.distanceTo(bh) < P2.distanceTo(bh) ? P1 : P2;
          frame(v2.subVectors(P, hp).clone(), bd, m4a);
          if (!G.restF) G.restF = frame(G.fist.clone(), G.knuckles, new T.Matrix4()).clone().transpose();
          m4b.copy(G.restF);
          const q = new T.Quaternion().setFromRotationMatrix(m4a.multiply(m4b));
          B['hand_' + s].quaternion.copy(qb.copy(W['lowerarm_' + s]).invert()).multiply(q);
          W['hand_' + s].copy(q);
          const fist = rig.grip[s].fist.clone().applyQuaternion(q).add(pos['hand_' + s]);
          if (!top || fist.distanceTo(bh) < top.distanceTo(bh)) top = fist;
        }
        const L = bt.distanceTo(bh);
        this.batFix = { h: top.toArray(), t: top.clone().addScaledVector(bd, L).toArray() };
      }
      // the helmet or cap sits on the head and turns with it
      this.headG.position.copy(pos.head); this.gear.position.set(0, 0, 0);   // the helmet and cap are measured from the head bone
      this.headG.quaternion.copy(W.head);
      const fittedHeadgear=this.isProduction && PLAYER_FIT;
      this.helmet.position.set(0,fittedHeadgear ? -.025 : 0,fittedHeadgear ? .012 : 0);
      this.helmet.scale.set(fittedHeadgear ? .94 : 1,fittedHeadgear ? .80 : 1,fittedHeadgear ? .90 : 1);
      // a bigger head only where the head is small on screen (the long-lens match camera, under about 3% of the screen's height),
      // true size in close-ups (the toss, wicket close-ups, replays: over about 6%), so close up they don't look like bobbleheads
      const headK = headSizeAt(pos.head);
      // his own head shape (width, length, depth: bone x, y, z); the helmet, cap or hat grows to the largest so nothing pokes through
      const hs = renderQuery.get('hshape') ? renderQuery.get('hshape').split(',').map(Number) : playerLook(pr.pid || '').shape;
      B.head.scale.set(headK * hs[0], headK * hs[1], headK * hs[2]); this.headG.scale.setScalar(headK * Math.max(1, hs[0], hs[1], hs[2]));
      // fingers: a fist round the bat handle (gloves), relaxed otherwise
      const curl = rig.curl[(pr.team === 'bat' && pr.gloves) || pr.keeper ? 'grip' : 'relax'];
      for (const k in curl) if (B[k]) B[k].quaternion.copy(curl[k]);
      // kit colours
      const P = this.parts;
      if (P.KIT_Jersey) P.KIT_Jersey.material.color.copy(shirt.color);
      if (P.KIT_Trousers) P.KIT_Trousers.material.color.copy(pants.color);
      if (P.KIT_Trim) P.KIT_Trim.material.color.copy(pants.color).multiplyScalar(0.8);
      if (P.RB_Body) {
        const team = G.inn && !pr.umpire ? G.inn[pr.team === 'bat' ? 'bat' : 'bowl'] : null, ub = P.RB_Body.material.userData.u, uh = P.RB_Head.material.userData.u;
        ub.uShirt.value.copy(shirt.color); ub.uPants.value.copy(pants.color); ub.uTrim.value.copy(shirt === M3.batShirt ? M3.batTrim.color : shirt === M3.umpShirt ? M3.umpPants.color : M3.bowlTrim.color);
        const pool = pr.umpire ? UMP : (team && FACE_POOL[team.id]) || MIX, at = team ? team.players.findIndex(p => (p.key || p.name) === pr.pid) : -1;
        const own = at >= 0 && team.players[at].face;   // your own player (Settings → My player) picked his face and skin tone
        let [fi, shade] = own || pool[(pr.faceKey ?? (at >= 0 ? at + hash(team.id) : skinIdx)) % pool.length], face = RIG.faces[fi % RIG.faces.length];
        const pl = own ? team.players[at] : null, pf = pl && pl.photo && pl.photo3d ? photoFace(pl.photo, fi) : null;
        if (pf) { face = pf; shade = 1; }   // his photo on his face: its own skin colour, so no tone on top
        if (face && face.map && P.RB_Head.material.map !== face.map) { P.RB_Head.material.map = face.map; P.RB_Head.material.needsUpdate = true; }
        // a darker tone from a lighter photo: take away more blue than red, as real darker skin has (an even darkening goes grey)
        uh.uSkin.value.setRGB(shade, Math.pow(shade, 1.22), Math.pow(shade, 1.5));
        const look = playerLook(pr.pid || '');   // his own facial hair (from his name)
        uh.uBeard.value.copy(look.beard); uh.uHair.value.copy(look.hair);
        if (face && RIG.bodySkin) ub.uSkin.value.setRGB(face.skin.r / RIG.bodySkin.r, face.skin.g / RIG.bodySkin.g, face.skin.b / RIG.bodySkin.b).multiply(uh.uSkin.value);
        const ink = inkFor(shirt.color);
        drawBack(this.back, pr.umpire ? '' : at >= 0 ? team.players[at].name : pr.pid || '', ink, pr.pid, at >= 0 ? team.players[at].num : 0);   // the name shown (a names file may change it)
        const ct = chestTex(team, shirt.color);
        if (P.RB_Chest.material.map !== ct) { P.RB_Chest.material.map = ct; P.RB_Chest.material.needsUpdate = true; }
      }
      if (this.isProduction) PRODUCTION.setAppearance(P, shirt.color, pants.color, SKIN_TONES[skinIdx % SKIN_TONES.length], pr.umpire ? undefined : G.inn?.[pr.team==='bat'?'bat':'bowl']?.id);
      if(this.isProduction && PRODUCTION.reference && P.SKIN_Human?.morphTargetDictionary?.Blink!==undefined) {
        const t=(G.clock+skinIdx*.613)%4.7;
        const close=t<.12?T.MathUtils.smoothstep(t,0,.12):1-T.MathUtils.smoothstep(t,.16,.28);
        P.SKIN_Human.morphTargetInfluences[P.SKIN_Human.morphTargetDictionary.Blink]=PRODUCTION.blinkOverride ?? (pr.bat?.contact ? .08 : Math.max(.08,close));
      }
      if (this.kit && RIG.skinBase) {   // the body: team colours under the kit, and this player's skin tone (the model's colours carry the face and hair)
        const u = this.kit.userData.u, t = SKIN_TONES[skinIdx % SKIN_TONES.length];
        u.uShirt.value.copy(shirt.color); u.uPants.value.copy(pants.color); u.uTrim.value.copy(pants.color);
        u.uSkin.value.setRGB(Math.min(1.6, t.r / RIG.skinBase.r), Math.min(1.6, t.g / RIG.skinBase.g), Math.min(1.6, t.b / RIG.skinBase.b));
        u.uShoe.value.set('#1a1d24');
      }
      // gloves on the hands (batters and the keeper); fingers tuck a little inside them
      const gloved = (pr.team === 'bat' && pr.gloves) || pr.keeper;
      for (const s of ['l', 'r']) {
        const gl = pr.keeper ? this['eqK' + s] : this['eqG' + s], other = pr.keeper ? this['eqG' + s] : this['eqK' + s];
        if (other) other.visible = false;
        if (gl) {
          if (gl.parent !== B['hand_' + s]) { B['hand_' + s].add(gl); const f = rig.glove[s]; gl.position.copy(f.pos); gl.quaternion.copy(f.quat); gl.scale.set(f.sx, 1, 1); }
          gl.visible = !!gloved && !gloved3 && (EQUIP_OPT.gloves === 'model' || !this.kit || !!pr.keeper);   // the keeper always wears the keeping-glove model   // (the textured player has no painted-on gloves)
        }
        for (const f of ['index', 'middle', 'ring', 'pinky', 'thumb']) { const bn = B[f + '_01_' + s]; if (bn) bn.scale.setScalar(gloved3 ? 1 : gloved && gl && gl.visible ? 0.7 : 1); }
      }
      if (this.kit) this.kit.userData.u.uGlove.value = gloved && !gloved3 && !pr.keeper && EQUIP_OPT.gloves === 'built' ? 1 : 0;   // the grip gloves replace the painted gloves
    }
    set(pr) {
      const j = pr.j, bat = pr.team === 'bat', keeper = !!pr.keeper;
      if (this.model) this.model.visible = true;
      const ump = !!pr.umpire, shirt = bat ? M3.batShirt : ump ? M3.umpShirt : M3.bowlShirt, pants = bat ? M3.batPants : ump ? M3.umpPants : M3.bowlPants;
      const hs = hash(pr.pid || 'x'), skin = SKIN[hs % SKIN.length];
      this.g.visible = true;
      // the body's own axes: across the shoulders (vs), up the spine (vu), forward (vf)
      vu.set(j.neck[0] - j.pelvis[0], j.neck[1] - j.pelvis[1], j.neck[2] - j.pelvis[2]);
      const Lt = vu.length(); vu.normalize();
      vs.set(j.shL[0] - j.shR[0], j.shL[1] - j.shR[1], j.shL[2] - j.shR[2]);
      vs.addScaledVector(vu, -vs.dot(vu)).normalize();
      vf.crossVectors(vs, vu).normalize();
      const side = vs.clone(), fwd = vf.clone(), yawB = Math.atan2(fwd.x, fwd.z);
      // legs: batters and the keeper wear pads over the shins
      const padded = (bat || keeper) && !pr.bare;
      for (const [th, sh, pd, kn, ft, so, hip, knee, foot] of [[this.thighL, this.shinL, this.padL, this.kneeL, this.footL, this.soleL, j.hipL, j.kneeL, j.footL],
                                                              [this.thighR, this.shinR, this.padR, this.kneeR, this.footR, this.soleR, j.hipR, j.kneeR, j.footR]]) {
        th.material = pants; seg(th, hip, knee, 0.078);
        const ank = [foot[0], foot[1] + 0.08, foot[2]];
        sh.material = pants; seg(sh, knee, ank, 0.058); sh.visible = !padded;
        pd.visible = padded;
        if (padded) segFlat(pd, [knee[0], knee[1] + 0.1, knee[2]], [ank[0], ank[1] - 0.03, ank[2]], side, this.model ? 0.1 : 0.088, this.model ? 0.095 : 0.072, this.model ? 0.028 : 0.012);
        kn.material = padded ? M3.pads : pants; ball3(kn, knee, padded ? 0.08 : 0.062);
        // shoes point the way the body faces (toes slightly out)
        const toe = [Math.sin(yawB), 0, Math.cos(yawB)];
        ft.position.set(foot[0] + toe[0] * 0.05, foot[1] + 0.045, foot[2] + toe[2] * 0.05); ft.rotation.set(0, yawB, 0); ft.scale.set(0.052, 0.042, 0.13);
        so.position.set(foot[0] + toe[0] * 0.05, foot[1] + 0.012, foot[2] + toe[2] * 0.05); so.rotation.set(0, yawB, 0); so.scale.set(0.075, 0.016, 0.2);
      }
      // trunk: set from the shoulder line and the spine
      mB.makeBasis(vs.clone().multiplyScalar(0.46), vu.clone().multiplyScalar(Lt * 1.04), vf.clone().multiplyScalar(0.27));
      mB.setPosition((j.pelvis[0] + j.neck[0]) / 2, (j.pelvis[1] + j.neck[1]) / 2 + 0.01, (j.pelvis[2] + j.neck[2]) / 2);
      this.torso.matrix.copy(mB); this.torso.material = this.model ? INVIS : shirt;
      this.number.visible = false;
      this.hips.material = pants; this.hips.position.set(j.pelvis[0], j.pelvis[1] - 0.03, j.pelvis[2]);
      this.hips.quaternion.setFromRotationMatrix(mB.makeBasis(vs, vu, vf)); this.hips.scale.set(0.185, 0.12, 0.125);
      // arms, with a rounded shoulder
      for (const [de, up, fo, el, hd, sh, elb, hand] of [[this.delL, this.upL, this.foreL, this.elbL, this.handL, j.shL, j.elL, j.handL],
                                                        [this.delR, this.upR, this.foreR, this.elbR, this.handR, j.shR, j.elR, j.handR]]) {
        de.material = shirt; ball3(de, [sh[0] - vu.x * 0.015, sh[1] - vu.y * 0.015, sh[2] - vu.z * 0.015], 0.068);
        up.material = shirt; seg(up, sh, elb, 0.054);
        fo.material = bat || keeper ? shirt : skin; seg(fo, elb, hand, 0.044);
        el.material = shirt; ball3(el, elb, 0.047);
        const gl = (bat && pr.gloves) || keeper;
        hd.visible = !this.model; hd.material = gl ? M3.gloves : skin; ball3(hd, hand, gl ? 0.06 : 0.042, gl ? 0.055 : 0.048, gl ? 0.065 : 0.042);
      }
      // head
      const hp = j.head;
      this.neck.material = skin; seg(this.neck, j.neck, [hp[0], hp[1] - 0.07, hp[2]], 0.05);
      const lookDir = pr.look ? vd.set(pr.look[0], pr.look[1], pr.look[2]) : vd.copy(vf).setY(0).normalize();
      const yaw = Math.atan2(lookDir.x, lookDir.z);
      this.headG.position.set(hp[0], hp[1], hp[2]); this.headG.rotation.set(-0.08, yaw, 0, 'YXZ');
      this.gear.position.set(0, -0.105, 0.0);   // without the model, the head joint is the middle of the head
      for (const m of [this.skull, this.jaw, this.nose, this.earL, this.earR]) m.material = skin;
      const helm = (bat || keeper) && !pr.bare && !pr.helmOff && !BARE_ALL;   // (helmOff: a batter's helmet off to celebrate his hundred)
      if (M3.keepHelmet) this.helmet.children[0].material = keeper ? M3.keepHelmet : M3.helmet;
      this.helmet.visible = helm; this.cap.visible = !helm && !ump && !pr.bare && !pr.helmOff && !BARE_ALL; this.hat.visible = ump; this.hair.visible = !helm && !ump;
      this.shades.visible = !helm && hs % 3 === 0;
      // the bat: handle, a flat blade and the ridge down its back
      if (this.model) this.fit(pr, fwd, side, hs, shirt, pants);
      const hasBat = !!pr.bat, eq = !!this.eqBat;
      if (eq) {   // the code-built bat and pads replace the simple shapes
        this.padL.visible = this.padR.visible = false;
        for (const [o, knee, foot, sx] of [[this.eqPadL, j.kneeL, j.footL, 1], [this.eqPadR, j.kneeR, j.footR, -1]]) {
          o.visible = padded;
          if (!padded) continue;
          const kn = new T.Vector3(knee[0], knee[1], knee[2]), an = new T.Vector3(foot[0], foot[1] + 0.07, foot[2]);
          const down = an.clone().sub(kn), L = down.length();
          const sf = this.wq && this.wq[sx > 0 ? 'calf_l' : 'calf_r'] ? v2.set(0, 0, 1).applyQuaternion(this.wq[sx > 0 ? 'calf_l' : 'calf_r']).clone() : fwd;
          placeEq(o, kn, down, sf, L / 0.44, 1);
        }
        this.eqBat.visible = hasBat;
        if (hasBat && this.bat3) {   // the grip's one bat transform
          this.eqBat.matrix.compose(this.bat3.O, this.bat3.Bq, v3.set(1, 1, 1)); this.eqBat.matrixWorldNeedsUpdate = true;
        } else if (hasBat) {
          const h = this.batFix ? this.batFix.h : pr.bat.hands, t = this.batFix ? this.batFix.t : pr.bat.tip;
          const H = new T.Vector3(h[0], h[1], h[2]), d = new T.Vector3(t[0], t[1], t[2]).sub(H), L = d.length(); d.normalize();
          const face = pr.look ? new T.Vector3(pr.look[0], pr.look[1], pr.look[2]) : fwd;
          placeEq(this.eqBat, H.clone().addScaledVector(d, -0.07), d, face, (L + 0.07) / 0.86);
        }
      }
      this.handle.visible = this.blade.visible = this.spine.visible = hasBat && !eq;
      if (hasBat) {
        const h = this.batFix ? this.batFix.h : pr.bat.hands, t = this.batFix ? this.batFix.t : pr.bat.tip, k = 0.32, mid = [h[0] + (t[0] - h[0]) * k, h[1] + (t[1] - h[1]) * k, h[2] + (t[2] - h[2]) * k];
        seg(this.handle, [h[0] - (t[0] - h[0]) * 0.06, h[1] - (t[1] - h[1]) * 0.06, h[2] - (t[2] - h[2]) * 0.06], mid, 0.017);
        seg(this.blade, mid, t, 1); this.blade.scale.x = 0.108; this.blade.scale.z = 0.03;
        seg(this.spine, mid, t, 1); this.spine.scale.x = 0.04; this.spine.scale.z = 0.055; this.spine.scale.y *= 0.85;
      }
      // set() updates role-dependent visibility every frame. Keep fallback
      // shins/hair hidden after those updates, not just once when GLB loads.
      if (this.model) this.hideLegacyBody();
    }
  }
  const pool = [];
  for (let i = 0; i < 16; i++) pool.push(new Person());   // 13 or 14 players and the two umpires
  if(PRODUCTION) PRODUCTION.framing=()=>{
    scene.updateMatrixWorld(true);
    return pool.slice(0,3).map((p,index)=>{
      if(!p.model)return null;
      let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;const v=new T.Vector3();
      p.model.traverse(o=>{
        if(!o.isMesh)return;
        for(let parent=o;parent;parent=parent.parent)if(!parent.visible)return;
        if(o.isSkinnedMesh)o.skeleton.update();
        for(let i=0;i<o.geometry.attributes.position.count;i++) {
          v.fromBufferAttribute(o.geometry.attributes.position,i);if(o.isSkinnedMesh)o.boneTransform(i,v);v.applyMatrix4(o.matrixWorld).project(camera);
          const x=(v.x+1)*G.W/2,y=(1-v.y)*G.H/2;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
        }
      });
      return {index,left,right,top,bottom,heightFraction:(bottom-top)/G.H,visible:p.model.visible};
    });
  };
  // Slow, opt-in development check: intersect posed triangles, not projected
  // silhouettes. Camera overlap alone does not establish a mesh intersection.
  function auditPerson(p) {
    if (!p.model) return null;
    scene.updateMatrixWorld(true);
    const stumpBoxes = [0,PITCH].flatMap(z => [-.1,0,.1].map(x => new T.Box3(new T.Vector3(x-.019,0,z-.019),new T.Vector3(x+.019,.735,z+.019))));
    const bladeBox = new T.Box3(new T.Vector3(-.054, -.86, -.052), new T.Vector3(.054, -.30, .0124));
    const batInverse = p.bat3 ? new T.Matrix4().compose(p.bat3.O,p.bat3.Bq,new T.Vector3(1,1,1)).invert() : null;
    const result = { bodyWicket: 0, bladeBody: 0, bladeWicket: 0, bladeEquipment: 0, equipmentWicket: 0, byEquipment: {}, byMesh: {}, byBone: {}, examples: [], legacyBodyVisible: [] };
    if(batInverse && p.sourceBat && p.sourceBat.contact)result.contactDistance=bladeBox.distanceToPoint(new T.Vector3().fromArray(p.sourceBat.contact).applyMatrix4(batInverse));
    for (const k of ['shinL','shinR','hair','shades']) if (p[k].visible) result.legacyBodyVisible.push(k);
    const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),tri=new T.Triangle(a,b,c);
    p.model.traverse(o => {
      if (!o.isSkinnedMesh || !o.visible) return;
      o.skeleton.update();
      const g=o.geometry, positions=[];
      for(let i=0;i<g.attributes.position.count;i++) {
        const v=new T.Vector3().fromBufferAttribute(g.attributes.position,i);o.boneTransform(i,v);v.applyMatrix4(o.matrixWorld);positions.push(v);
      }
      const idx=g.index, count=idx?idx.count:positions.length;
      let hits=0;
      for(let i=0;i<count;i+=3) {
        a.copy(positions[idx?idx.getX(i):i]);b.copy(positions[idx?idx.getX(i+1):i+1]);c.copy(positions[idx?idx.getX(i+2):i+2]);
        if(stumpBoxes.some(box=>box.intersectsTriangle(tri))) result.bodyWicket++;
        if(batInverse) {
          a.applyMatrix4(batInverse);b.applyMatrix4(batInverse);c.applyMatrix4(batInverse);
          if(bladeBox.intersectsTriangle(tri)) {
            hits++;
            const bone=o.skeleton.bones[g.attributes.skinIndex.getX(idx?idx.getX(i):i)].name;
            result.byBone[bone]=(result.byBone[bone]||0)+1;
            if(result.examples.length<8) result.examples.push({mesh:o.name,batLocal:a.clone().add(b).add(c).multiplyScalar(1/3).toArray()});
          }
        }
      }
      result.byMesh[o.name]=hits;result.bladeBody+=hits;
    });
    if(p.eqBat && p.eqBat.visible) p.eqBat.traverse(o=>{
      if(!o.isMesh || o.material!==M3.blade)return;
      const g=o.geometry,idx=g.index,count=idx?idx.count:g.attributes.position.count;
      for(let i=0;i<count;i+=3) {
        for(const [v,k] of [[a,0],[b,1],[c,2]])v.fromBufferAttribute(g.attributes.position,idx?idx.getX(i+k):i+k).applyMatrix4(o.matrixWorld);
        if(stumpBoxes.some(box=>box.intersectsTriangle(tri)))result.bladeWicket++;
      }
    });
    for(const key of ['eqPadL','eqPadR','helmet','eqHelmet','cap','eqCap']) {
      const root=p[key];if(!root || !root.visible)continue;
      let hits=0;
      root.traverse(o=>{
        if(!o.isMesh || !o.visible)return;
        const g=o.geometry,idx=g.index,count=idx?idx.count:g.attributes.position.count;
        for(let i=0;i<count;i+=3) {
          for(const [v,k] of [[a,0],[b,1],[c,2]])v.fromBufferAttribute(g.attributes.position,idx?idx.getX(i+k):i+k).applyMatrix4(o.matrixWorld);
          if(stumpBoxes.some(box=>box.intersectsTriangle(tri)))result.equipmentWicket++;
          if(batInverse){a.applyMatrix4(batInverse);b.applyMatrix4(batInverse);c.applyMatrix4(batInverse);if(bladeBox.intersectsTriangle(tri))hits++;}
        }
      });
      result.byEquipment[key]=hits;result.bladeEquipment+=hits;
    }
    return result;
  }
  if (PRODUCTION && (PRODUCTION.enabled || PRODUCTION.audit)) PRODUCTION.inspect = () => pool.filter(p => p.isProduction || PRODUCTION.audit && p.sourceBat).map(p => ({
    visible: p.model.visible,
    headMatrix: p.bones.head.matrixWorld.toArray(),
    helmetMatrix: p.eqHelmet?.matrixWorld.toArray(),helmetVisible:!!p.eqHelmet?.visible,
    bones: Object.fromEntries(Object.entries(p.bones).map(([name, b]) => [name, {
      position: b.position.toArray(), quaternion: b.quaternion.toArray(), scale: b.scale.toArray()
    }])),
    meshes: Object.values(p.parts).map(o => ({ name: o.material.name,
      triangles: (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 })),
    armFit: PRODUCTION.audit ? p.armFit : undefined,
    grip: p.bat3 ? { origin: p.bat3.O.toArray(), quaternion: p.bat3.Bq.toArray(), wristGapMetres: p.gripResidual } : null,
    collisions: PRODUCTION.audit ? auditPerson(p) : undefined
  }));
  window.CR_CUFFANG = () => pool.filter(p => p.bat3 && p.gloveCuff && p.gripG).map(p => Object.fromEntries(['l', 'r'].map(s => {   // angle (deg) between each forearm and its glove's line
    const hp = p.lastHand && p.lastHand[s]; return [s, hp ? +hp.toFixed(1) : null]; })));
  window.CR_GRIPGAP = () => pool.filter(p => p.bat3 && p.gripResidual).map(p => Object.fromEntries(Object.entries(p.gripResidual).map(([k, v]) => [k, +v.toFixed(3)])));   // how far each wrist is from its glove (m), for checking poses
  // Development probe: measure the actual fitted blade, after clearance and arm IK.
  window.CR_BAT_CONTACT = point => pool.filter(p => p.g.visible && p.bat3 && p.sourceBat && !p.sourceBat.carry).map(p => {
    const local = new T.Vector3().fromArray(point).sub(p.bat3.O).applyQuaternion(p.bat3.Bq.clone().invert());
    let bottomY=Infinity;
    for(const x of [bladeEnvelope.min.x,bladeEnvelope.max.x])for(const y of [bladeEnvelope.min.y,bladeEnvelope.max.y])for(const z of [bladeEnvelope.min.z,bladeEnvelope.max.z])
      bottomY=Math.min(bottomY,new T.Vector3(x,y,z).applyQuaternion(p.bat3.Bq).add(p.bat3.O).y);
    return { local: local.toArray(), distance: bladeEnvelope.distanceToPoint(local), bottomY, wristGap: p.gripResidual, clearanceShift: p.bat3.authoredO ? p.bat3.O.clone().sub(p.bat3.authoredO).toArray() : null };
  });
  if(PRODUCTION)PRODUCTION.cameraAudit=()=>{
    const invalid=[];scene.traverse(o=>{if(o.visible && o.matrixWorld.elements.some(x=>!Number.isFinite(x)))invalid.push(o.name||o.type);});
    return {position:camera.position.toArray(),target:cam.tgt.slice(),near:camera.near,fov:camera.fov,invalid,
      postfx:!!composer,contextLost:renderer.getContext().isContextLost(),size:[view.width,view.height],
      ball:ballMesh.visible?ballMesh.position.clone().project(camera).toArray():null};
  };
  const blobs = [];
  for (let i = 0; i < 16; i++) { const b = new T.Mesh(blobGeo, blobMat); b.scale.set(0.9, 1, 0.9); b.position.y = 0.012; scene.add(b); blobs.push(b); }

  // ---------------------------------------------------------------- the TV look (pmndrs postprocessing, vendor/)
  // glow around the floodlights and the ball, filmic tone mapping, a slightly calmer colour grade and a soft vignette
  const PP = window.POSTPROCESSING;
  let composer = null, portraitFocus = null;
  const nearFwd = new T.Vector3(), nearRay = new T.Vector3();
  function makeComposer() {
    if (!PP || new URLSearchParams(location.search).get('postfx')==='off') return null;
    try {
      const gl2 = renderer.capabilities.isWebGL2;
      const c = new PP.EffectComposer(renderer, { frameBufferType: gl2 ? T.HalfFloatType : T.UnsignedByteType,
                                                  stencilBuffer: true,   // gives the pass a 24-bit depth buffer: the default is 16-bit, too coarse at match-camera distance (heads showed through helmets, trousers through pads)
                                                  multisample: gl2 && !lowEnd ? Math.min(4, renderer.capabilities.maxSamples || 0) : 0 });
      c.addPass(new PP.RenderPass(scene, camera));
      if(presentationSlice && !lowEnd) {
        portraitFocus = new PP.DepthOfFieldEffect(camera,{worldFocusDistance:3,worldFocusRange:1.6,bokehScale:2.5,height:480});
        portraitFocus.target=new T.Vector3();
        c.addPass(new PP.EffectPass(camera,portraitFocus));
      }
      const bloom = new PP.BloomEffect({ intensity: PRODUCTION?.reference ? .18 : LOOK_PLAYER ? .25 : 0.9, luminanceThreshold: 0.9, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.72 });
      const tone = new PP.ToneMappingEffect({ mode: PP.ToneMappingMode.ACES_FILMIC });
      const grade = new PP.HueSaturationEffect({ saturation: 0.16 });
      const contrast = new PP.BrightnessContrastEffect({ brightness: 0.0, contrast: 0.1 });
      const vignette = new PP.VignetteEffect({ offset: 0.32, darkness: 0.42 });
      c.addPass(new PP.EffectPass(camera, bloom, tone, grade, contrast, vignette));
      renderer.toneMapping = T.NoToneMapping;   // done in the effect pass instead
      return c;
    } catch (e) { renderer.toneMapping = T.ACESFilmicToneMapping; return null; }
  }
  composer = makeComposer();
  function dropComposer() { if (!composer) return; composer.dispose(); composer = null; renderer.toneMapping = T.ACESFilmicToneMapping; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); }

  // ---------------------------------------------------------------- the match's conditions (G.cond: t time, s sky, p pitch; G.rope)
  // night under a clear sky is the look the game always had; the menu shows it too
  // the sky colours are linear (the sky shader encodes its output, as the night sky always did): on screen they come out lighter
  const COND_LOOKS = {   // [sky top, middle, horizon, fog], hemisphere [sky, ground, strength], key light [colour, strength], the other towers, floodlights on, stars
    '0-0': { sky: ['#3561a4', '#6792c2', '#b5cada', '#7398be'], hemi: [0xcfe3ff, 0x55603f, 0.7], key: [0xfff1dc, 1.7], fill: 0.1, lamps: false, stars: 0, grass: [1.14, 1.1, 0.8] },
    '0-1': { sky: ['#525a64', '#777f88', '#a4aaaf', '#646c76'], hemi: [0xdde4ec, 0x5b6050, 1.05], key: [0xeef2f6, 0.75], fill: 0.2, lamps: false, stars: 0, grass: [0.9, 0.95, 0.92] },
    '1-0': { sky: ['#06092b', '#6f2d47', '#e25a22', '#130c1b'], hemi: [0xd9c0d0, 0x3a4030, 0.62], key: [0xffdcb8, 1.35], fill: 0.38, lamps: true, stars: 0.25, grass: [1.08, 0.78, 0.56] },
    '1-1': { sky: ['#2c2634', '#4c3642', '#8c5242', '#2a2230'], hemi: [0xcfc4cc, 0x3a4030, 0.7], key: [0xffe6cc, 1.2], fill: 0.4, lamps: true, stars: 0, grass: [0.92, 0.74, 0.64] },
    '2-0': { sky: ['#0b1838', '#24407a', '#6f6f9e', '#16224a'], hemi: [0xb9c8ff, 0x3a4a30, 0.45], key: [0xfff3dd, 1.25], fill: 0.3, lamps: true, stars: 0.7, grass: [0.52, 0.62, 0.9] },
    '2-1': { sky: ['#1e2028', '#2c2e38', '#40424c', '#20222a'], hemi: [0xb4bccc, 0x3a4a30, 0.45], key: [0xfff3dd, 1.25], fill: 0.3, lamps: true, stars: 0, grass: [0.5, 0.58, 0.74] },
  };
  const PITCH_TINT = [[1, 1, 1], [0.7, 0.9, 0.52], [1.08, 1.02, 0.9]];   // flat, green, dry
  let condKey = '';
  function applyCond() {
    const c = G.cond || { t: 2, s: 0, p: 0 }, key = c.t + '-' + c.s + '-' + c.p + '-' + G.rope;
    if (key === condKey || presentationSlice || PRODUCTION?.reference) return;
    condKey = key;
    const L = COND_LOOKS[c.t + "-" + c.s] || COND_LOOKS["2-0"], u = sky.material.uniforms;
    u.top.value.set(L.sky[0]); u.mid.value.set(L.sky[1]); u.bot.value.set(L.sky[2]);
    scene.fog.color.set(L.sky[3]); scene.background.set(L.sky[1]);
    hemi.color.setHex(L.hemi[0]); hemi.groundColor.setHex(L.hemi[1]); hemi.intensity = L.hemi[2];
    lightDirs.forEach((d, i) => { if (i === 0) { d.color.setHex(L.key[0]); d.intensity = L.key[1]; } else d.intensity = L.fill; });
    towerGlows.forEach(g => { g.visible = L.lamps; });
    towerBanks.forEach(b => b.material.color.setScalar(L.lamps ? 1 : 0.45));
    if (stars) { stars.material.opacity = L.stars; stars.visible = L.stars > 0; }
    // the grass carries the time of day, since the match camera hardly shows the sky; the pitch takes half of it
    const gr = L.grass || [1, 1, 1], pt = PITCH_TINT[c.p] || PITCH_TINT[0], half = i => (1 + gr[i]) / 2;
    field.material.color.setRGB(gr[0], gr[1], gr[2]); apron.material.color.setHex(0x1a5a22).multiply(field.material.color);
    pitch.material.color.setRGB(pt[0] * half(0), pt[1] * half(1), pt[2] * half(2));
    const k = (G.rope || ROPE) / ROPE; rope.scale.set(k, k, 1);
  }

  // ---------------------------------------------------------------- each frame
  let lastW = 0, lastH = 0, maxRatio = lowEnd ? 1.5 : 2;
  function size() {
    const w = view.clientWidth, h = view.clientHeight;
    if (w === lastW && h === lastH) return;
    lastW = w; lastH = h;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxRatio));
    renderer.setSize(w, h, false);
    if (composer) composer.setSize(w, h, false);
  }
  // keep it smooth on slow devices: if frames take too long for a few seconds, drop the TV look, then draw fewer pixels, then drop the shadows
  let qLevel = 0, qT = 0, qN = 0, qLast = 0;
  function quality(now) {
    if (qLast) { const dt = now - qLast; if (dt < 250) { qT += dt; qN++; } }   // ignore pauses (hidden tab)
    qLast = now;
    if (qN < 150) return;
    const avg = qT / qN; qT = 0; qN = 0;
    if (avg > 38 && qLevel < 3) {
      qLevel++;
      if (qLevel === 1) { if (composer) dropComposer(); else qLevel++; }
      if (qLevel === 2) { maxRatio = 1; lastW = 0; }
      if (qLevel === 3) { renderer.shadowMap.enabled = false; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); }
    }
  }
  function teamColours() {
    const bat = G.inn ? G.inn.bat : null, bowl = G.inn ? G.inn.bowl : null;
    M3.batShirt.color.set(bat ? bat.col : '#3d7dff'); M3.batPants.color.set(bat ? bat.dark : '#173f99');
    M3.helmet.color.set(bat ? (bat.helmet || bat.dark) : '#173f99');
    if(PRODUCTION?.reference)M3.helmet.color.multiplyScalar(.30);
    M3.bowlShirt.color.set(bowl ? bowl.col : '#ffd23c'); M3.bowlPants.color.set(bowl ? bowl.dark : '#0e6b40');
    M3.cap.color.set(bowl ? bowl.dark : '#0e6b40');
    if (!M3.keepHelmet) M3.keepHelmet = M3.helmet.clone();   // the keeper wears his own side's helmet
    M3.keepHelmet.color.set(bowl ? (bowl.helmet || bowl.dark) : '#0e6b40');
    // the trim (collar, cuffs, side panels): the team's second colour, made lighter or darker so it stands out on the shirt
    for (const [trim, shirt, pants] of [[M3.batTrim, M3.batShirt, M3.batPants], [M3.bowlTrim, M3.bowlShirt, M3.bowlPants]])
      trim.color.copy(pants.color).lerp(shirt.color, 0.0).multiplyScalar(1.0);
  }
  function setStumps(st, tilt, bails) {
    st.s.forEach((m, i) => { const a = tilt ? tilt[i] : 0; m.rotation.set(-a, 0, -(i - 1) * 0.25 * a); });
    st.b.forEach((m, i) => {
      if (bails && bails[i]) { m.position.set(bails[i].p[0], bails[i].p[1], bails[i].p[2]); m.rotation.y = bails[i].p[1] > 0.05 ? G.clock * 9 : 0.4; }
      else { m.position.set(i ? 0.055 : -0.055, 0.72, st.z); m.rotation.y = 0; }
    });
  }

  function render3d() {
    const perfStart = perf ? performance.now() : 0;
    quality(performance.now());
    size();
    applyCond();
    // the game's camera (the same maths as its 2D projection, so the guides line up)
    const aspect = G.W / Math.max(1, G.H);
    let fov = cam.fov;
    if (aspect < 1.35) fov = 2 * Math.atan(Math.tan(cam.fov * deg / 2) / G.viewZoom(aspect)) / deg;
    if(PRODUCTION && PRODUCTION.reference && G.projectionFocal) fov=2*Math.atan(G.H/(2*G.projectionFocal))/deg;
    // the game may move the picture's centre up (upright screens): render a taller view and show its lower part
    const sh = G.camShift || 0, fullH = G.H + 2 * sh;
    if (sh) {
      fov = 2 * Math.atan(Math.tan(fov * deg / 2) * fullH / G.H) / deg;
      camera.setViewOffset(G.W, fullH, 0, 2 * sh, G.W, G.H);
    } else if (camera.view) camera.clearViewOffset();
    camera.fov = fov; camera.aspect = G.W / Math.max(1, sh ? fullH : G.H); camera.updateProjectionMatrix();
    camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]); camera.lookAt(cam.tgt[0], cam.tgt[1], cam.tgt[2]);
    // A long broadcast lens needs a tighter depth range: the old 0.3 m near
    // plane quantised close garment/hair surfaces into the same depth at 80 m.
    // The near plane follows the camera's distance to what it looks at, so the depth buffer's precision goes where the players are.
    let near = Math.max(.3, Math.min(12, Math.hypot(cam.pos[0] - cam.tgt[0], cam.pos[1] - cam.tgt[1], cam.pos[2] - cam.tgt[2]) * .22));
    // ...but never past the grass at the bottom of the picture: a replay aimed at a far catch from 8.5 m up cut the
    // nearby grass away, and the sky showed through as a coloured band along the bottom of a phone's tall screen.
    if (near > .3 && camera.position.y > 0) {
      camera.getWorldDirection(nearFwd);
      for (const x of [-1, 0, 1]) {
        nearRay.set(x, -1, .5).unproject(camera).sub(camera.position);
        if (nearRay.y >= 0) continue;
        const depth = -camera.position.y / nearRay.y * nearRay.dot(nearFwd);
        near = Math.max(.3, Math.min(near, depth * .8));
      }
    }
    if(camera.near !== near){camera.near=near;camera.updateProjectionMatrix();}
    if(portraitFocus) {
      portraitFocus.target.fromArray(cam.tgt);
      portraitFocus.cocMaterial.copyCameraSettings(camera);
      // Use optical separation only for a close replay; live broadcast views
      // retain the full field and ball in focus. Mobile skips this extra pass.
      portraitFocus.bokehScale=camera.position.distanceTo(portraitFocus.target)<12?2.5:0;
    }

    teamColours();
    updateCrowd();
    { const st = G.stumps; setStumps(stumpsNear, st.tilt, st.bails); }
    setStumps(stumpsFar, null, null);

    const perfPeople = perf ? performance.now() : 0;
    const list = G.M ? people() : [];
    const perfFit = perf ? performance.now() : 0;
    loadModel(); loadEquipment(); loadGrip(); loadProduction();
    pool.forEach((p, i) => { if (i < list.length) p.set(list[i]); else { p.g.visible = false; if (p.model) p.model.visible = false; } });
    const perfFitEnd = perf ? performance.now() : 0;
    blobs.forEach((b, i) => { b.visible = i < list.length; if (b.visible) b.position.set(list[i].at[0], 0.012, list[i].at[2]); });

    { const c = G.coin; coinMesh.visible = !!c; if (c) { coinMesh.position.set(c.pos[0], c.pos[1], c.pos[2]); coinMesh.rotation.set(c.ang, 0, 0); } }
    const bp = G.M ? ballPos() : null;
    ballMesh.visible = ballGlow.visible = ballShadow.visible = !!bp;
    if (bp) {
      ballMesh.position.set(bp[0], bp[1], bp[2]); ballGlow.position.copy(ballMesh.position);
      if(PRODUCTION?.reference && G.projectionFocal) {
        const metresPerPixel=camera.position.distanceTo(ballMesh.position)/G.projectionFocal;
        ballMesh.scale.setScalar(Math.max(1,2.2*metresPerPixel/.036));
        const halo=Math.max(.12,9*metresPerPixel);ballGlow.scale.set(halo,halo,1);
      }
      ballShadow.position.set(bp[0], 0.013, bp[2]);
    }
    const tr = G.ball && G.ball.trail;
    trail.visible = !!(tr && tr.length > 1);
    if (trail.visible) {
      for (let i = 0; i < TRAIL; i++) { const q = tr[Math.max(0, tr.length - TRAIL + i)] || tr[0]; trailPos[i * 3] = q[0]; trailPos[i * 3 + 1] = q[1]; trailPos[i * 3 + 2] = q[2]; }
      trailGeo.attributes.position.needsUpdate = true;
    }
    if (bp && G.ball && G.ball.play) { const t2 = G.ball.trail || (G.ball.trail = []); t2.push(bp.slice()); if (t2.length > 12) t2.shift(); }
    { const b = G.ball, d = b && b.decision, big = !!(tr && b.play && d && d.kind === 'hit' && b.play.res && b.play.res.kind === 'six' && b.play.t < 2.5);
      comet.forEach((sp, i) => { const q = big && tr[tr.length - 1 - i]; sp.visible = !!q; if (!q) return;
        const k = 1 - i / COMET; sp.position.set(q[0], q[1], q[2]); sp.material.color.setHex(0xfff2d0);
        sp.material.opacity = 0.18 * k; sp.scale.setScalar(Math.max(0.12, camera.position.distanceTo(sp.position) * 0.006) * k); }); }
    if (perf) renderer.info.reset();
    const perfSubmit = perf ? performance.now() : 0;
    if (composer) composer.render(); else renderer.render(scene, camera);
    if (perf) {
      const end = performance.now();
      perf.record({
        frameIntervalMs: perfLast === null || document.hidden ? null : perfStart - perfLast,
        peopleMs: perfFit - perfPeople, fitMs: perfFitEnd - perfFit, submitMs: end - perfSubmit, viewMs: end - perfStart,
        calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries,
        quality: qLevel, postfx: !!composer, width: view.width, height: view.height,
        player: PRODUCTION?.enabled ? PRODUCTION.variant : 'default',
        ready: !!window.CR_MODEL_READY && (!PRODUCTION?.enabled || PRODUCTION.ready), playing: !!G.M
      });
      perfLast = document.hidden ? null : perfStart;
    }
  }

  // ---------------------------------------------------------------- switch
  function apply() { view.style.display = on ? 'block' : 'none'; const b = $('gfxToggle'); if (b) { b.textContent = on ? 'Graphics: 3D' : 'Graphics: 2D'; b.setAttribute('aria-pressed',String(on)); } }
  const btn = $('gfxToggle');
  if (btn) {
    btn.hidden = false;
    btn.addEventListener('click', () => { on = !on; try { localStorage.setItem(KEY, on ? '3d' : '2d'); } catch (e) {} apply(); });
  }
  // A phone may take the GPU away while the game is in the background: show 2D meanwhile, and go back to 3D by itself
  // when the browser gives it back (unless the player picked 2D in between). Textures are uploaded again from their images.
  let lostOn = false;
  view.addEventListener('webglcontextlost', e => { e.preventDefault(); lostOn = lostOn || on; on = false; apply(); });
  view.addEventListener('webglcontextrestored', () => {
    scene.traverse(o => { for (const m of [].concat(o.material || [])) { m.needsUpdate = true; for (const k in m) { const v = m[k]; if (v && v.isTexture) v.needsUpdate = true; } } });
    lastW = lastH = 0;   // size() sets the renderer and the TV look's buffers up again on the next frame
    let pref = '3d'; try { pref = localStorage.getItem(KEY) || '3d'; } catch (e) {}
    if (lostOn && pref !== '2d') on = true;
    lostOn = false; apply();
  });
  apply();
  return { active: () => on, render: render3d };
};

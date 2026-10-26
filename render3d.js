// Cricket Rush: the 3D view (three.js). The game itself (index.html) runs the match and the 2D guides;
// this file only draws the world from the game's state: the same camera, ball and player joints.
// The game calls Cricket3D(G) with a view of its state; it returns null if WebGL isn't available (the game keeps its 2D picture).
window.Cricket3D = function (G) {
  'use strict';
  if (!window.THREE) return null;
  const { touch, LIGHTS, BOARDS, STAND_IN, STAND_OUT, STAND_H, PITCH, CREASE, ROPE, lerp, people, ballPos, cam, deg, $ } = G;
  const T = THREE;
  if (T.ColorManagement) T.ColorManagement.legacyMode = false;   // colours given as '#hex' are sRGB, as in CSS
  const view = document.getElementById('view3d');
  let renderer;
  try {
    renderer = new T.WebGLRenderer({ canvas: view, antialias: true, powerPreference: 'high-performance' });
  } catch (e) { view.style.display = 'none'; return null; }

  // ---------------------------------------------------------------- settings
  const KEY = 'cricket-rush-gfx';
  let on = true;
  try { on = localStorage.getItem(KEY) !== '2d'; } catch (e) {}
  const lowEnd = touch;   // phones and tablets: lighter shadows and resolution
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;

  const scene = new T.Scene();
  scene.fog = new T.Fog(0x0a1024, 160, 420);
  const camera = new T.PerspectiveCamera(30, 1, 0.3, 900);
  const V = (a) => new T.Vector3(a[0], a[1], a[2]);

  // canvas textures
  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
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
  const sky = new T.Mesh(new T.SphereGeometry(600, 32, 16), new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new T.Color(0x02050f) }, mid: { value: new T.Color(0x0c1638) }, bot: { value: new T.Color(0x1d2c5e) } },
    vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying float h; void main(){ vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.6, h)) : mix(bot, mid, smoothstep(-0.05, 0.12, h)); gl_FragColor = vec4(c, 1.0); }',
  }));
  scene.add(sky);
  {
    const n = 900, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = 0.18 + Math.random() * 1.2, r = 560;
      pos[i * 3] = Math.cos(e) * Math.sin(a) * r; pos[i * 3 + 1] = Math.sin(e) * r; pos[i * 3 + 2] = Math.cos(e) * Math.cos(a) * r;
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
    scene.add(new T.Points(g, new T.PointsMaterial({ color: 0xc8d2ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.7 })));
  }

  // ---------------------------------------------------------------- lights: four floodlight towers
  scene.add(new T.HemisphereLight(0x8ea4ff, 0x1c2e1c, 0.35));
  const lightDirs = [];
  LIGHTS.forEach((L, i) => {
    const top = [L[0], 46, L[2]];
    const d = new T.DirectionalLight(0xfff3dd, i === 0 ? 1.15 : 0.32);
    d.position.set(top[0], top[1], top[2]); d.target.position.set(0, 0, 8);
    scene.add(d); scene.add(d.target);
    if (i === 0) {
      d.castShadow = true;
      const s = lowEnd ? 1024 : 2048;
      d.shadow.mapSize.set(s, s);
      const c = d.shadow.camera; c.left = -60; c.right = 60; c.top = 60; c.bottom = -60; c.near = 20; c.far = 260;
      d.shadow.bias = -0.0004; d.shadow.normalBias = 0.03;
    }
    lightDirs.push(d);
    // the tower and its lamp bank
    const tower = new T.Mesh(new T.CylinderGeometry(0.5, 1.1, 46, 8), new T.MeshStandardMaterial({ color: 0x222a44, roughness: 0.8, metalness: 0.3 }));
    tower.position.set(L[0], 23, L[2]); scene.add(tower);
    const bank = new T.Mesh(new T.BoxGeometry(11, 6, 0.8), new T.MeshBasicMaterial({ map: canvasTex(128, 64, (g, w, h) => {
      g.fillStyle = '#2a3150'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) { g.fillStyle = '#fffbe8'; g.fillRect(4 + x * 15.5, 4 + y * 15, 11, 11); }
    }) }));
    bank.position.set(top[0], top[1] + 2, top[2]); bank.lookAt(0, 0, 8); scene.add(bank);
    const glow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xfff4d8, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
    glow.position.copy(bank.position).multiplyScalar(0.985); glow.scale.set(60, 60, 1); scene.add(glow);
  });

  // ---------------------------------------------------------------- ground
  const outside = new T.Mesh(new T.CircleGeometry(300, 48), new T.MeshStandardMaterial({ color: 0x0b160f, roughness: 1 }));
  outside.rotation.x = -Math.PI / 2; outside.position.y = -0.06; scene.add(outside);

  const grassTex = canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#2c6e33'; g.fillRect(0, 0, w, h);
    const k = w / (BOARDS * 2), band = 5 * k;
    // mowing stripes across the field (light, dark, light ...), with soft edges
    for (let y = 0; y < h; y += band * 2) {
      const gr = g.createLinearGradient(0, y, 0, y + band);
      gr.addColorStop(0, 'rgba(18,48,22,0)'); gr.addColorStop(0.12, 'rgba(18,48,22,0.30)'); gr.addColorStop(0.88, 'rgba(18,48,22,0.30)'); gr.addColorStop(1, 'rgba(18,48,22,0)');
      g.fillStyle = gr; g.fillRect(0, y, w, band);
    }
    noise(g, w, h, 26000, ['rgba(255,255,255,0.035)', 'rgba(0,0,0,0.05)', 'rgba(20,60,20,0.08)'], 2);
    const r = g.createRadialGradient(w / 2, h / 2, w * 0.1, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,220,0.06)'); r.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
  const field = new T.Mesh(new T.CircleGeometry(BOARDS, 128), new T.MeshStandardMaterial({ map: grassTex, roughness: 0.95 }));
  field.rotation.x = -Math.PI / 2; field.receiveShadow = true; scene.add(field);
  const apron = new T.Mesh(new T.RingGeometry(BOARDS, STAND_IN + 0.5, 128, 1), new T.MeshStandardMaterial({ color: 0x1d5a2a, roughness: 1 }));
  apron.rotation.x = -Math.PI / 2; apron.position.y = -0.01; apron.receiveShadow = true; scene.add(apron);

  // the square and the pitch (with the creases painted on)
  const PW = 3.7, PL = PITCH + 3.2, z0 = -1.6;
  const pitchTex = canvasTex(256, 2048, (g, w, h) => {
    const X = x => (x + PW / 2) / PW * w, Z = z => (z - z0) / PL * h;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#c7b185'; g.fillRect(X(-1.52), 0, X(1.52) - X(-1.52), h);
    g.fillStyle = '#d3bf95'; g.fillRect(X(-1.2), Z(2), X(1.2) - X(-1.2), Z(PITCH - 2) - Z(2));
    g.save(); g.beginPath(); g.rect(X(-1.52), 0, X(1.52) - X(-1.52), h); g.clip();
    noise(g, w, h, 9000, ['rgba(120,90,50,0.10)', 'rgba(255,255,240,0.06)'], 2); g.restore();
    // worn patches where the bowlers land and the batters stand
    for (const zc of [1.2, 3.5, PITCH - 1.2, PITCH - 3.5]) { g.fillStyle = 'rgba(130,100,60,0.16)'; g.beginPath(); g.ellipse(X(0), Z(zc), w * 0.16, h * 0.035, 0, 0, Math.PI * 2); g.fill(); }
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
  const ADS = [['CRICKET RUSH', '#0a1024', '#ffb02e'], ['FLOODLIGHT FM', '#13306e', '#f3efe4'], ['SIXER COLA', '#c43a4d', '#ffffff'],
               ['GULLY BANK', '#0f5b57', '#f6d36b'], ['NIGHT OWL TEA', '#ffb02e', '#0a1024'], ['SPIN KING', '#5a47b8', '#ffffff']];
  const adTex = canvasTex(3072, 64, (g, w, h) => {
    const pw = w / ADS.length;
    ADS.forEach(([t, bg, fg], i) => {
      g.fillStyle = bg; g.fillRect(i * pw, 0, pw, h);
      g.fillStyle = fg; g.font = '900 40px "Big Shoulders Display", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
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
    const seats = canvasTex(1024, 512, (g, w, h) => {
      g.fillStyle = '#141c36'; g.fillRect(0, 0, w, h);
      const cols = ['#cfc8b8', '#d9963a', '#2aa59b', '#c9475a', '#6c78bd', '#d8bc5e', '#3a6fd8', '#8a93ad', '#e6e1d6', '#5a3f30'];
      for (let i = 0; i < 26000; i++) {
        g.globalAlpha = 0.35 + Math.random() * 0.45; g.fillStyle = cols[(Math.random() * cols.length) | 0];
        const x = Math.random() * w, y = Math.random() * h; g.fillRect(x, y, 2 + Math.random() * 2, 3 + Math.random() * 2);
      }
      g.globalAlpha = 1;
    }, true);
    seats.repeat.set(30, 1);
    const stand = new T.Mesh(new T.LatheGeometry(pts, 96), new T.MeshBasicMaterial({ map: seats, side: T.DoubleSide, color: 0x9aa3c0 }));
    scene.add(stand); standMesh = stand;
    // a lit strip along the front of the upper deck
    const strip = new T.Mesh(new T.CylinderGeometry(STAND_OUT + 0.6, STAND_OUT + 0.6, 0.5, 96, 1, true), new T.MeshBasicMaterial({ color: 0x2ed3c6, side: T.BackSide }));
    strip.position.y = STAND_H + 0.8; scene.add(strip);
  }
  const standMat = standMesh.material;
  const standBase = standMat.color.clone();
  function updateCrowd() {
    const c = G.cheer > 0.02 ? G.cheer * (0.55 + 0.45 * Math.sin(G.clock * 18)) : 0;
    standMat.color.copy(standBase).multiplyScalar(1 + c * 0.45);
    if (standMat.map) standMat.map.offset.y = c ? Math.sin(G.clock * 24) * 0.004 * c : 0;
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
  const ballMesh = new T.Mesh(new T.SphereGeometry(0.045, 14, 10), new T.MeshBasicMaterial({ color: 0xffffff }));
  scene.add(ballMesh);
  const ballGlow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, blending: T.AdditiveBlending }));
  ballGlow.scale.set(0.55, 0.55, 1); scene.add(ballGlow);
  const blobGeo = new T.PlaneGeometry(1, 1); blobGeo.rotateX(-Math.PI / 2);
  const blobMat = new T.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
  const ballShadow = new T.Mesh(blobGeo, blobMat); ballShadow.scale.set(0.2, 1, 0.2); scene.add(ballShadow);
  const TRAIL = 12, trailPos = new Float32Array(TRAIL * 3), trailGeo = new T.BufferGeometry();
  trailGeo.setAttribute('position', new T.BufferAttribute(trailPos, 3));
  const trail = new T.Line(trailGeo, new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, blending: T.AdditiveBlending }));
  trail.frustumCulled = false; scene.add(trail);

  // ---------------------------------------------------------------- players
  const SKIN = ['#8d5a3b', '#b07650', '#c99872', '#e0b48f', '#6b4029'].map(c => new T.MeshStandardMaterial({ color: c, roughness: 0.7 }));
  const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
  const mat = c => new T.MeshStandardMaterial({ color: c, roughness: 0.7 });
  const M3 = {
    batShirt: mat('#3d7dff'), batPants: mat('#173f99'), bowlShirt: mat('#ffd23c'), bowlPants: mat('#0e6b40'),
    helmet: new T.MeshStandardMaterial({ color: 0x173f99, roughness: 0.35, metalness: 0.2 }), grille: new T.MeshStandardMaterial({ color: 0x9aa0aa, metalness: 0.8, roughness: 0.3 }),
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
  const halfDisc = new T.CylinderGeometry(1, 1, 1, 18, 1, false, -Math.PI / 2, Math.PI);
  const bar = new T.TorusGeometry(1, 0.035, 5, 16, Math.PI * 0.9);
  const box = new T.BoxGeometry(1, 1, 1);
  const UP = new T.Vector3(0, 1, 0);
  const va = new T.Vector3(), vb = new T.Vector3(), vd = new T.Vector3(), vs = new T.Vector3(), vf = new T.Vector3(), vu = new T.Vector3(), vx = new T.Vector3(), vy = new T.Vector3();
  const mB = new T.Matrix4();
  const HAIR = mat('#1b1410'), SHADE = new T.MeshStandardMaterial({ color: 0x111111, roughness: 0.2, metalness: 0.6 });

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
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4;
    return { c, t, who: '' };
  }
  function drawBack(b, name) {
    if (b.who === name) return; b.who = name;
    const g = b.c.getContext('2d'); g.clearRect(0, 0, 128, 128);
    const sur = (name.split(' ').pop() || '').toUpperCase().slice(0, 10), num = 1 + (hash(name) % 98);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffffff'; g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3;
    g.font = 'bold 20px sans-serif'; g.strokeText(sur, 64, 22); g.fillText(sur, 64, 22);
    g.font = 'bold 76px sans-serif'; g.strokeText(String(num), 64, 82); g.fillText(String(num), 64, 82);
    b.t.needsUpdate = true;
  }

  // ---------------------------------------------------------------- the realistic body (vendor/player-model.js, built by tools/build-player.py
  // from MakeHuman's CC0 body). Its skeleton is driven from the game's joints every frame: each bone is placed at the matching
  // joint and turned so it points at the next one, with the knee / elbow bend or the body's facing fixing the twist.
  const RIG = { tried: false, tmpl: null, rest: {} };
  const INVIS = new T.MeshBasicMaterial({ visible: false });
  const EYES = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.25 });
  const SKINV = SKIN.map(m => new T.MeshStandardMaterial({ color: m.color.clone().multiplyScalar(1.12), vertexColors: true, roughness: 0.62 }));
  // one material per player: the kit is cut per pixel along clean lines in the rest pose (waist, collar, sleeves, ankles),
  // so the edges are sharp whatever the triangles; the collar and sleeve ends get a trim in the team's second colour
  function kitMaterial() {
    const k = RIG.kit, V3 = a => new T.Vector3(a[0], a[1], a[2]);
    const u = { uShirt: { value: new T.Color() }, uPants: { value: new T.Color() }, uSkin: { value: new T.Color() }, uShoe: { value: new T.Color('#f2f2f2') },
                uTrim: { value: new T.Color() }, uKit: { value: new T.Vector3(k.waist, k.neck, k.ankle) },
                uShL: { value: V3(k.shL) }, uElL: { value: V3(k.elL) }, uShR: { value: V3(k.shR) }, uElR: { value: V3(k.elR) } };
    const m = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
    m.userData.u = u;
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = 'attribute vec3 _rest;\nattribute vec4 _part;\nvarying vec3 vRest;\nvarying vec4 vPart;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRest = _rest; vPart = _part;');
      sh.fragmentShader = 'uniform vec3 uShirt, uPants, uSkin, uShoe, uTrim, uKit, uShL, uElL, uShR, uElR;\nvarying vec3 vRest;\nvarying vec4 vPart;\nfloat kRough;\n' +
        sh.fragmentShader.replace('#include <color_fragment>', `
  vec3 kc = uShirt; kRough = 0.86;
  float neckLine = uKit.y - 0.045 - 0.03 * smoothstep(0.0, 0.09, vRest.z);
  if (vPart.w > 0.5) { kc = vColor.rgb; kRough = 0.25; }
  else if (vPart.z > 0.5 || vPart.y > 0.5) { kc = uSkin * vColor.rgb; kRough = 0.55; }
  else if (abs(vPart.x) > 0.5) {
    vec3 s = vPart.x > 0.0 ? uShL : uShR, e = vPart.x > 0.0 ? uElL : uElR;
    float t = dot(vRest - s, e - s) / dot(e - s, e - s);
    if (t > 0.62) { kc = uSkin * vColor.rgb; kRough = 0.55; } else if (t > 0.57) kc = uTrim;
  }
  else if (vRest.y < uKit.z + 0.035) { kc = uShoe; kRough = 0.45; }
  else if (vRest.y > neckLine && abs(vRest.x) < 0.11) { kc = uSkin * vColor.rgb; kRough = 0.55; }
  else if (vRest.y > neckLine - 0.014 && abs(vRest.x) < 0.12) kc = uTrim;
  else if (vRest.y < uKit.x) { kc = uPants; kRough = 0.8; }
  diffuseColor.rgb = kc;`).replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = kRough;');
    };
    m.customProgramCacheKey = () => 'cricket-kit-1';
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
  function restFrames() {   // the rest pose's frames, from the bone positions in the model
    const r = RIG.rest, R = RIG.restQ = {}, fwd = new T.Vector3(0, 0, 1), side = new T.Vector3(1, 0, 0), up = new T.Vector3(0, 1, 0);
    r.headTop = r.head.clone().add(new T.Vector3(0, 0.16, -0.01));
    for (const s of ['l', 'r']) {
      r['handTip_' + s] = r['middle_01_' + s].clone();
      r['toe_' + s] = r['ball_' + s].clone().add(new T.Vector3(0, 0.006, 0.073));
    }
    const hint = { side, hips: side, fwd, up, look: side,
                   poleL: pole(r.upperarm_l, r.lowerarm_l, r.hand_l, fwd), poleR: pole(r.upperarm_r, r.lowerarm_r, r.hand_r, fwd),
                   kneeL: pole(r.thigh_l, r.calf_l, r.foot_l, fwd), kneeR: pole(r.thigh_r, r.calf_r, r.foot_r, fwd) };
    // finger curl: about the line across the knuckles, toward the palm (which faces the body in the rest pose)
    RIG.curl = { grip: {}, relax: {} };
    for (const s of ['l', 'r']) {
      const a = new T.Vector3().subVectors(r['index_01_' + s], r['pinky_01_' + s]).normalize();
      const d = new T.Vector3().subVectors(r['middle_01_' + s], r['hand_' + s]).normalize();
      const palm = new T.Vector3(-Math.sign(r['hand_' + s].x), 0, 0);
      const sg = Math.sign(new T.Vector3().crossVectors(a, d).dot(palm)) || 1;
      for (const [mode, ang] of [['grip', [1.25, 1.45, 0.95]], ['relax', [0.3, 0.45, 0.3]]])
        for (const f of ['index', 'middle', 'ring', 'pinky', 'thumb'])
          for (let k = 1; k <= 3; k++) {
            const t = f === 'thumb' ? (k === 1 ? 0 : ang[k - 1] * 0.5) : ang[k - 1];
            RIG.curl[mode][f + '_0' + k + '_' + s] = new T.Quaternion().setFromAxisAngle(a, sg * t);
          }
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
        g.scene.traverse(o => { if (o.isBone) RIG.rest[o.name] = o.getWorldPosition(new T.Vector3()); });
        restFrames();
        pool.forEach(p => p.attach());
      }, e => console.warn('player model', e));
    } catch (e) { console.warn('player model', e); }
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
      // helmet: shell, peak, side flaps and a grille of curved bars
      this.helmet = new T.Group(); h.add(this.helmet);
      const HM = (geo, m) => part(geo, m, this.helmet);
      const shell = HM(dome, M3.helmet); shell.scale.set(0.128, 0.138, 0.14); shell.position.set(0, -0.005, -0.006);
      const peak = HM(halfDisc, M3.helmet); peak.scale.set(0.13, 0.01, 0.075); peak.position.set(0, 0.035, 0.11); peak.rotation.x = 0.18;
      for (const s of [1, -1]) { const f = HM(box, M3.helmet); f.scale.set(0.02, 0.1, 0.1); f.position.set(s * 0.115, -0.06, 0.02); }
      for (let i = 0; i < 3; i++) {
        const b = HM(bar, M3.grille); const r = 0.12 - i * 0.004;
        b.scale.set(r, r, r); b.rotation.set(Math.PI / 2, 0, Math.PI * 0.05); b.position.set(0, 0.0 - i * 0.042, 0.0);
      }
      const stem = HM(box, M3.grille); stem.scale.set(0.008, 0.09, 0.008); stem.position.set(0, -0.045, 0.12);
      // cap: crown, button and a curved peak
      this.cap = new T.Group(); h.add(this.cap);
      const CM = (geo, m) => part(geo, m, this.cap);
      const crown = CM(dome, M3.cap); crown.scale.set(0.108, 0.1, 0.116); crown.position.set(0, 0.025, -0.004);
      const brim = CM(halfDisc, M3.cap); brim.scale.set(0.105, 0.008, 0.09); brim.position.set(0, 0.03, 0.1); brim.rotation.x = 0.1;
      const btn = CM(sph, M3.cap); btn.scale.set(0.012, 0.008, 0.012); btn.position.set(0, 0.126, -0.004);
      this.handle = P(cyl, M3.grip); this.blade = P(box, M3.blade); this.spine = P(box, M3.blade);
    }
    attach() {
      const root = T.SkeletonUtils.clone(RIG.tmpl);
      this.model = root; this.bones = {}; this.parts = {};
      root.traverse(o => {
        if (o.isBone) this.bones[o.name] = o;
        if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; o.material = this.kit = kitMaterial(); }
      });
      scene.add(root);
      // the shape-built body stays for the equipment (pads, gloves, helmet, cap, bat, shirt number); the rest is hidden
      for (const k of ['thighL', 'thighR', 'shinL', 'shinR', 'kneeL', 'kneeR', 'footL', 'footR', 'soleL', 'soleR', 'hips', 'delL', 'delR',
                       'upL', 'upR', 'foreL', 'foreR', 'elbL', 'elbR', 'neck', 'skull', 'jaw', 'nose', 'earL', 'earR', 'hair', 'shades']) this[k].visible = false;
      this.hidden = true;
    }
    fit(pr, fwd, side, skinIdx, shirt, pants) {
      const j = pr.j, B = this.bones, r = RIG.rest, W = this.wq || (this.wq = {}), Wp = this.wp || (this.wp = {});
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
        const yaw = Math.atan2(fwd.x, fwd.z), toe = v1.subVectors(r['ball_' + s], r['foot_' + s]).applyAxisAngle(new T.Vector3(0, 1, 0), yaw).clone();
        pos['ball_' + s] = ank.clone().add(toe);
        pos['toe_' + s] = pos['ball_' + s].clone().add(new T.Vector3(Math.sin(yaw) * 0.073, 0.006, Math.cos(yaw) * 0.073));
      }
      const lookV = pr.look ? new T.Vector3(pr.look[0], 0, pr.look[2]).normalize() : fwd.clone().setY(0).normalize();
      const hint = { side, hips: hipSide, fwd, up: new T.Vector3(0, 1, 0), look: new T.Vector3(lookV.z, 0, -lookV.x),
                     poleL: pole(pos.upperarm_l, pos.lowerarm_l, pos.hand_l, fwd), poleR: pole(pos.upperarm_r, pos.lowerarm_r, pos.hand_r, fwd),
                     kneeL: pole(pos.thigh_l, pos.calf_l, pos.foot_l, fwd), kneeR: pole(pos.thigh_r, pos.calf_r, pos.foot_r, fwd) };
      // world rotations, then local ones down the hierarchy (the bind pose has no rotation, so rest frames are world frames)
      for (const b of ORDER) {
        const [to, tw] = AIM[b];
        frame(v4.subVectors(pos[to], pos[b]).clone(), hint[tw], m4a);
        m4b.copy(RIG.restQ[b]).transpose();
        const q = (W[b] || (W[b] = new T.Quaternion())).setFromRotationMatrix(m4a.multiply(m4b));
        Wp[b] = pos[b];
        const p = PARENT[b], bone = B[b];
        if (!p) { bone.quaternion.copy(q); bone.position.copy(pos[b]); continue; }
        qb.copy(W[p]).invert();
        bone.quaternion.copy(qb).multiply(q);
        bone.position.subVectors(pos[b], Wp[p]).applyQuaternion(qb);
      }
      // fingers: a fist round the bat handle (gloves), relaxed otherwise
      const curl = RIG.curl[(pr.team === 'bat' && pr.gloves) || pr.keeper ? 'grip' : 'relax'];
      for (const k in curl) if (B[k]) B[k].quaternion.copy(curl[k]);
      // kit colours
      const u = this.kit.userData.u;
      u.uShirt.value.copy(shirt.color); u.uPants.value.copy(pants.color); u.uTrim.value.copy(pants.color);
      u.uSkin.value.copy(SKIN_TONES[skinIdx % SKIN_TONES.length]);
    }
    set(pr) {
      const j = pr.j, bat = pr.team === 'bat', keeper = !!pr.keeper;
      if (this.model) this.model.visible = true;
      const shirt = bat ? M3.batShirt : M3.bowlShirt, pants = bat ? M3.batPants : M3.bowlPants;
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
      const padded = bat || keeper;
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
      this.number.visible = !keeper; if (!keeper) drawBack(this.back, pr.pid || '');
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
        hd.visible = !this.model || gl; hd.material = gl ? M3.gloves : skin; ball3(hd, hand, gl ? 0.06 : 0.042, gl ? 0.055 : 0.048, gl ? 0.065 : 0.042);
      }
      // head
      const hp = j.head;
      this.neck.material = skin; seg(this.neck, j.neck, [hp[0], hp[1] - 0.07, hp[2]], 0.05);
      const lookDir = pr.look ? vd.set(pr.look[0], pr.look[1], pr.look[2]) : vd.copy(vf).setY(0).normalize();
      const yaw = Math.atan2(lookDir.x, lookDir.z);
      this.headG.position.set(hp[0], hp[1], hp[2]); this.headG.rotation.set(-0.08, yaw, 0, 'YXZ');
      for (const m of [this.skull, this.jaw, this.nose, this.earL, this.earR]) m.material = skin;
      const helm = bat || keeper;
      this.helmet.visible = helm; this.cap.visible = !helm; this.hair.visible = !helm;
      this.shades.visible = !helm && hs % 3 === 0;
      // the bat: handle, a flat blade and the ridge down its back
      const hasBat = !!pr.bat;
      this.handle.visible = this.blade.visible = this.spine.visible = hasBat;
      if (hasBat) {
        const h = pr.bat.hands, t = pr.bat.tip, k = 0.32, mid = [h[0] + (t[0] - h[0]) * k, h[1] + (t[1] - h[1]) * k, h[2] + (t[2] - h[2]) * k];
        seg(this.handle, [h[0] - (t[0] - h[0]) * 0.06, h[1] - (t[1] - h[1]) * 0.06, h[2] - (t[2] - h[2]) * 0.06], mid, 0.017);
        seg(this.blade, mid, t, 1); this.blade.scale.x = 0.108; this.blade.scale.z = 0.03;
        seg(this.spine, mid, t, 1); this.spine.scale.x = 0.04; this.spine.scale.z = 0.055; this.spine.scale.y *= 0.85;
      }
      if (this.model) this.fit(pr, fwd, side, hs, shirt, pants);
    }
  }
  const pool = [];
  for (let i = 0; i < 14; i++) pool.push(new Person());
  const blobs = [];
  for (let i = 0; i < 14; i++) { const b = new T.Mesh(blobGeo, blobMat); b.scale.set(0.9, 1, 0.9); b.position.y = 0.012; scene.add(b); blobs.push(b); }

  // ---------------------------------------------------------------- the TV look (pmndrs postprocessing, vendor/)
  // glow around the floodlights and the ball, filmic tone mapping, a slightly calmer colour grade and a soft vignette
  const PP = window.POSTPROCESSING;
  let composer = null;
  function makeComposer() {
    if (!PP) return null;
    try {
      const gl2 = renderer.capabilities.isWebGL2;
      const c = new PP.EffectComposer(renderer, { frameBufferType: gl2 ? T.HalfFloatType : T.UnsignedByteType,
                                                  multisample: gl2 && !lowEnd ? Math.min(4, renderer.capabilities.maxSamples || 0) : 0 });
      c.addPass(new PP.RenderPass(scene, camera));
      const bloom = new PP.BloomEffect({ intensity: 1.15, luminanceThreshold: 0.78, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.72 });
      const tone = new PP.ToneMappingEffect({ mode: PP.ToneMappingMode.ACES_FILMIC });
      const grade = new PP.HueSaturationEffect({ saturation: -0.1 });
      const contrast = new PP.BrightnessContrastEffect({ brightness: 0.0, contrast: 0.1 });
      const vignette = new PP.VignetteEffect({ offset: 0.3, darkness: 0.62 });
      c.addPass(new PP.EffectPass(camera, bloom, tone, grade, contrast, vignette));
      renderer.toneMapping = T.NoToneMapping;   // done in the effect pass instead
      return c;
    } catch (e) { renderer.toneMapping = T.ACESFilmicToneMapping; return null; }
  }
  composer = makeComposer();
  function dropComposer() { if (!composer) return; composer.dispose(); composer = null; renderer.toneMapping = T.ACESFilmicToneMapping; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); }

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
    M3.bowlShirt.color.set(bowl ? bowl.col : '#ffd23c'); M3.bowlPants.color.set(bowl ? bowl.dark : '#0e6b40');
    M3.cap.color.set(bowl ? bowl.dark : '#0e6b40');
  }
  function setStumps(st, tilt, bails) {
    st.s.forEach((m, i) => { const a = tilt ? tilt[i] : 0; m.rotation.set(-a, 0, -(i - 1) * 0.25 * a); });
    st.b.forEach((m, i) => {
      if (bails && bails[i]) { m.position.set(bails[i].p[0], bails[i].p[1], bails[i].p[2]); m.rotation.y = bails[i].p[1] > 0.05 ? G.clock * 9 : 0.4; }
      else { m.position.set(i ? 0.055 : -0.055, 0.72, st.z); m.rotation.y = 0; }
    });
  }

  function render3d() {
    quality(performance.now());
    size();
    // the game's camera (the same maths as its 2D projection, so the guides line up)
    const aspect = G.W / Math.max(1, G.H);
    let fov = cam.fov;
    if (aspect < 1.35) fov = 2 * Math.atan(Math.tan(cam.fov * deg / 2) / Math.pow(aspect / 1.35, aspect < 0.8 ? 0.72 : 0.5)) / deg;
    // the game may move the picture's centre up (upright screens): render a taller view and show its lower part
    const sh = G.camShift || 0, fullH = G.H + 2 * sh;
    if (sh) {
      fov = 2 * Math.atan(Math.tan(fov * deg / 2) * fullH / G.H) / deg;
      camera.setViewOffset(G.W, fullH, 0, 2 * sh, G.W, G.H);
    } else if (camera.view) camera.clearViewOffset();
    camera.fov = fov; camera.aspect = G.W / Math.max(1, sh ? fullH : G.H); camera.updateProjectionMatrix();
    camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]); camera.lookAt(cam.tgt[0], cam.tgt[1], cam.tgt[2]);

    teamColours();
    updateCrowd();
    setStumps(stumpsNear, G.ball && G.ball.tilt ? G.ball.tilt.map(a => a * (G.ball.tiltT || 0)) : null, G.ball && G.ball.bails);
    setStumps(stumpsFar, null, null);

    const list = G.M ? people() : [];
    loadModel();
    pool.forEach((p, i) => { if (i < list.length) p.set(list[i]); else { p.g.visible = false; if (p.model) p.model.visible = false; } });
    blobs.forEach((b, i) => { b.visible = i < list.length; if (b.visible) b.position.set(list[i].at[0], 0.012, list[i].at[2]); });

    const bp = G.M ? ballPos() : null;
    ballMesh.visible = ballGlow.visible = ballShadow.visible = !!bp;
    if (bp) {
      ballMesh.position.set(bp[0], bp[1], bp[2]); ballGlow.position.copy(ballMesh.position);
      ballShadow.position.set(bp[0], 0.013, bp[2]);
    }
    const tr = G.ball && G.ball.trail;
    trail.visible = !!(tr && tr.length > 1);
    if (trail.visible) {
      for (let i = 0; i < TRAIL; i++) { const q = tr[Math.max(0, tr.length - TRAIL + i)] || tr[0]; trailPos[i * 3] = q[0]; trailPos[i * 3 + 1] = q[1]; trailPos[i * 3 + 2] = q[2]; }
      trailGeo.attributes.position.needsUpdate = true;
    }
    if (bp && G.ball && G.ball.play) { const t2 = G.ball.trail || (G.ball.trail = []); t2.push(bp.slice()); if (t2.length > 12) t2.shift(); }
    if (composer) composer.render(); else renderer.render(scene, camera);
  }

  // ---------------------------------------------------------------- switch
  function apply() { view.style.display = on ? 'block' : 'none'; const b = $('gfxToggle'); if (b) b.textContent = on ? 'Graphics: 3D' : 'Graphics: simple'; }
  const btn = $('gfxToggle');
  if (btn) {
    btn.hidden = false;
    btn.addEventListener('click', () => { on = !on; try { localStorage.setItem(KEY, on ? '3d' : '2d'); } catch (e) {} apply(); });
  }
  view.addEventListener('webglcontextlost', e => { e.preventDefault(); on = false; apply(); });
  apply();
  return { active: () => on, render: render3d };
};

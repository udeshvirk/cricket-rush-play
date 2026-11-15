/* Pure runner path for cricket between-wicket movement. Browser and CommonJS. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CricketLocomotion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_PITCH = 20.12;
  const DEFAULT_FIRST_DURATION = 3.0;
  const DEFAULT_MORE_DURATION = 2.7;
  const smoothstep = u => u * u * (3 - 2 * u);
  const clamp01 = u => Math.max(0, Math.min(1, u));

  function runner(options) {
    if (!options || typeof options !== 'object') return null;
    const time = Number(options.time);
    const runs = Math.floor(Number(options.runs));
    const startZ = Number(options.startZ);
    const x = Number(options.x);
    const pitch = options.pitch === undefined ? DEFAULT_PITCH : Number(options.pitch);
    const firstDuration = options.firstDuration === undefined ? DEFAULT_FIRST_DURATION : Number(options.firstDuration);
    const moreDuration = options.moreDuration === undefined ? DEFAULT_MORE_DURATION : Number(options.moreDuration);
    if (![time, runs, startZ, x, pitch, firstDuration, moreDuration].every(Number.isFinite) ||
        runs <= 0 || time <= 0 || pitch <= 1.2 || firstDuration <= 0 || moreDuration <= 0) return null;

    const startEnd = 0.6;
    const farEnd = pitch - 0.6;
    const otherEnd = startZ < pitch / 2 ? farEnd : startEnd;
    const length = Math.abs(otherEnd - startZ);
    if (length === 0) return null;

    let remaining = time;
    let leg = 0;
    while (leg < runs - 1 && remaining >= (leg === 0 ? firstDuration : moreDuration)) {
      remaining -= leg === 0 ? firstDuration : moreDuration;
      leg++;
    }
    const duration = leg === 0 ? firstDuration : moreDuration;
    const elapsed = Math.min(remaining, duration);
    const u = clamp01(elapsed / duration);
    const progress = Math.min(runs, leg + u);
    const from = leg % 2 === 0 ? startZ : otherEnd;
    const to = leg % 2 === 0 ? otherEnd : startZ;
    const ended = time >= firstDuration + Math.max(0, runs - 1) * moreDuration;
    const pathU = ended ? 1 : u;
    const z = ended ? (runs % 2 ? otherEnd : startZ) : from + (to - from) * smoothstep(pathU);

    // Rotate by a half turn through the final eased 13% of every leg. Keeping
    // this angle unwrapped makes each crease transition continuous, including
    // the terminal turn where the old progress wrap changed direction at once.
    const heading = (otherEnd > startZ ? 0 : Math.PI) + leg * Math.PI;
    const turnU = clamp01((u - 0.87) / 0.13);
    const face = heading + Math.PI * smoothstep(turnU);
    const moving = !ended;
    const speed = moving ? length * 6 * u * (1 - u) / duration : 0;
    return {
      pos: [x, 0, z],
      face,
      moving,
      runWeight: smoothstep(clamp01(speed / 4)),
      distance: Math.min(runs, leg + smoothstep(u)) * length,
      speed
    };
  }

  // The same running, but each run (leg) has its own start time and length: legs = [{ s, d, abort? }], times in
  // seconds since the hit. Between legs he waits at the crease, turned for the next one. A leg with `abort` set is
  // given up at that time: he turns and gets back to the crease he left, in `back` seconds (default BACK). Null before the
  // first leg starts.
  const BACK = 0.7;
  function legsRunner(options) {
    const legs = options && options.legs;
    if (!Array.isArray(legs) || !legs.length) return null;
    const time = Number(options.time), startZ = Number(options.startZ), x = Number(options.x);
    const pitch = options.pitch === undefined ? DEFAULT_PITCH : Number(options.pitch);
    if (![time, startZ, x, pitch].every(Number.isFinite) || pitch <= 1.2 || !(time >= legs[0].s)) return null;
    const otherEnd = startZ < pitch / 2 ? pitch - 0.6 : 0.6, length = Math.abs(otherEnd - startZ);
    if (length === 0) return null;
    let k = 0;
    while (k < legs.length - 1 && time >= legs[k + 1].s) k++;
    const leg = legs[k], from = k % 2 === 0 ? startZ : otherEnd, to = k % 2 === 0 ? otherEnd : startZ;
    const heading = (otherEnd > startZ ? 0 : Math.PI) + k * Math.PI;
    if (leg.abort !== undefined && time >= leg.abort) {   // sent back: turn and get back in
      const pa = clamp01((leg.abort - leg.s) / leg.d), zA = from + (to - from) * smoothstep(pa);
      const T = leg.back > 0 ? leg.back : BACK;
      const b = clamp01((time - leg.abort) / T), z = zA + (from - zA) * smoothstep(b), moving = b < 1;
      const speed = moving ? Math.abs(from - zA) * 6 * b * (1 - b) / T : 0;
      return { pos: [x, 0, z], face: heading + Math.PI * smoothstep(clamp01(b / 0.35)), moving,
               runWeight: smoothstep(clamp01(speed / 4)), distance: (k + smoothstep(pa)) * length + Math.abs(z - zA), speed,
               leg: k, u: pa, toZ: from, end: leg.abort + T };
    }
    const u = clamp01((time - leg.s) / leg.d), moving = time < leg.s + leg.d;
    const speed = moving ? length * 6 * u * (1 - u) / leg.d : 0;
    return { pos: [x, 0, from + (to - from) * smoothstep(u)], face: heading + Math.PI * smoothstep(clamp01((u - 0.87) / 0.13)), moving,
             runWeight: smoothstep(clamp01(speed / 4)), distance: (k + smoothstep(u)) * length, speed, leg: k, u, toZ: to, end: leg.s + leg.d };
  }

  return { runner, legsRunner, BACK };
});

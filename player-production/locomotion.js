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

  return { runner };
});

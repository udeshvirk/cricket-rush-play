// Opt-in measurements only. No GPU time or texture-byte claims from renderer.info.
(function (root) {
  'use strict';
  function create(metadata = {}, capacity = 3600) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Invalid sample capacity');
    const rows = new Array(capacity);
    let cursor = 0, count = 0, total = 0;
    const fields = ['frameIntervalMs', 'peopleMs', 'fitMs', 'submitMs', 'viewMs', 'calls', 'triangles', 'textures', 'geometries'];
    function reset() { cursor = count = total = 0; rows.fill(undefined); }
    function record(sample) {
      const copy = { ...sample };
      for (const key of fields) if (!(Number.isFinite(copy[key]) && copy[key] >= 0)) copy[key] = null;
      rows[cursor] = copy; cursor = (cursor + 1) % capacity;
      count = Math.min(count + 1, capacity); total++;
    }
    function samples() {
      return Array.from({ length: count }, (_, i) => ({ ...rows[(cursor - count + i + capacity) % capacity] }));
    }
    function stats(values) {
      values.sort((a, b) => a - b);
      if (!values.length) return { n: 0, p50: null, p95: null, p99: null, max: null };
      const q = p => values[Math.max(0, Math.ceil(p * values.length) - 1)];
      return { n: values.length, p50: q(.5), p95: q(.95), p99: q(.99), max: values[values.length - 1] };
    }
    function snapshot() {
      const groups = new Map();
      for (const row of samples()) {
        const key = JSON.stringify([row.quality, row.postfx, row.width, row.height, row.player, row.ready, row.playing]);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
      }
      return {
        schema: 1, metadata: { ...metadata }, totalSamples: total, retainedSamples: count, capacity,
        gpuTimeMs: null, textureBytes: null,
        notes: [
          'CPU wall times; GPU completion is not measured.',
          'Frame interval is between 3D renders, not simulation dt. Hidden/resume gaps are null; visible stalls remain.',
          'Draw counters include submitted passes; texture/geometries values are counts, not bytes.',
          'Rolling samples; loading, menus and each quality/resolution/variant are separate groups. Reset after warm-up.',
          'Software/virtual-time browser runs must not be used as hardware performance measurements.'
        ],
        groups: Array.from(groups.values(), group => ({
          quality: group[0].quality, postfx: group[0].postfx,
          width: group[0].width, height: group[0].height, player: group[0].player,
          ready: group[0].ready, playing: group[0].playing, samples: group.length,
          metrics: Object.fromEntries(fields.map(key => [key, stats(group.map(row => row[key]).filter(v => v !== null))]))
        }))
      };
    }
    return { record, reset, snapshot, samples };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { create };
  else root.CricketDiagnostics = { create };
})(typeof window !== 'undefined' ? window : globalThis);

// Volume Set Space performance probe (S10). Not a pass/fail test: prints a table.
// Usage: node e2e/volume-set/bench.mjs http://localhost:<port> [model ...]
// Needs a running demo server (VS_SYNTHETIC=1 for the synthetic sets).
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5193';
const models = process.argv.slice(3).length ? process.argv.slice(3) : ['synth', 'synth50', 'synth200'];
const pct = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

const browser = await chromium.launch();
const rows = [];
try {
  for (const model of models) {
    for (const mode of ['space', 'montage']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const t0 = Date.now();
      await page.goto(`${base}/?mode=${mode}&model=${model}&contrast=cue&stat=t&orient=axial`);
      await page.waitForFunction(() => window.__vsReady === true, null, { timeout: 120000 });
      if (mode === 'space') await page.waitForFunction(() => window.__vsSpace?.layout === 'ready', null, { timeout: 120000 });
      const readyMs = Date.now() - t0;
      const res = await page.evaluate(async () => {
        const el = document.querySelector('#slice');
        const max = Number(el.max);
        const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
        const lat = [];
        const runs0 = window.__vsSpace.runs;
        for (let i = 0; i < 2; i++) {
          for (let v = 0; v <= max; v++) {
            const t = performance.now();
            el.value = String(v);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            await frame(); // draw happens in this frame's callback
            await frame(); // ... and is on screen by the next one
            lat.push(performance.now() - t);
          }
        }
        return {
          lat,
          refits: window.__vsSpace.runs - runs0,
          fitMs: window.__vsSpace.fitMs,
          method: window.__vsSpace.method,
          status: window.__vsSpace.status,
          heapMB: performance.memory ? performance.memory.usedJSHeapSize / 2 ** 20 : null,
          canvases: document.querySelectorAll('canvas').length,
          workers: window.__vsSpace.workers,
          lod: window.__vsSpace.lod,
        };
      });
      rows.push({ model, mode, readyMs, fitMs: res.fitMs, method: res.method, status: res.status, p50: pct(res.lat, 0.5), p95: pct(res.lat, 0.95), refits: res.refits, heapMB: res.heapMB, canvases: res.canvases, workers: res.workers, lod: res.lod });
      await page.close();
    }
  }
} finally {
  await browser.close();
}
const f = (v, d = 0) => (typeof v === 'number' ? v.toFixed(d) : String(v));
console.log('model     mode     ready_ms fit_ms method/status                   scrub_p50 scrub_p95 refits heap_MB canvases workers lod');
for (const r of rows)
  console.log(
    [r.model.padEnd(9), r.mode.padEnd(8), f(r.readyMs).padStart(8), f(r.fitMs).padStart(6), `${r.method ?? '-'}/${r.status ?? '-'}`.padEnd(32), f(r.p50, 1).padStart(9), f(r.p95, 1).padStart(9), f(r.refits).padStart(6), f(r.heapMB, 0).padStart(7), f(r.canvases).padStart(8), f(r.workers).padStart(7), r.lod ?? '-'].join(' ')
  );

import { guidedSmooth } from '../../src/volumeset/smooth';

let anatomy: Float32Array | null = null;

interface Job {
  id: number;
  dim: number[];
  maskIndex: Int32Array;
  values: Float32Array;
  guide: 'self' | 'anatomy';
  radius: number;
  epsilon: number;
  guideScale?: { mean: number; sd: number };
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data as { type: 'init'; anatomy: Float32Array } | ({ type: 'job' } & Job);
  if (msg.type === 'init') {
    anatomy = msg.anatomy;
    return;
  }
  const guide = msg.guide === 'self' ? 'self' : anatomy;
  if (!guide) {
    (self as unknown as Worker).postMessage({ id: msg.id, error: 'anatomy guide not initialised' });
    return;
  }
  const out = guidedSmooth(msg.dim, msg.maskIndex, msg.values, guide, { radius: msg.radius, epsilon: msg.epsilon, guideScale: msg.guideScale });
  (self as unknown as Worker).postMessage({ id: msg.id, out }, [out.buffer]);
};

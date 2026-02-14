// Lightweight worker facade: postMessage with ScatterFieldOptions, returns ScatterFieldMessage
import { buildScatterField, ScatterFieldOptions, ScatterFieldMessage } from './ScatterFieldBuilder';

// @ts-ignore
self.onmessage = (e: MessageEvent<ScatterFieldOptions>) => {
  const opts = e.data;
  const result = buildScatterField(opts);
  const msg: ScatterFieldMessage = {
    volumeMeta: {
      dim: result.volume.space.dim.slice(),
      spacing: result.volume.space.spacing.slice(),
      origin: result.volume.space.origin.slice(),
      axesId: result.volume.space.axes.toString(),
    },
    data: result.data,
    maxValue: result.maxValue,
    nonZeroCount: result.nonZeroCount,
  };
  // Transfer buffer for zero-copy
  (self as any).postMessage(msg, [result.data.buffer]);
};

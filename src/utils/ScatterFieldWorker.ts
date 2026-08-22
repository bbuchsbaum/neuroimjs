// Lightweight worker facade: postMessage with plain metadata, returns ScatterFieldMessage
import {
  buildScatterField,
  ScatterFieldMessage,
  ScatterFieldWorkerRequest,
} from './ScatterFieldBuilder';
import { AxisSet3D, matchAxis } from '../geometry/Axis';
import { NeuroSpace } from '../geometry/NeuroSpace';

interface ScatterWorkerScope {
  onmessage: ((event: MessageEvent<ScatterFieldWorkerRequest>) => void) | null;
  postMessage(message: ScatterFieldMessage, transfer: Transferable[]): void;
}

const workerScope = self as unknown as ScatterWorkerScope;

workerScope.onmessage = (event) => {
  const request = event.data;
  const axes = new AxisSet3D(...request.spaceMeta.axisNames.map(matchAxis) as [
    ReturnType<typeof matchAxis>,
    ReturnType<typeof matchAxis>,
    ReturnType<typeof matchAxis>,
  ]);
  const space = new NeuroSpace(
    request.spaceMeta.dim,
    request.spaceMeta.spacing,
    request.spaceMeta.origin,
    axes,
    request.spaceMeta.affine
  );
  const result = buildScatterField({
    space,
    points: request.points,
    kernelParams: request.kernelParams,
    cutoffMm: request.cutoffMm,
    combine: request.combine,
  });
  const msg: ScatterFieldMessage = {
    volumeMeta: {
      dim: result.volume.space.dim.slice(),
      spacing: result.volume.space.spacing.slice(),
      origin: result.volume.space.origin.slice(),
      axisNames: result.volume.space.axes.names() as [string, string, string],
      affine: result.volume.space.trans.to2DArray(),
    },
    data: result.data,
    maxValue: result.maxValue,
    nonZeroCount: result.nonZeroCount,
  };
  // Transfer buffer for zero-copy
  workerScope.postMessage(msg, [result.data.buffer as ArrayBuffer]);
};

/**
 * Web Worker for parallel searchlight computation.
 * 
 * This worker processes batches of searchlight centers and returns
 * the computed ROI windows.
 */

import { NeuroSpace } from '../../geometry/NeuroSpace';
import { LogicalNeuroVol } from '../../volume/LogicalNeuroVol';
import { sphericalROI } from '../../roi/ROI_factories';
import { ROIVolWindow } from '../../roi/ROI_improved';

interface WorkerMessage {
  type: 'compute' | 'initialize';
  data: any;
}

interface InitializeData {
  maskData: Uint8Array;
  spaceDim: number[];
  spacing: number[];
  origin: number[];
  radius: number;
  nonzero: boolean;
}

interface ComputeData {
  indices: number[];
  startIdx: number;
}

interface WorkerState {
  mask: LogicalNeuroVol;
  radius: number;
  nonzero: boolean;
  allIndices: number[];
}

let state: WorkerState | null = null;

// Listen for messages from main thread
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { type, data } = event.data;

  try {
    switch (type) {
      case 'initialize':
        handleInitialize(data);
        break;
      case 'compute':
        handleCompute(data);
        break;
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

function handleInitialize(data: InitializeData) {
  // Create mask from transferred data
  const space = new NeuroSpace(data.spaceDim, data.spacing, data.origin);
  const mask = new LogicalNeuroVol(space, data.maskData);

  // Get indices to iterate over
  let indices: number[];
  if (data.nonzero) {
    indices = [];
    const maskData = mask.getData();
    for (let i = 0; i < maskData.length; i++) {
      if (maskData[i]) {
        indices.push(i);
      }
    }
  } else {
    indices = Array.from({ length: mask.space.size }, (_, i) => i);
  }

  state = {
    mask,
    radius: data.radius,
    nonzero: data.nonzero,
    allIndices: indices
  };

  self.postMessage({ type: 'initialized' });
}

function handleCompute(data: ComputeData) {
  if (!state) {
    throw new Error('Worker not initialized');
  }

  const { indices, startIdx } = data;
  const results: any[] = [];

  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    const centerIdx = state.nonzero ? state.allIndices[idx] : idx;

    // Get grid coordinates of center
    const centerGrid = state.mask.space.indexToGrid(centerIdx);

    // Create spherical ROI around this center
    const roi = sphericalROI(state.mask, centerGrid, state.radius);

    // Create serializable result
    results.push({
      centerIdx,
      coords: roi.coords,
      data: roi.data,
      space: {
        dim: roi.space.dim,
        spacing: roi.space.spacing,
        origin: roi.space.origin
      }
    });
  }

  self.postMessage({
    type: 'result',
    results,
    startIdx,
    progress: (startIdx + indices.length) / state.allIndices.length
  });
}

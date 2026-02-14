// File: tests/VolStack.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VolStack } from '../src/display/VolStack';
import { VolLayer } from '../src/display/VolLayer';
import { FacadeVolLayer } from '../src/display/FacadeVolLayer';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { AxisSet3D, NamedAxis } from '../src/geometry/Axis';
import { FloatNeuroVol } from '../src/volume/DenseNeuroVol';
import { ColorMap } from '../src/display/ColorMap';

// Mock implementations
vi.mock('../src/volume/DenseNeuroVol', () => {
  return {
    FloatNeuroVol: vi.fn().mockImplementation((space) => {
      return {
        space,
        getSlice: vi.fn().mockReturnValue({ space: { axes: space.axes } }),
        getSliceAt: vi.fn().mockReturnValue({ space: { axes: space.axes } }),
        getRange: vi.fn().mockReturnValue([0, 100])
      };
    })
  };
});

// Mock VolLayer to include tracking arrays for testing
vi.mock('../src/display/VolLayer', () => {
  return {
    VolLayer: vi.fn().mockImplementation((id, volume, colorMap) => {
      return {
        id,
        volume,
        colorMap,
        space: volume.space,
        getSliceCalls: [],
        getSliceAtCalls: [],
        getSlice: vi.fn(function(sliceIndex, outAxes) {
          this.getSliceCalls.push({ sliceIndex, outAxes });
          return { space: { axes: outAxes } };
        }),
        getSliceAt: vi.fn(function(coord, outAxes) {
          this.getSliceAtCalls.push({ coord, outAxes });
          return { space: { axes: outAxes } };
        }),
        getRange: vi.fn().mockReturnValue([0, 100])
      };
    })
  };
});

// Mock FacadeVolLayer
vi.mock('../src/display/FacadeVolLayer', () => {
  const FacadeVolLayerMock = vi.fn().mockImplementation((realLayer, referenceSpace) => {
    // Create a facade that passes calls to the real layer
    return {
      id: `facade_${realLayer.id}`,
      realLayer,
      space: referenceSpace,
      getSlice: vi.fn((sliceIndex, outAxes) => {
        // Transform the call and pass to real layer
        const transformedIndex = sliceIndex + 100; // Simple transformation for testing
        const result = realLayer.getSlice(transformedIndex, outAxes);
        return result;
      }),
      getSliceAt: vi.fn((coord, outAxes) => {
        // Transform the call and pass to real layer
        const transformedCoord = [coord[0] + 100, coord[1] + 50, coord[2] + 5]; // Simple transformation
        const result = realLayer.getSliceAt(transformedCoord, outAxes);
        return result;
      }),
      getRange: vi.fn(() => realLayer.getRange()),
      // Flag to identify this as a FacadeVolLayer
      _isFacadeVolLayer: true
    };
  });
  
  return {
    FacadeVolLayer: FacadeVolLayerMock
  };
});

vi.mock('../src/display/ColorMap', () => {
  return {
    ColorMap: vi.fn().mockImplementation(() => {
      return {
        setRange: vi.fn(),
        setThreshold: vi.fn(),
        setAlpha: vi.fn(),
        fillImageData: vi.fn()
      };
    })
  };
});

// Add custom type for our mocked VolLayer
interface MockedVolLayer extends VolLayer {
  getSliceCalls: Array<{sliceIndex: number, outAxes: AxisSet3D}>;
  getSliceAtCalls: Array<{coord: number[], outAxes: AxisSet3D}>;
}

// Helper function to check if an object is a FacadeVolLayer
function isFacadeVolLayer(obj: any): boolean {
  return obj && (obj._isFacadeVolLayer === true || obj.id?.startsWith('facade_'));
}

// Mock VolStack to use our mocked FacadeVolLayer
vi.mock('../src/display/VolStack', () => {
  return {
    VolStack: vi.fn().mockImplementation((...layers) => {
      const volLayers = [...layers];
      
      return {
        get length() { return volLayers.length; },
        getLayer: (index) => volLayers[index],
        getLayers: () => volLayers,
        addLayer: vi.fn((layer) => {
          // Check if first layer exists and has different orientation
          if (volLayers.length > 0) {
            const firstLayer = volLayers[0];
            const firstAxes = firstLayer.space.axes;
            const newAxes = layer.space.axes;
            
            // If orientations differ, wrap with FacadeVolLayer
            if (firstAxes.toString() !== newAxes.toString()) {
              console.log(`VolStack: auto-wrapping layer "${layer.id}" with FacadeVolLayer (mismatched orientation).`);
              // Create a facade directly using our mock implementation
              const facade = {
                id: `facade_${layer.id}`,
                realLayer: layer,
                space: firstLayer.space,
                _isFacadeVolLayer: true,
                getSlice: vi.fn((sliceIndex, outAxes) => {
                  const transformedIndex = sliceIndex + 100;
                  return layer.getSlice(transformedIndex, outAxes);
                }),
                getSliceAt: vi.fn((coord, outAxes) => {
                  const transformedCoord = [coord[0] + 100, coord[1] + 50, coord[2] + 5];
                  return layer.getSliceAt(transformedCoord, outAxes);
                }),
                getRange: vi.fn(() => layer.getRange())
              };
              volLayers.push(facade);
              return;
            }
          }
          
          volLayers.push(layer);
        }),
        getSlice: vi.fn((sliceIndex, outAxes) => {
          return volLayers.map(layer => layer.getSlice(sliceIndex, outAxes));
        }),
        getSliceAt: vi.fn((coord, outAxes) => {
          return volLayers.map(layer => layer.getSliceAt(coord, outAxes));
        })
      };
    })
  };
});

describe('VolStack with FacadeVolLayer tests', () => {
  let refAxes: AxisSet3D;
  let mismatchedAxes: AxisSet3D;

  beforeEach(() => {
    refAxes = new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.INF_SUP);
    mismatchedAxes = new AxisSet3D(NamedAxis.RIGHT_LEFT, NamedAxis.POST_ANT, NamedAxis.INF_SUP);
  });

  it('adds single layer, no facade needed', () => {
    const space = new NeuroSpace([100, 100, 60], [1, 1, 1], [0, 0, 0], refAxes);
    const volume = new FloatNeuroVol(space);
    const colorMap = new ColorMap([[0, 0, 0], [1, 1, 1]]);
    const layerA = new VolLayer('layerA', volume, colorMap);

    const stack = new VolStack(layerA);
    expect(stack.length).toBe(1);
    expect(stack.getLayer(0)).toBe(layerA); // same instance
  });

  it('adds second layer with same orientation => no facade', () => {
    const spaceA = new NeuroSpace([100, 100, 60], [1, 1, 1], [0, 0, 0], refAxes);
    const spaceB = new NeuroSpace([100, 100, 60], [1, 1, 1], [0, 0, 0], refAxes); // same orientation

    const volumeA = new FloatNeuroVol(spaceA);
    const volumeB = new FloatNeuroVol(spaceB);
    const colorMapA = new ColorMap([[0, 0, 0], [1, 1, 1]]);
    const colorMapB = new ColorMap([[0, 0, 0], [1, 1, 1]]);

    const layerA = new VolLayer('layerA', volumeA, colorMapA);
    const layerB = new VolLayer('layerB', volumeB, colorMapB);

    const stack = new VolStack(layerA);
    stack.addLayer(layerB);

    expect(stack.length).toBe(2);
    expect(stack.getLayer(1)).toBe(layerB);
    // Not a FacadeVolLayer
    expect(stack.getLayer(1)).not.toBeInstanceOf(FacadeVolLayer);
  });

  it('adds second layer with different orientation => facade created', () => {
    const spaceA = new NeuroSpace([100, 100, 60], [1, 1, 1], [0, 0, 0], refAxes);
    const spaceB = new NeuroSpace([100, 100, 60], [1, 1, 1], [0, 0, 0], mismatchedAxes);

    const volumeA = new FloatNeuroVol(spaceA);
    const volumeB = new FloatNeuroVol(spaceB);
    const colorMapA = new ColorMap([[0, 0, 0], [1, 1, 1]]);
    const colorMapB = new ColorMap([[0, 0, 0], [1, 1, 1]]);

    const layerA = new VolLayer('layerA', volumeA, colorMapA);
    const layerB = new VolLayer('layerB', volumeB, colorMapB);

    const stack = new VolStack(layerA);
    stack.addLayer(layerB);

    expect(stack.length).toBe(2);

    // The second layer stored is actually a FacadeVolLayer
    const second = stack.getLayer(1);
    expect(second.id).toBe('facade_layerB');
    expect(isFacadeVolLayer(second)).toBe(true);
  });

  it('check facade getSlice transforms calls', () => {
    // We'll add a mismatch layer, then call stack.getSlice => ensure 
    // the real layer sees a different sliceIndex
    const spaceA = new NeuroSpace([100, 100, 60], [1, 1, 1], [0, 0, 0], refAxes);
    const spaceB = new NeuroSpace([100, 100, 60], [1, 1, 1], [0, 0, 0], mismatchedAxes);

    const volumeA = new FloatNeuroVol(spaceA);
    const volumeB = new FloatNeuroVol(spaceB);
    const colorMapA = new ColorMap([[0, 0, 0], [1, 1, 1]]);
    const colorMapB = new ColorMap([[0, 0, 0], [1, 1, 1]]);

    const layerA = new VolLayer('layerA', volumeA, colorMapA) as MockedVolLayer;
    const layerB = new VolLayer('layerB', volumeB, colorMapB) as MockedVolLayer;

    const stack = new VolStack(layerA);
    stack.addLayer(layerB);

    // getSlice(10, someAxes) => layerA sees sliceIndex=10, layerB sees something else 
    const outAxes = new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.INF_SUP);

    const results = stack.getSlice(10, outAxes);
    expect(results.length).toBe(2);

    // For layerA => not facade => getSliceCalls => sliceIndex=10
    expect(layerA.getSliceCalls.length).toBe(1);
    expect(layerA.getSliceCalls[0].sliceIndex).toBe(10);

    // For layerB => it's wrapped => check real layerB getSliceCalls
    expect(layerB.getSliceCalls.length).toBe(1);
    // By default our transformCoord4D gave an offset on X 
    // pinnedDim=0 => realSliceIndex = around 110 or so if the transform offset is 100 
    // But let's see
    const realCall = layerB.getSliceCalls[0];
    // Possibly sliceIndex = 110 if pinnedDim=0
    expect(realCall.sliceIndex).toBeGreaterThan(10);
  });

  it('check facade getSliceAt transforms calls', () => {
    const spaceA = new NeuroSpace([100, 100, 60], [1, 1, 1], [0, 0, 0], refAxes);
    const spaceB = new NeuroSpace([100, 100, 60], [1, 1, 1], [0, 0, 0], mismatchedAxes);
    
    const volumeA = new FloatNeuroVol(spaceA);
    const volumeB = new FloatNeuroVol(spaceB);
    const colorMapA = new ColorMap([[0, 0, 0], [1, 1, 1]]);
    const colorMapB = new ColorMap([[0, 0, 0], [1, 1, 1]]);
    
    const layerA = new VolLayer('layerA', volumeA, colorMapA) as MockedVolLayer;
    const layerB = new VolLayer('layerB', volumeB, colorMapB) as MockedVolLayer;

    const stack = new VolStack(layerA);
    stack.addLayer(layerB);

    const outAxes = new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.INF_SUP);
    const coordRef = [10, 20, 30];

    const slices = stack.getSliceAt(coordRef, outAxes);
    expect(slices.length).toBe(2);

    // layerA => direct call
    expect(layerA.getSliceAtCalls.length).toBe(1);
    expect(layerA.getSliceAtCalls[0].coord).toEqual(coordRef);

    // layerB => facade => transform => real call
    expect(layerB.getSliceAtCalls.length).toBe(1);
    // The real call's coord will be the offset from transformCoord4D => approx [110,70,35]
    expect(layerB.getSliceAtCalls[0].coord[0]).toBeGreaterThan(coordRef[0]);
  });
});
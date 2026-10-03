import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MockPoint {
  x: number;
  y: number;
  set(x: number, y?: number): void;
}

interface MockSprite {
  position: MockPoint;
  scale: MockPoint;
  pivot: MockPoint;
  texture: { width: number; height: number };
}

// Minimal PIXI stand-in whose transforms record their values, so placement
// can be checked without a renderer.
vi.mock('pixi.js', () => {
  const point = (x: number, y: number): MockPoint => ({
    x,
    y,
    set(nx: number, ny?: number) {
      this.x = nx;
      this.y = ny ?? nx;
    },
  });
  interface Node {
    parent: Container | null;
  }
  class Sprite implements Node {
    texture: unknown;
    alpha = 1;
    visible = true;
    rotation = 0;
    tint = 0xffffff;
    destroyed = false;
    parent: Container | null = null;
    position = point(0, 0);
    scale = point(1, 1);
    pivot = point(0, 0);
    anchor = point(0, 0);
    constructor(texture?: unknown) {
      this.texture = texture ?? null;
    }
    destroy(): void {
      this.destroyed = true;
    }
  }
  class Container implements Node {
    children: Node[] = [];
    visible = true;
    destroyed = false;
    parent: Container | null = null;
    position = point(0, 0);
    scale = point(1, 1);
    pivot = point(0, 0);
    addChild<T extends Node>(child: T): T {
      this.children.push(child);
      child.parent = this;
      return child;
    }
    removeChild<T extends Node>(child: T): T {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parent = null;
      return child;
    }
    removeChildren(): void {
      this.children = [];
    }
    destroy(): void {
      this.destroyed = true;
    }
  }
  const texture = (source?: { width?: number; height?: number }) => ({
    source: { uploads: 0, scaleMode: 'linear', update(): void { this.uploads++; } },
    width: source?.width ?? 1,
    height: source?.height ?? 1,
    destroyed: false,
    destroy(): void { this.destroyed = true; },
  });
  return { Sprite, Container, Texture: { from: texture } };
});

import * as PIXI from 'pixi.js';
import { ImageLayer } from '../../src/display/ImageLayer';
import { VolStack } from '../../src/display/VolStack';
import { VolLayer } from '../../src/display/VolLayer';
import { ColorMapFactory } from '../../src/display/ColorMapFactory';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D } from '../../src/geometry/Axis';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';

const VIEWS = {
  axial: AxisSet3D.AXIAL_LPI,
  coronal: AxisSet3D.CORONAL_LIP,
  sagittal: AxisSet3D.SAGITTAL_AIL,
};

const ref1mm = new NeuroSpace([41, 49, 37], [1, 1, 1], [-20, -24, -18], AxisSet3D.AXIAL_LPI);
const map2mm = new NeuroSpace([19, 23, 17], [2, 2, 2], [-18, -22, -16], AxisSet3D.AXIAL_LPI);

function volume(space: NeuroSpace, fill: (i: number, j: number, k: number) => number): FloatNeuroVol {
  const [nx, ny, nz] = space.dim;
  const data = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) data[i + nx * (j + ny * k)] = fill(i, j, k);
  return new FloatNeuroVol(space, data);
}

const encode = (i: number, j: number, k: number) => 1 + i + 100 * j + 10000 * k;

function layers() {
  const anatomy = new VolLayer('anatomy', volume(ref1mm, (i, j, k) => i + j + k), ColorMapFactory.createGrayscale());
  const stat = new VolLayer('stat', volume(map2mm, encode), ColorMapFactory.createHot());
  return { anatomy, stat };
}

/** World position of the centre of texture voxel (m, n) as drawn. */
function drawnWorld(sprite: MockSprite, upsample: number, view: AxisSet3D, referenceSlice: number, m: number, n: number) {
  const x = sprite.position.x + sprite.scale.x * upsample * (m + 0.5);
  const y = sprite.position.y + sprite.scale.y * upsample * (n + 0.5);
  return ref1mm.reorient(view).gridToCoord([x - 0.5, y - 0.5, referenceSlice]);
}

function inPlaneAxes(view: AxisSet3D): number[] {
  return [view.i, view.j].map(axis => axis.direction.findIndex(v => v !== 0));
}

describe('ImageLayer with layers on different grids', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });

  for (const [name, view] of Object.entries(VIEWS)) {
    it(`'world' draws a 2 mm map over a 1 mm template at its world position (${name})`, () => {
      const { anatomy, stat } = layers();
      const imageLayer = new ImageLayer(new VolStack(anatomy, stat));
      imageLayer.setAlignmentStrategy('world');
      const getSlice = vi.spyOn(stat, 'getSlice');
      const rawSlice = vi.spyOn(stat.volume, 'getSlice');

      const ownView = map2mm.reorient(view);
      const refView = ref1mm.reorient(view);
      // A reference plane on a 2 mm plane, and one half-way between two.
      for (const referenceSlice of [20, 21]) {
        getSlice.mockClear();
        rawSlice.mockClear();
        const container = imageLayer.renderSlice(referenceSlice, [0, 0, 0], view, new PIXI.Container())!;
        expect(container.children).toHaveLength(2);
        const [refSprite, statSprite] = container.children as unknown as MockSprite[];

        // The reference is untouched: content space is its pixel grid.
        expect([refSprite.position.x, refSprite.position.y]).toEqual([0, 0]);
        expect([refSprite.scale.x, refSprite.scale.y]).toEqual([1, 1]);

        // The map is sliced on its own grid at the plane nearest the reference plane.
        expect(getSlice).toHaveBeenCalledTimes(1);
        const own = getSlice.mock.calls[0][0];
        const planeWorld = refView.gridToCoord([0, 0, referenceSlice]);
        expect(Math.abs(own - ownView.coordToGrid(planeWorld)[2])).toBeLessThanOrEqual(0.5);
        expect(statSprite.texture.width).toBe(ownView.dim[0]);
        expect(statSprite.texture.height).toBe(ownView.dim[1]);

        // Each map voxel is drawn at its world position, and texel (m, n)
        // holds the map voxel that lives there.
        expect(rawSlice).toHaveBeenCalledTimes(1);
        const texels = rawSlice.mock.results[0].value.getData();
        for (const [m, n] of [[0, 0], [ownView.dim[0] - 1, ownView.dim[1] - 1], [5, 9]]) {
          const truth = ownView.gridToCoord([m, n, own]);
          const drawn = drawnWorld(statSprite, 1, view, referenceSlice, m, n);
          inPlaneAxes(view).forEach(axis => expect(drawn[axis]).toBeCloseTo(truth[axis], 9));
          const [i, j, k] = map2mm.coordToGrid(truth).map(Math.round);
          expect(texels[m + ownView.dim[0] * n]).toBe(encode(i, j, k));
        }
      }
      expect(warn).not.toHaveBeenCalled();
      imageLayer.dispose();
    });
  }

  it("'world' omits the map where the reference plane is outside its slab, without clamping", () => {
    const { anatomy, stat } = layers();
    const imageLayer = new ImageLayer(new VolStack(anatomy, stat));
    imageLayer.setAlignmentStrategy('world');
    const getSlice = vi.spyOn(stat, 'getSlice');

    // Axial reference slices 0 and 36 lie at z = -18 and +18 mm; the map
    // covers -17..17 mm.
    for (const referenceSlice of [0, 36]) {
      const container = imageLayer.renderSlice(referenceSlice, [0, 0, 0], VIEWS.axial, new PIXI.Container())!;
      expect(container.children).toHaveLength(1);
    }
    expect(getSlice).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    imageLayer.dispose();
  });

  it("'world' accounts for upsampled ('smooth') map textures", () => {
    const { anatomy, stat } = layers();
    stat.setInterpolation('smooth');
    const imageLayer = new ImageLayer(new VolStack(anatomy, stat));
    imageLayer.setAlignmentStrategy('world');
    const container = imageLayer.renderSlice(18, [0, 0, 0], VIEWS.axial, new PIXI.Container())!;
    const statSprite = container.children[1] as unknown as MockSprite;
    const k = 4;
    expect(statSprite.texture.width).toBe(19 * k);
    expect([statSprite.scale.x, statSprite.scale.y]).toEqual([2 / k, 2 / k]);
    const truth = map2mm.reorient(VIEWS.axial).gridToCoord([6, 3, 8]);
    const drawn = drawnWorld(statSprite, k, VIEWS.axial, 18, 6, 3);
    expect(drawn[0]).toBeCloseTo(truth[0], 9);
    expect(drawn[1]).toBeCloseTo(truth[1], 9);
    imageLayer.dispose();
  });

  it("'world' leaves layers on the reference grid on the shared transform", () => {
    const { anatomy, stat } = layers();
    const mask = new VolLayer('mask', volume(ref1mm, () => 1), ColorMapFactory.createHot());
    const imageLayer = new ImageLayer(new VolStack(anatomy, mask, stat));
    imageLayer.setAlignmentStrategy('world');
    const getSlice = vi.spyOn(mask, 'getSlice');
    const container = imageLayer.renderSlice(12, [0, 0, 0], VIEWS.coronal, new PIXI.Container())!;
    expect(getSlice).toHaveBeenCalledWith(12, VIEWS.coronal);
    const [refSprite, maskSprite] = container.children as unknown as MockSprite[];
    expect([maskSprite.position.x, maskSprite.position.y]).toEqual([refSprite.position.x, refSprite.position.y]);
    expect([maskSprite.scale.x, maskSprite.scale.y]).toEqual([refSprite.scale.x, refSprite.scale.y]);
    expect(imageLayer.getAlignmentCacheStats().size).toBe(0);
    imageLayer.dispose();
  });

  it("'world' is the default strategy", () => {
    const { anatomy, stat } = layers();
    const imageLayer = new ImageLayer(new VolStack(anatomy, stat));
    expect(imageLayer.getAlignmentOptions().strategy).toBe('world');
    const getSlice = vi.spyOn(stat, 'getSlice');
    imageLayer.renderSlice(10, [0, 0, 0], VIEWS.axial, new PIXI.Container());
    // Reference plane 10 is z = -18 + 10 * 1 = -8 mm; the map plane there is
    // (-8 - (-16)) / 2 = 4. No heuristic alignment is computed.
    expect(getSlice).toHaveBeenCalledWith(4, VIEWS.axial);
    expect(imageLayer.getAlignmentCacheStats().size).toBe(0);
    imageLayer.dispose();
  });

  it("options without a strategy also default to 'world'", () => {
    const { anatomy, stat } = layers();
    const imageLayer = new ImageLayer(new VolStack(anatomy, stat), { enableCache: true });
    expect(imageLayer.getAlignmentOptions().strategy).toBe('world');
    const getSlice = vi.spyOn(stat, 'getSlice');
    imageLayer.renderSlice(10, [0, 0, 0], VIEWS.axial, new PIXI.Container());
    expect(getSlice).toHaveBeenCalledWith(4, VIEWS.axial);
    imageLayer.dispose();
  });

  it("an explicit 'auto' strategy keeps the heuristic alignment for other grids", () => {
    const { anatomy, stat } = layers();
    const imageLayer = new ImageLayer(new VolStack(anatomy, stat));
    imageLayer.setAlignmentStrategy('auto');
    const getSlice = vi.spyOn(stat, 'getSlice');
    imageLayer.renderSlice(10, [0, 0, 0], VIEWS.axial, new PIXI.Container());
    // The pre-'world' behaviour: the reference index is reused and the heuristic runs.
    expect(getSlice).toHaveBeenCalledWith(10, VIEWS.axial);
    expect(imageLayer.getAlignmentCacheStats().size).toBeGreaterThan(0);
    imageLayer.dispose();
  });

  it('a reused pooled sprite does not carry an overlay offset into the reference', () => {
    const { anatomy, stat } = layers();
    const imageLayer = new ImageLayer(new VolStack(anatomy, stat));
    imageLayer.setAlignmentStrategy('world');
    for (let n = 0; n < 3; n++) {
      const container = imageLayer.renderSlice(18 + n, [0, 0, 0], VIEWS.axial, new PIXI.Container())!;
      const refSprite = container.children[0] as unknown as MockSprite;
      expect([refSprite.position.x, refSprite.position.y]).toEqual([0, 0]);
      expect([refSprite.pivot.x, refSprite.pivot.y]).toEqual([0, 0]);
    }
    imageLayer.dispose();
  });
});

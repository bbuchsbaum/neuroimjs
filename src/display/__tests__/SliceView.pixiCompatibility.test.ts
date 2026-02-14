import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock CoordinateTransformer to avoid heavy deps
vi.mock('../CoordinateTransformer', () => ({
  CoordinateTransformer: class {
    setSliceIndex(_: number) {}
  },
}));

// Helper to make a minimal DOM container
function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  el.style.width = '320px';
  el.style.height = '240px';
  document.body.appendChild(el);
  return el;
}

// Minimal image layer stub used by SliceView
function makeImageLayerStub() {
  return {
    neuroSpace: {} as any,
    setPosition: vi.fn(),
    renderSlice: vi.fn(() => null),
    getVolStack: () => ({ layers: [], getLayerIds: () => [] }),
  } as any;
}

const makeModelStub = () => ({
  currentCoord: [0, 0, 0],
  currentSliceIndex: 0,
  totalSlices: 1,
}) as any;

describe('SliceView PIXI compatibility', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    // cleanup DOM if needed
    document.body.innerHTML = '';
  });

  it('initializes with PIXI v8 style (instance.init) and exposes canvas', async () => {
    // Mock pixi.js v8-like API
    vi.doMock('pixi.js', () => {
      class Container {
        children: any[] = [];
        pivot = { set: vi.fn() };
        position = { set: vi.fn() };
        scale = { x: 0, y: 0 } as any;
        addChild = vi.fn();
        removeChildren = vi.fn();
        getLocalBounds = vi.fn(() => ({ x: 0, y: 0, width: 100, height: 100 }));
        on = vi.fn();
        off = vi.fn();
        destroy = vi.fn();
      }
      class Application {
        renderer: any;
        stage: any;
        canvas: HTMLCanvasElement | undefined;
        constructor(_: any = undefined) {
          this.stage = new Container();
        }
        async init(options: any) {
          this.renderer = { width: options.width ?? 800, height: options.height ?? 600, resize: vi.fn() };
          this.canvas = document.createElement('canvas');
          return this;
        }
        destroy() {}
      }
      return { Application, Container };
    });

    const { SliceView } = await import('../SliceView');

    const domEl = makeContainer();
    const imageLayer = makeImageLayerStub();
    const model = makeModelStub();

    const view = await SliceView.create(domEl, imageLayer, {} as any, {} as any, model, { showCrosshair: false });
    const canvas = view.getCanvas();
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
  });

  it('initializes with PIXI v7 style (constructor options) and exposes view canvas', async () => {
    // Mock pixi.js v7-like API
    vi.doMock('pixi.js', () => {
      class Container {
        children: any[] = [];
        pivot = { set: vi.fn() };
        position = { set: vi.fn() };
        scale = { x: 0, y: 0 } as any;
        addChild = vi.fn();
        removeChildren = vi.fn();
        getLocalBounds = vi.fn(() => ({ x: 0, y: 0, width: 100, height: 100 }));
        on = vi.fn();
        off = vi.fn();
        destroy = vi.fn();
      }
      class Application {
        renderer: any;
        stage: any;
        view: HTMLCanvasElement;
        constructor(options: any) {
          this.stage = new Container();
          this.renderer = { width: options.width ?? 800, height: options.height ?? 600, resize: vi.fn() };
          this.view = document.createElement('canvas');
        }
        destroy() {}
      }
      return { Application, Container };
    });

    const { SliceView } = await import('../SliceView');

    const domEl = makeContainer();
    const imageLayer = makeImageLayerStub();
    const model = makeModelStub();

    const view = await SliceView.create(domEl, imageLayer, {} as any, {} as any, model, { showCrosshair: false });
    const canvas = view.getCanvas();
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
  });
});

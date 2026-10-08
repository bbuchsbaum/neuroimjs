import { describe, test, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { setupConsoleMocks } from './test-console-mock';
import { createPixiMock } from '../mocks/pixi.mock';

vi.mock('pixi.js', () => createPixiMock());

import { SliceView } from '../../src/display/SliceView';
import { SliceModel } from '../../src/display/SliceModel';
import { ImageLayer } from '../../src/display/ImageLayer';
import { VolStack } from '../../src/display/VolStack';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D, NamedAxis } from '../../src/geometry/Axis';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { VolLayer } from '../../src/display/VolLayer';
import { ColorMap } from '../../src/display/ColorMap';
import { OrthogonalImageViewer } from '../../src/display/OrthogonalImageViewer';

/**
 * A manual animation-frame queue so the test decides when frames run.
 */
function installFrameQueue() {
  let nextId = 1;
  const queue = new Map<number, FrameRequestCallback>();
  const raf = vi.fn((cb: FrameRequestCallback) => {
    const id = nextId++;
    queue.set(id, cb);
    return id;
  });
  const caf = vi.fn((id: number) => {
    queue.delete(id);
  });
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', caf);
  return {
    raf,
    caf,
    pending: () => queue.size,
    /** Run every frame queued so far (frames they schedule run on the next flush). */
    flush() {
      const batch = [...queue.entries()];
      queue.clear();
      batch.forEach(([, cb]) => cb(performance.now()));
    },
  };
}

function makeStack(): { space: NeuroSpace; stack: VolStack } {
  const space = new NeuroSpace(
    [16, 16, 16],
    [2, 2, 2],
    [0, 0, 0],
    new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.INF_SUP)
  );
  const data = new Float32Array(16 * 16 * 16).map((_, i) => i % 100);
  const vol = new FloatNeuroVol(space, data);
  const layer = new VolLayer('anat', vol, new ColorMap([[0, 0, 0], [1, 1, 1]]), [0, 100]);
  return { space, stack: new VolStack(layer) };
}

interface RendererLike {
  render: (...args: unknown[]) => void;
  resize: (width: number, height: number) => void;
}
interface AppLike {
  renderer: RendererLike | null;
  destroy: (...args: unknown[]) => void;
}

const appOf = (view: SliceView): AppLike => view.app as unknown as AppLike;
const rendererOf = (view: SliceView): RendererLike => appOf(view).renderer as RendererLike;

// PIXI 8 leaves `renderer` null after Application.destroy(); emulate that so a
// late resize would throw exactly as it does in the browser.
function emulatePixiDestroy(view: SliceView): void {
  const app = appOf(view);
  const original = app.destroy.bind(app);
  app.destroy = (...args: unknown[]) => {
    original(...args);
    app.renderer = null;
  };
}

describe('SliceView resize after dispose', () => {
  let container: HTMLElement;
  let frames: ReturnType<typeof installFrameQueue>;

  beforeAll(() => {
    setupConsoleMocks();
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    frames = installFrameQueue();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    container.remove();
  });

  async function makeView(): Promise<SliceView> {
    const { space, stack } = makeStack();
    const imageLayer = new ImageLayer(stack);
    imageLayer.initialize();
    const axes = AxisSet3D.AXIAL_LPI;
    const model = new SliceModel(16, space.gridToCoord([8, 8, 8]), space, axes);
    return SliceView.create(container, imageLayer, space, axes, model);
  }

  test('frames scheduled by handleResize do not run after dispose', async () => {
    const view = await makeView();
    emulatePixiDestroy(view);
    const renderer = rendererOf(view);
    const render = vi.fn();
    const resize = vi.spyOn(renderer, 'resize');
    renderer.render = render;

    view.handleResize();
    expect(frames.pending()).toBe(1);
    view.dispose();

    // dispose() cancels the outstanding frame...
    expect(frames.caf).toHaveBeenCalled();
    expect(frames.pending()).toBe(0);
    // ...and nothing touches the destroyed renderer if one slips through.
    expect(() => {
      frames.flush();
      frames.flush();
    }).not.toThrow();
    expect(render).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();
    expect(view.isDisposed).toBe(true);
  });

  test('mounting keeps caller host styles and contains canvas and slider in its own wrapper', async () => {
    container.style.height = '300px';
    container.style.position = 'static';
    const { space, stack } = makeStack();
    const imageLayer = new ImageLayer(stack);
    imageLayer.initialize();
    const axes = AxisSet3D.AXIAL_LPI;
    const model = new SliceModel(16, space.gridToCoord([8, 8, 8]), space, axes);
    const view = await SliceView.create(container, imageLayer, space, axes, model, { showSlider: true });
    expect(container.style.height).toBe('300px');
    expect(container.style.position).toBe('static');
    expect(container.style.width).toBe('');
    expect(container.firstElementChild?.contains(container.querySelector('canvas'))).toBe(true);
    expect(container.firstElementChild?.contains(view.slider)).toBe(true);
    view.dispose();
    expect(container.children).toHaveLength(0);
  });

  test('dispose does not release PIXI global resources shared with other views', async () => {
    // Application.destroy(true) sets releaseGlobalResources, which clears the
    // page-wide TexturePool; another live view then throws when it returns a
    // text texture to the emptied pool.
    const view = await makeView();
    const destroy = vi.spyOn(appOf(view), 'destroy');
    view.dispose();

    expect(destroy).toHaveBeenCalledTimes(1);
    const [rendererOptions] = destroy.mock.calls[0];
    expect(rendererOptions).not.toBe(true);
    expect(rendererOptions).not.toEqual(expect.objectContaining({ releaseGlobalResources: true }));
  });

  test('dispose between the two frames cancels the inner frame', async () => {
    const view = await makeView();
    emulatePixiDestroy(view);
    const renderer = rendererOf(view);
    const render = vi.fn();
    renderer.render = render;

    view.handleResize();
    frames.flush(); // outer frame runs and schedules the inner one
    expect(frames.pending()).toBe(1);

    view.dispose();
    expect(frames.pending()).toBe(0);
    expect(() => frames.flush()).not.toThrow();
    expect(render).not.toHaveBeenCalled();
  });

  test('a frame callback that already escaped cancellation is a no-op', async () => {
    const view = await makeView();
    emulatePixiDestroy(view);
    // Capture callbacks directly, bypassing the queue's cancellation, to model
    // a host whose cancelAnimationFrame is unavailable or ineffective.
    const escaped: FrameRequestCallback[] = [];
    frames.raf.mockImplementation((cb: FrameRequestCallback) => {
      escaped.push(cb);
      return escaped.length;
    });
    view.handleResize();
    view.dispose();
    expect(() => escaped.splice(0).forEach(cb => cb(0))).not.toThrow();
    expect(escaped).toHaveLength(0);
  });

  test('handleResize after dispose schedules nothing', async () => {
    const view = await makeView();
    view.dispose();
    frames.raf.mockClear();
    view.handleResize();
    expect(frames.raf).not.toHaveBeenCalled();
  });

  test('handleResize still re-fits a live view', async () => {
    const view = await makeView();
    const renderer = rendererOf(view);
    const render = vi.fn();
    renderer.render = render;
    view.handleResize();
    frames.flush();
    frames.flush();
    expect(render).toHaveBeenCalled();
    view.dispose();
  });
});

describe('OrthogonalImageViewer resize after dispose', () => {
  let container: HTMLElement;
  let frames: ReturnType<typeof installFrameQueue>;

  beforeAll(() => {
    setupConsoleMocks();
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    frames = installFrameQueue();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    container.remove();
  });

  test('a window resize followed by dispose leaves no frames touching freed views', async () => {
    const { stack } = makeStack();
    const created = OrthogonalImageViewer.create({ container, imageLayer: new ImageLayer(stack) });
    // create() awaits one frame for the initial layout pass.
    await vi.waitFor(() => expect(frames.pending()).toBeGreaterThan(0));
    frames.flush();
    const viewer = await created;
    frames.flush();
    frames.flush();

    const views = (['axial', 'coronal', 'sagittal'] as const).map(v => viewer.getSliceViewer(v).view);
    const renders = views.map(view => {
      emulatePixiDestroy(view);
      const fn = vi.fn();
      rendererOf(view).render = fn;
      return fn;
    });

    window.dispatchEvent(new Event('resize'));
    expect(frames.pending()).toBeGreaterThan(0);
    viewer.dispose();
    expect(frames.pending()).toBe(0);
    expect(() => {
      frames.flush();
      frames.flush();
    }).not.toThrow();
    renders.forEach(fn => expect(fn).not.toHaveBeenCalled());

    // Late resize notifications after dispose are ignored, and dispose is idempotent.
    window.dispatchEvent(new Event('resize'));
    expect(frames.pending()).toBe(0);
    expect(() => viewer.dispose()).not.toThrow();
  });
});

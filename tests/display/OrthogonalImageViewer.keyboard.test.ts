import { describe, test, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { setupConsoleMocks } from './test-console-mock';
import { createPixiMock } from '../mocks/pixi.mock';

vi.mock('pixi.js', () => createPixiMock());

import { OrthogonalImageViewer, ViewName } from '../../src/display/OrthogonalImageViewer';
import { ImageLayer } from '../../src/display/ImageLayer';
import { VolStack } from '../../src/display/VolStack';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { AxisSet3D, NamedAxis } from '../../src/geometry/Axis';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { VolLayer } from '../../src/display/VolLayer';
import { ColorMap } from '../../src/display/ColorMap';

function makeImageLayer(): ImageLayer {
  const space = new NeuroSpace(
    [20, 20, 20],
    [1, 1, 1],
    [0, 0, 0],
    new AxisSet3D(NamedAxis.LEFT_RIGHT, NamedAxis.POST_ANT, NamedAxis.INF_SUP)
  );
  const vol = new FloatNeuroVol(space, new Float32Array(20 * 20 * 20).fill(1));
  const layer = new VolLayer('anat', vol, new ColorMap([[0, 0, 0], [1, 1, 1]]), [0, 1]);
  return new ImageLayer(new VolStack(layer));
}

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe('OrthogonalImageViewer arrow-key navigation', () => {
  let container: HTMLElement;
  let outside: HTMLElement;
  let viewer: OrthogonalImageViewer;

  const index = (view: 'axial' | 'coronal' | 'sagittal') =>
    viewer.getSliceViewer(view).currentSliceIndex;
  const pane = (view: string) =>
    container.querySelector(`[data-nij-view="${view}"]`) as HTMLElement;

  beforeAll(() => {
    setupConsoleMocks();
  });

  beforeEach(async () => {
    container = document.createElement('div');
    outside = document.createElement('div');
    document.body.append(container, outside);
    viewer = await OrthogonalImageViewer.create({
      container,
      imageLayer: makeImageLayer(),
      options: { showSlider: true },
    });
    // Hover the axial pane: it becomes the keyboard target.
    pane(ViewName.Axial).dispatchEvent(new MouseEvent('mouseenter'));
    (document.activeElement as HTMLElement | null)?.blur?.();
  });

  afterEach(() => {
    viewer?.dispose();
    container.remove();
    outside.remove();
  });

  test('with focus on the page, arrows step the hovered view and are consumed', () => {
    const start = index('axial');
    const right = press(document.body, 'ArrowRight');
    expect(right.defaultPrevented).toBe(true);
    expect(index('axial')).toBe(start + 1);

    const left = press(document.body, 'ArrowLeft');
    expect(left.defaultPrevented).toBe(true);
    expect(index('axial')).toBe(start);
  });

  test('with focus inside a slice pane, arrows step the view', () => {
    const start = index('axial');
    pane(ViewName.Axial).focus();
    expect(document.activeElement).toBe(pane(ViewName.Axial));
    const event = press(pane(ViewName.Axial), 'ArrowRight');
    expect(event.defaultPrevented).toBe(true);
    expect(index('axial')).toBe(start + 1);
  });

  test('a focused pane is stepped when no view is hovered', () => {
    viewer.setFocusedView(null);
    const start = index('coronal');
    pane(ViewName.Coronal).focus();
    press(pane(ViewName.Coronal), 'ArrowRight');
    expect(index('coronal')).toBe(start + 1);
  });

  test('with nothing hovered and focus on the page, nothing happens', () => {
    viewer.setFocusedView(null);
    const before = [index('axial'), index('coronal'), index('sagittal')];
    const event = press(document.body, 'ArrowRight');
    expect(event.defaultPrevented).toBe(false);
    expect([index('axial'), index('coronal'), index('sagittal')]).toEqual(before);
  });

  const controls: Array<[string, () => HTMLElement]> = [
    ['a range slider', () => Object.assign(document.createElement('input'), { type: 'range' })],
    ['a text field', () => Object.assign(document.createElement('input'), { type: 'text' })],
    ['a textarea', () => document.createElement('textarea')],
    ['a select', () => document.createElement('select')],
    ['a button', () => document.createElement('button')],
    ['a contenteditable region', () => {
      const el = document.createElement('div');
      el.setAttribute('contenteditable', 'true');
      el.tabIndex = 0;
      return el;
    }],
    ['an ARIA slider', () => {
      const el = document.createElement('div');
      el.setAttribute('role', 'slider');
      el.tabIndex = 0;
      return el;
    }],
    ['a plain focusable element', () => {
      const el = document.createElement('div');
      el.tabIndex = 0;
      return el;
    }],
  ];

  test.each(controls)('keys typed into %s elsewhere on the page are left alone', (_label, make) => {
    const control = make();
    outside.appendChild(control);
    control.focus();
    expect(document.activeElement).toBe(control);
    const start = index('axial');

    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowRight']) {
      const event = press(control, key);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(index('axial')).toBe(start);
  });

  test('a control inside a shadow root is recognised through the composed path', () => {
    const host = document.createElement('div');
    outside.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    input.type = 'range';
    root.appendChild(input);
    input.focus();
    const start = index('axial');
    const event = press(input, 'ArrowRight');
    expect(event.defaultPrevented).toBe(false);
    expect(index('axial')).toBe(start);
  });

  test("a pane's own slice slider keeps its native arrow behaviour", () => {
    const slider = pane(ViewName.Axial).querySelector('input.slice-slider') as HTMLInputElement;
    expect(slider).not.toBeNull();
    slider.focus();
    const start = index('axial');
    const event = press(slider, 'ArrowRight');
    expect(event.defaultPrevented).toBe(false);
    expect(index('axial')).toBe(start);
  });

  test('modified arrows and already-handled events are ignored', () => {
    const start = index('axial');
    for (const mod of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      expect(press(document.body, 'ArrowRight', mod).defaultPrevented).toBe(false);
    }
    const handled = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    handled.preventDefault();
    document.body.dispatchEvent(handled);
    expect(index('axial')).toBe(start);
  });

  test('other keys are never cancelled', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'a', 'Tab', ' ']) {
      expect(press(document.body, key).defaultPrevented).toBe(false);
    }
  });

  test('after dispose the document listener is gone', () => {
    viewer.dispose();
    const event = press(document.body, 'ArrowRight');
    expect(event.defaultPrevented).toBe(false);
  });
});

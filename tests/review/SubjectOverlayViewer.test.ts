import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupConsoleMocks } from '../display/test-console-mock';
import { AxisSet3D } from '../../src/geometry/Axis';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import {
  createReviewVecFromVolumes,
  OverlaySummaryService,
} from '../../src';
import { SubjectOverlayViewer } from '../../src/review/SubjectOverlayViewer';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';

describe('SubjectOverlayViewer', () => {
  let container: HTMLElement;
  const space = new NeuroSpace([4, 4, 4], [1, 1, 1], [0, 0, 0], AxisSet3D.AXIAL_LPI);

  beforeAll(() => {
    setupConsoleMocks();
  });

  beforeEach(() => {
    container = document.createElement('div');
    container.style.width = '400px';
    container.style.height = '400px';
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function vol(fill: number): FloatNeuroVol {
    return new FloatNeuroVol(space, new Float32Array(space.size).fill(fill));
  }

  it('creates template and active subject layers with a fixed display range', async () => {
    const viewer = await SubjectOverlayViewer.create(container, {
      template: vol(100),
      contrasts: [{
        id: 'faces',
        vec: createReviewVecFromVolumes([vol(1), vol(20)]),
        displayRange: [-6, 6],
      }],
    }, {
      layout: 'left-tall',
      showCrosshair: false,
      showSlider: false,
    });

    const state = viewer.getState();
    expect(state.subjectIndex).toBe(0);
    expect(state.contrastId).toBe('faces');
    expect(state.displayRange).toEqual([-6, 6]);
    expect(state.layers.map((layer) => layer.id)).toEqual(['template', 'active-subject']);
    expect(state.layers.find((layer) => layer.id === 'active-subject')?.range).toEqual([-6, 6]);

    viewer.dispose();
  });

  it('swaps subjects without changing the active overlay range', async () => {
    const viewer = await SubjectOverlayViewer.create(container, {
      template: vol(100),
      contrasts: [{
        id: 'faces',
        vec: createReviewVecFromVolumes([vol(1), vol(20)]),
        displayRange: [-6, 6],
      }],
    }, {
      showCrosshair: false,
      showSlider: false,
    });

    viewer.setSubjectIndex(1);

    expect(viewer.getState().subjectIndex).toBe(1);
    expect(viewer.getCurrentSubjectVolume().getRange()).toEqual([20, 20]);
    expect(viewer.getState().layers.find((layer) => layer.id === 'active-subject')?.range).toEqual([-6, 6]);

    viewer.dispose();
  });

  it('switches contrasts and applies the new contrast fixed range', async () => {
    const viewer = await SubjectOverlayViewer.create(container, {
      template: vol(100),
      contrasts: [
        {
          id: 'faces',
          vec: createReviewVecFromVolumes([vol(1), vol(2)]),
          displayRange: [-6, 6],
        },
        {
          id: 'places',
          vec: createReviewVecFromVolumes([vol(10), vol(20)]),
          displayRange: [-12, 12],
        },
      ],
    }, {
      showCrosshair: false,
      showSlider: false,
    });

    viewer.setContrast('places', 1);

    expect(viewer.getState().contrastId).toBe('places');
    expect(viewer.getState().subjectIndex).toBe(1);
    expect(viewer.getCurrentSubjectVolume().getRange()).toEqual([20, 20]);
    expect(viewer.getState().layers.find((layer) => layer.id === 'active-subject')?.range).toEqual([-12, 12]);

    viewer.dispose();
  });

  it('updates subject threshold through symmetric cutoff helper', async () => {
    const viewer = await SubjectOverlayViewer.create(container, {
      template: vol(100),
      contrasts: [{
        id: 'faces',
        vec: createReviewVecFromVolumes([vol(1), vol(2)]),
        displayRange: [-6, 6],
      }],
    }, {
      showCrosshair: false,
      showSlider: false,
    });

    viewer.setSymmetricThreshold(3);

    expect(viewer.getState().layers.find((layer) => layer.id === 'active-subject')?.threshold).toEqual([-3, 3]);

    viewer.dispose();
  });

  it('adds and clears a summary layer', async () => {
    const vec = createReviewVecFromVolumes([vol(1), vol(2), vol(3)]);
    const viewer = await SubjectOverlayViewer.create(container, {
      template: vol(100),
      contrasts: [{ id: 'faces', vec, displayRange: [-6, 6] }],
    }, {
      showCrosshair: false,
      showSlider: false,
    });

    const summary = new OverlaySummaryService(vec).mean();
    viewer.setSummaryVolume(summary, { range: [0, 3], alpha: 0.5 });

    expect(viewer.getState().layers.map((layer) => layer.id)).toEqual(['template', 'active-subject', 'summary']);
    expect(viewer.getState().layers.find((layer) => layer.id === 'summary')?.range).toEqual([0, 3]);

    viewer.clearSummaryVolume();

    expect(viewer.getState().layers.map((layer) => layer.id)).toEqual(['template', 'active-subject']);

    viewer.dispose();
  });

  it('can place subject or summary overlay on top', async () => {
    const vec = createReviewVecFromVolumes([vol(1), vol(2), vol(3)]);
    const viewer = await SubjectOverlayViewer.create(container, {
      template: vol(100),
      contrasts: [{ id: 'faces', vec, displayRange: [-6, 6] }],
    }, {
      showCrosshair: false,
      showSlider: false,
    });

    viewer.setSummaryVolume(new OverlaySummaryService(vec).mean(), { range: [0, 3] });

    expect(viewer.getState().layers.map((layer) => layer.id)).toEqual(['template', 'active-subject', 'summary']);

    viewer.setOverlayOrder('subject-over-summary');
    expect(viewer.getState().layers.map((layer) => layer.id)).toEqual(['template', 'summary', 'active-subject']);

    viewer.setOverlayOrder('summary-over-subject');
    expect(viewer.getState().layers.map((layer) => layer.id)).toEqual(['template', 'active-subject', 'summary']);

    viewer.dispose();
  });
});

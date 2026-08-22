import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OverlayReviewPanel,
  OverlayReviewPanelViewer,
  overlayCutoffHint,
  sampleOverlayReadout,
} from '../../src/controls/OverlayReviewPanelLit';
import { OverlayReviewSession } from '../../src/review/OverlayReviewDataset';
import {
  OverlaySummaryService,
  computeSufficientStats,
  consistencyVolume,
  meanVolume,
} from '../../src/review/OverlaySummaryService';
import { createReviewVecFromVolumes } from '../../src/review';
import { NeuroSpace } from '../../src/geometry/NeuroSpace';
import { FloatNeuroVol } from '../../src/volume/DenseNeuroVol';
import { NeuroVol } from '../../src/volume/NeuroVol';
import { Range, Threshold } from '../../src/types';
import { OverlayReviewLayerOrder, SummaryLayerOptions } from '../../src/review/SubjectOverlayViewer';

class FakeReviewViewer implements OverlayReviewPanelViewer {
  readonly session: OverlayReviewSession;
  readonly setSubjectIndexCalls: number[] = [];
  readonly setContrastCalls: Array<{ id: string; subjectIndex?: number }> = [];
  readonly symmetricCutoffCalls: number[] = [];
  readonly summaryThresholdCalls: Threshold[] = [];
  readonly summaryVolumeCalls: Array<{ volume: NeuroVol; options?: SummaryLayerOptions }> = [];
  readonly clearSummaryCalls: number[] = [];
  readonly overlayOrderCalls: OverlayReviewLayerOrder[] = [];

  private summaryLayer?: {
    range: Range;
    threshold: Threshold;
    alpha: number;
    visible: boolean;
  };
  private coordHandler?: (coord: number[]) => void;

  constructor(session: OverlayReviewSession) {
    this.session = session;
  }

  getSession(): OverlayReviewSession {
    return this.session;
  }

  getState() {
    const layers = [{
      id: 'active-subject',
      colormapName: 'Custom',
      range: this.session.getDisplayRange(),
      threshold: [0, 0] as Threshold,
      alpha: 0.7,
      visible: true,
    }];

    if (this.summaryLayer) {
      layers.push({
        id: 'summary',
        colormapName: 'Viridis',
        range: this.summaryLayer.range,
        threshold: this.summaryLayer.threshold,
        alpha: this.summaryLayer.alpha,
        visible: this.summaryLayer.visible,
      });
    }

    return {
      subjectIndex: this.session.currentSubjectIndex,
      contrastId: this.session.currentContrastId,
      displayRange: this.session.getDisplayRange(),
      layers,
    };
  }

  setSubjectIndex(index: number): void {
    this.setSubjectIndexCalls.push(index);
    this.session.setSubjectIndex(index);
  }

  setContrast(id: string, subjectIndex?: number): void {
    this.setContrastCalls.push({ id, subjectIndex });
    this.session.setContrast(id);
    if (subjectIndex !== undefined) {
      this.session.setSubjectIndex(subjectIndex);
    }
  }

  setSymmetricThreshold(cutoff: number): void {
    this.symmetricCutoffCalls.push(cutoff);
  }

  setSummaryThreshold(threshold: Threshold): void {
    this.summaryThresholdCalls.push(threshold);
    if (this.summaryLayer) {
      this.summaryLayer.threshold = threshold;
    }
  }

  setSummaryVolume(volume: NeuroVol, options: SummaryLayerOptions = {}): void {
    this.summaryVolumeCalls.push({ volume, options });
    this.summaryLayer = {
      range: options.range ?? volume.getRange(),
      threshold: options.threshold ?? [0, 0],
      alpha: options.alpha ?? 0.7,
      visible: options.visible ?? true,
    };
  }

  clearSummaryVolume(): void {
    this.clearSummaryCalls.push(1);
    this.summaryLayer = undefined;
  }

  setOverlayOrder(order: OverlayReviewLayerOrder): void {
    this.overlayOrderCalls.push(order);
  }

  onCoordChange(handler: (coord: number[]) => void): () => void {
    this.coordHandler = handler;
    return () => {
      if (this.coordHandler === handler) this.coordHandler = undefined;
    };
  }

  emitCoord(world: number[]): void {
    this.coordHandler?.(world);
  }
}

describe('OverlayReviewPanel', () => {
  const space = new NeuroSpace([2, 1, 1], [1, 1, 1], [0, 0, 0]);

  function vol(values: number[]): FloatNeuroVol {
    return new FloatNeuroVol(space, Float32Array.from(values));
  }

  function sessionFrom(
    contrasts: Array<{ id: string; vols: number[][]; displayRange: Range }>
  ): OverlayReviewSession {
    return new OverlayReviewSession({
      template: vol([0, 0]),
      subjects: [
        { id: 's1', label: 'S1', group: 'A' },
        { id: 's2', label: 'S2', group: 'A' },
        { id: 's3', label: 'S3', group: 'B' },
      ],
      contrasts: contrasts.map((c) => ({
        id: c.id,
        vec: createReviewVecFromVolumes(c.vols.map(vol)),
        displayRange: c.displayRange,
      })),
    });
  }

  function fixture() {
    const session = sessionFrom([
      { id: 'faces', vols: [[1, 2], [3, 4], [5, 8]], displayRange: [-6, 6] },
      { id: 'places', vols: [[10, 20], [20, 30], [30, 40]], displayRange: [-12, 12] },
    ]);
    return {
      faces: session.getContrast('faces').vec,
      places: session.getContrast('places').vec,
      viewer: new FakeReviewViewer(session),
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('updates the active subject immediately while browsing', () => {
    const { viewer } = fixture();
    const panel = new OverlayReviewPanel();
    panel.setReviewViewer(viewer);

    panel.setSubjectIndex(2);

    expect(viewer.setSubjectIndexCalls).toEqual([2]);
    expect(panel.getPanelState().subjectIndex).toBe(2);
    expect(panel.getPanelState().view).toBe('subject');
    expect(panel.getPanelState().mode).toBe('browse');
  });

  it('uses leave-one-out stats for holdout summaries', () => {
    const { faces, viewer } = fixture();
    const panel = new OverlayReviewPanel();
    const looSpy = vi.spyOn(OverlaySummaryService.prototype, 'leaveOneOutStats');
    panel.setReviewViewer(viewer);
    panel.setHoldout(true);

    expect(panel.getPanelState().view).toBe('group');
    expect(panel.getPanelState().mode).toBe('holdout');

    viewer.summaryVolumeCalls.length = 0;
    panel.setSubjectIndex(1);

    const pushed = viewer.summaryVolumeCalls.at(-1)?.volume.getData();
    const brute = meanVolume(computeSufficientStats(faces, [0, 2])).getData();

    expect(looSpy).toHaveBeenLastCalledWith(1);
    expect(Array.from(pushed ?? [])).toEqual(Array.from(brute));
    expect(viewer.overlayOrderCalls.at(-1)).toBe('subject-over-summary');
  });

  it('restyles signed summary thresholds without recomputing', () => {
    const { viewer } = fixture();
    const panel = new OverlayReviewPanel();
    panel.setReviewViewer(viewer);
    panel.setView('group');
    panel.setReducer('tstat');

    const before = viewer.summaryVolumeCalls.length;
    panel.setCutoff(4);

    expect(viewer.symmetricCutoffCalls.at(-1)).toBe(4);
    expect(viewer.summaryThresholdCalls.at(-1)).toEqual([-4, 4]);
    expect(viewer.summaryVolumeCalls.length).toBe(before);
  });

  it('recomputes consistency when cutoff changes and keeps display threshold neutral', () => {
    const { viewer } = fixture();
    const panel = new OverlayReviewPanel();
    panel.summaryDebounceMs = 0;
    panel.setReviewViewer(viewer);
    panel.setView('group');
    panel.setReducer('consistency');

    viewer.summaryVolumeCalls.length = 0;
    viewer.summaryThresholdCalls.length = 0;
    panel.setCutoff(2);

    const pushed = viewer.summaryVolumeCalls.at(-1);
    expect(viewer.symmetricCutoffCalls.at(-1)).toBe(2);
    expect(viewer.summaryThresholdCalls).toEqual([]);
    expect(pushed?.options?.range).toEqual([0, 1]);
    expect(pushed?.options?.threshold).toEqual([0, 0]);
  });

  it('recomputes summary from the new contrast on contrast switch', () => {
    const { places, viewer } = fixture();
    const panel = new OverlayReviewPanel();
    panel.setReviewViewer(viewer);
    panel.setView('group');

    viewer.summaryVolumeCalls.length = 0;
    panel.setContrastId('places');

    const pushed = viewer.summaryVolumeCalls.at(-1);
    const expected = meanVolume(computeSufficientStats(places)).getData();

    expect(viewer.setContrastCalls.at(-1)).toEqual({ id: 'places', subjectIndex: 0 });
    expect(pushed?.options?.range).toEqual([-12, 12]);
    expect(Array.from(pushed?.volume.getData() ?? [])).toEqual(Array.from(expected));
  });

  it('describes the cutoff effect for the active mode and statistic', () => {
    expect(overlayCutoffHint('subject', 'signed', 3)).toBe('Hide subject |value| < 3');
    expect(overlayCutoffHint('group', 'signed', 2.5)).toBe('Hide summary |value| < 2.5');
    expect(overlayCutoffHint('group', 'consistency', 3)).toBe('Count subjects with |value| ≥ 3');
  });

  it('samples a voxel readout and reports k/N for consistency', () => {
    const { faces } = fixture();
    const subjectVol = faces.getVolume(0);
    const world = subjectVol.space.voxelToWorld([1, 0, 0]);
    const stats = computeSufficientStats(faces);
    const consistency = consistencyVolume(faces, { cutoff: 5, output: 'proportion' });

    const readout = sampleOverlayReadout(world, subjectVol, {
      volume: consistency,
      stats,
      isConsistency: true,
    });

    // voxel [1,0,0]: subject 0 value = 2; across subjects {2,4,8}, |.|>=5 -> only 8 -> 1/3
    expect(readout?.voxel).toEqual([1, 0, 0]);
    expect(readout?.subject).toBe(2);
    expect(readout?.validCount).toBe(3);
    expect(readout?.consistentCount).toBe(1);
    expect(readout?.summary).toBeCloseTo(1 / 3, 5);
  });

  it('emits a live cursor readout on coordinate change', () => {
    const { viewer } = fixture();
    const subjectVol = viewer.session.getSubjectVolume(0);
    const world = subjectVol.space.voxelToWorld([1, 0, 0]);
    const panel = new OverlayReviewPanel();
    panel.setReviewViewer(viewer);

    expect(panel.getReadout()).toBeNull();
    viewer.emitCoord(world);

    const readout = panel.getReadout();
    expect(readout?.voxel).toEqual([1, 0, 0]);
    expect(readout?.subject).toBe(2);
    expect(readout?.summary).toBeNull();
  });

  it('exposes a legend spec that tracks the active overlay', () => {
    const { viewer } = fixture();
    const panel = new OverlayReviewPanel();
    panel.summaryDebounceMs = 0;
    panel.setReviewViewer(viewer);

    expect(panel.legendSpec()).toEqual({ kind: 'signed', range: [-6, 6], label: 'Subject' });

    panel.setView('group');
    panel.setReducer('consistency');
    expect(panel.legendSpec()).toEqual({ kind: 'consistency', range: [0, 1], label: 'Consistency' });
  });

  it('clears cached per-contrast services when the viewer is replaced', () => {
    const panel = new OverlayReviewPanel();

    const viewerA = new FakeReviewViewer(
      sessionFrom([{ id: 'faces', vols: [[1, 1], [1, 1], [1, 1]], displayRange: [-6, 6] }])
    );
    panel.setReviewViewer(viewerA);
    panel.setView('group'); // builds a service bound to viewerA's data (mean = 1)

    const viewerB = new FakeReviewViewer(
      sessionFrom([{ id: 'faces', vols: [[9, 9], [9, 9], [9, 9]], displayRange: [-6, 6] }])
    );
    viewerB.summaryVolumeCalls.length = 0;
    panel.setReviewViewer(viewerB); // must recompute from viewerB's data (mean = 9), not the stale service

    const pushed = viewerB.summaryVolumeCalls.at(-1)?.volume.getData();
    expect(Array.from(pushed ?? [])).toEqual([9, 9]);
  });

  it('debounces holdout consistency scrubs but refreshes signed reducers immediately', () => {
    vi.useFakeTimers();

    // Signed reducer in holdout: immediate refresh on subject change.
    const signed = fixture().viewer;
    const signedPanel = new OverlayReviewPanel();
    signedPanel.summaryDebounceMs = 50;
    signedPanel.setReviewViewer(signed);
    signedPanel.setHoldout(true); // holdout + mean
    signed.summaryVolumeCalls.length = 0;
    signedPanel.setSubjectIndex(1);
    expect(signed.summaryVolumeCalls.length).toBe(1);

    // Consistency in holdout: debounced.
    const consistent = fixture().viewer;
    const consistentPanel = new OverlayReviewPanel();
    consistentPanel.summaryDebounceMs = 50;
    consistentPanel.setReviewViewer(consistent);
    consistentPanel.setView('group');
    consistentPanel.setReducer('consistency');
    consistentPanel.setHoldout(true);
    consistent.summaryVolumeCalls.length = 0;
    consistentPanel.setSubjectIndex(1);
    expect(consistent.summaryVolumeCalls.length).toBe(0);
    vi.advanceTimersByTime(50);
    expect(consistent.summaryVolumeCalls.length).toBe(1);
  });

  it('renders the panel template into shadow DOM', async () => {
    const { viewer } = fixture();
    const panel = new OverlayReviewPanel();
    document.body.appendChild(panel);
    panel.setReviewViewer(viewer);
    await panel.updateComplete;

    const text = panel.shadowRoot?.textContent ?? '';
    expect(text).toContain('Contrast');
    expect(text).toContain('View');
    expect(text).toContain('Subject');
    expect(text).toContain('Cutoff');
    expect(text).toContain('At cursor');

    // Group-only controls appear after switching view.
    expect(text).not.toContain('Statistic');
    panel.setView('group');
    await panel.updateComplete;
    expect(panel.shadowRoot?.textContent ?? '').toContain('Statistic');

    panel.remove();
  });
});

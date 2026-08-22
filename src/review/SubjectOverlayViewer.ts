import { ColorMap } from '../display/ColorMap';
import { ColorMapFactory } from '../display/ColorMapFactory';
import { SimpleOrthogonalViewer, SimpleOrthogonalViewerOptions } from '../display/SimpleOrthogonalViewer';
import { VolLayer } from '../display/VolLayer';
import { VolStack } from '../display/VolStack';
import { Range, Threshold, ValueError } from '../types';
import { NeuroVol } from '../volume/NeuroVol';
import {
  OverlayReviewDataset,
  OverlayReviewSession,
  OverlayReviewSessionOptions,
} from './OverlayReviewDataset';

export interface SummaryLayerOptions {
  colormap?: ColorMap;
  range?: Range;
  threshold?: Threshold;
  alpha?: number;
  visible?: boolean;
}

export interface SubjectOverlayViewerOptions extends SimpleOrthogonalViewerOptions, OverlayReviewSessionOptions {
  templateLayerId?: string;
  subjectLayerId?: string;
  summaryLayerId?: string;
  templateColormap?: ColorMap;
  templateRange?: Range;
  subjectColormap?: ColorMap;
  subjectThreshold?: Threshold;
  subjectAlpha?: number;
}

export interface SubjectOverlayViewerState {
  subjectIndex: number;
  contrastId: string;
  displayRange: Range;
  layers: ReturnType<SimpleOrthogonalViewer['listLayers']>;
}

export type OverlayReviewLayerOrder = 'subject-over-summary' | 'summary-over-subject';

const DEFAULT_TEMPLATE_LAYER_ID = 'template';
const DEFAULT_SUBJECT_LAYER_ID = 'active-subject';
const DEFAULT_SUMMARY_LAYER_ID = 'summary';
const DEFAULT_SUBJECT_ALPHA = 0.7;
const DEFAULT_SUMMARY_ALPHA = 0.7;

function validateSummaryVolume(volume: NeuroVol, reference: NeuroVol): void {
  const sameDim =
    volume.dim[0] === reference.dim[0] &&
    volume.dim[1] === reference.dim[1] &&
    volume.dim[2] === reference.dim[2];

  if (!sameDim || !volume.space.isSpatiallyCompatibleWith(reference.space)) {
    throw new ValueError('Summary volume geometry does not match the review template');
  }
}

function createDefaultSubjectColormap(
  range: Range,
  threshold: Threshold,
  alpha: number
): ColorMap {
  return ColorMapFactory.createDiverging(
    '#2166ac',
    '#f7f7f7',
    '#b2182b',
    256,
    { range, threshold, alpha }
  );
}

function createDefaultSummaryColormap(range: Range, alpha: number): ColorMap {
  return ColorMapFactory.fromPreset('Viridis', {
    range,
    threshold: [0, 0],
    alpha,
  });
}

export class SubjectOverlayViewer {
  private readonly session: OverlayReviewSession;
  private readonly viewer: SimpleOrthogonalViewer;
  private readonly templateLayerId: string;
  private readonly subjectLayerId: string;
  private readonly summaryLayerId: string;
  private hasSummaryLayer = false;

  private constructor(
    session: OverlayReviewSession,
    viewer: SimpleOrthogonalViewer,
    options: Required<Pick<SubjectOverlayViewerOptions, 'templateLayerId' | 'subjectLayerId' | 'summaryLayerId'>>
  ) {
    this.session = session;
    this.viewer = viewer;
    this.templateLayerId = options.templateLayerId;
    this.subjectLayerId = options.subjectLayerId;
    this.summaryLayerId = options.summaryLayerId;
  }

  static async create(
    container: HTMLElement,
    datasetOrSession: OverlayReviewDataset | OverlayReviewSession,
    options: SubjectOverlayViewerOptions = {}
  ): Promise<SubjectOverlayViewer> {
    const session = datasetOrSession instanceof OverlayReviewSession
      ? datasetOrSession
      : new OverlayReviewSession(datasetOrSession, {
          initialContrastId: options.initialContrastId,
          initialSubjectIndex: options.initialSubjectIndex,
        });

    const templateLayerId = options.templateLayerId ?? DEFAULT_TEMPLATE_LAYER_ID;
    const subjectLayerId = options.subjectLayerId ?? DEFAULT_SUBJECT_LAYER_ID;
    const summaryLayerId = options.summaryLayerId ?? DEFAULT_SUMMARY_LAYER_ID;
    const subjectRange = session.getDisplayRange();
    const subjectThreshold = options.subjectThreshold ?? [0, 0];
    const subjectAlpha = options.subjectAlpha ?? DEFAULT_SUBJECT_ALPHA;
    const templateRange = options.templateRange ?? session.template.getRange();

    const templateLayer = new VolLayer(
      templateLayerId,
      session.template,
      options.templateColormap ?? ColorMapFactory.createGrayscale({ range: templateRange }),
      templateRange,
      [0, 0],
      1
    );

    const subjectLayer = new VolLayer(
      subjectLayerId,
      session.getSubjectVolume(),
      options.subjectColormap ?? createDefaultSubjectColormap(subjectRange, subjectThreshold, subjectAlpha),
      subjectRange,
      subjectThreshold,
      subjectAlpha
    );

    const stack = new VolStack(templateLayer, subjectLayer);
    const viewer = await SimpleOrthogonalViewer.create(container, stack, options);

    return new SubjectOverlayViewer(session, viewer, {
      templateLayerId,
      subjectLayerId,
      summaryLayerId,
    });
  }

  getSession(): OverlayReviewSession {
    return this.session;
  }

  getViewer(): SimpleOrthogonalViewer {
    return this.viewer;
  }

  /** Subscribe to crosshair coordinate changes (world mm). Returns an unsubscribe fn. */
  onCoordChange(handler: (coord: number[]) => void): () => void {
    return this.viewer.onCoordChange(handler);
  }

  getState(): SubjectOverlayViewerState {
    return {
      subjectIndex: this.session.currentSubjectIndex,
      contrastId: this.session.currentContrastId,
      displayRange: this.session.getDisplayRange(),
      layers: this.viewer.listLayers(),
    };
  }

  getCurrentSubjectVolume(): NeuroVol {
    return this.session.getSubjectVolume();
  }

  setSubjectIndex(index: number): void {
    this.session.setSubjectIndex(index);
    this.viewer.updateLayerVolume(this.subjectLayerId, this.session.getSubjectVolume(), {
      range: null,
    });
  }

  setContrast(id: string, subjectIndex: number = this.session.currentSubjectIndex): void {
    this.session.setContrast(id);
    this.session.setSubjectIndex(subjectIndex);

    this.viewer.updateLayerVolume(this.subjectLayerId, this.session.getSubjectVolume(), {
      range: this.session.getDisplayRange(),
    });
  }

  setSubjectThreshold(threshold: Threshold): void {
    this.viewer.updateLayer(this.subjectLayerId, { threshold });
  }

  setSummaryThreshold(threshold: Threshold): void {
    if (!this.hasSummaryLayer) return;
    this.viewer.updateLayer(this.summaryLayerId, { threshold });
  }

  setSymmetricThreshold(cutoff: number): void {
    if (!Number.isFinite(cutoff) || cutoff < 0) {
      throw new ValueError('Symmetric threshold cutoff must be a finite non-negative number');
    }
    this.setSubjectThreshold([-cutoff, cutoff]);
  }

  setSummaryVolume(volume: NeuroVol, options: SummaryLayerOptions = {}): void {
    validateSummaryVolume(volume, this.session.template);

    const range = options.range ?? volume.getRange();
    const threshold = options.threshold ?? [0, 0];
    const alpha = options.alpha ?? DEFAULT_SUMMARY_ALPHA;
    const visible = options.visible ?? true;

    if (this.hasSummaryLayer) {
      this.viewer.updateLayerVolume(this.summaryLayerId, volume, {
        range,
        threshold,
        alpha,
        colormap: options.colormap,
      });
      this.viewer.updateLayer(this.summaryLayerId, { visible });
      return;
    }

    const summaryLayer = new VolLayer(
      this.summaryLayerId,
      volume,
      options.colormap ?? createDefaultSummaryColormap(range, alpha),
      range,
      threshold,
      alpha
    );
    summaryLayer.setVisible(visible);
    this.viewer.addLayer(summaryLayer);
    this.hasSummaryLayer = true;
  }

  clearSummaryVolume(): void {
    if (!this.hasSummaryLayer) return;
    this.viewer.removeLayer(this.summaryLayerId);
    this.hasSummaryLayer = false;
  }

  bringSubjectToFront(): void {
    this.viewer.moveLayer(this.subjectLayerId, this.viewer.listLayers().length - 1);
  }

  bringSummaryToFront(): void {
    if (!this.hasSummaryLayer) return;
    this.viewer.moveLayer(this.summaryLayerId, this.viewer.listLayers().length - 1);
  }

  setOverlayOrder(order: OverlayReviewLayerOrder): void {
    if (order === 'subject-over-summary') {
      this.bringSubjectToFront();
      return;
    }

    this.bringSummaryToFront();
  }

  dispose(): void {
    this.viewer.dispose();
  }
}

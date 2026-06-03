import { OrthogonalImageViewer } from './OrthogonalImageViewer';
import { ImageLayer } from './ImageLayer';
import { VolStack } from './VolStack';
import { VolLayer } from './VolLayer';
import { ColorMapFactory } from './ColorMapFactory';
import type { ColorMap } from './ColorMap';
import { AxisSet3D } from '../geometry/Axis';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { Matrix } from 'ml-matrix';
import { resolveColorMap } from './ColorMapResolver';
import { EventEmitter } from './EventEmitter';
import type { SlicePointerEvent } from './types/display';

type LayoutMode = 'left-tall' | 'top-bottom';

export interface SimpleOrthogonalViewerOptions {
  layout?: LayoutMode;
  showCrosshair?: boolean;
  showSlider?: boolean;
  gapPx?: number;
  showIntensityReadout?: boolean;
  showOrientationLabels?: boolean;
}

/**
 * Simple wrapper around OrthogonalImageViewer that exposes a minimal, programmatic API
 * suitable for embedding in external applications without shipping UI widgets.
 *
 * **This is the recommended (canonical) high-level 3-up orthogonal viewer.** For
 * custom layouts or finer control, compose {@link SingleSliceViewer} instances with
 * {@link ViewSynchronizer} instead. See the architecture note on {@link SliceViewer}.
 */
export class SimpleOrthogonalViewer {
  private root: HTMLElement;
  private imageLayer: ImageLayer;
  private viewer!: OrthogonalImageViewer;
  private emitter = new EventEmitter<{
    ready: [];
    coordChanged: [number[]];
    sliceChanged: [{ view: 'axial' | 'coronal' | 'sagittal'; index: number }];
    layerAdded: [{ id: string }];
    layerRemoved: [{ id: string }];
    layerUpdated: [{ id: string }];
    layerOrderChanged: [string[]];
    pointerMove: [{ view: 'axial'|'coronal'|'sagittal'; image?: {x:number;y:number}|null; volume?: number[]|null; world?: number[]|null }];
    pointerDown: [{ view: 'axial'|'coronal'|'sagittal'; image?: {x:number;y:number}|null; volume?: number[]|null; world?: number[]|null }];
  }>();

  private constructor(root: HTMLElement, imageLayer: ImageLayer) {
    this.root = root;
    this.imageLayer = imageLayer;
  }

  static async create(
    container: HTMLElement,
    volStack: VolStack,
    options?: SimpleOrthogonalViewerOptions
  ): Promise<SimpleOrthogonalViewer> {
    const imageLayer = new ImageLayer(volStack);
    imageLayer.initialize();

    const wrapper = new SimpleOrthogonalViewer(container, imageLayer);
    wrapper.viewer = await OrthogonalImageViewer.create({
      container,
      imageLayer,
      options: {
        layout: options?.layout ?? 'top-bottom',
        showCrosshair: options?.showCrosshair ?? true,
        showSlider: options?.showSlider ?? false,
        gapPx: options?.gapPx ?? 12,
      },
    });
    // Wire events for external integrations
    (['axial','coronal','sagittal'] as const).forEach((view) => {
      const sv = wrapper.viewer.getSliceViewer(view);
      sv.onCurrentSliceIndexChange((index) => wrapper.emitter.emit('sliceChanged', { view, index }));
      sv.onCurrentCoordChange((coord) => wrapper.emitter.emit('coordChanged', coord.slice()));
      // Pointer events
      const v = sv.view;
      const publish = (type: 'pointerMove'|'pointerDown') => () => {
        wrapper.emitter.emit(type, {
          view,
          image: sv.mouseImagePosition,
          volume: sv.mouseVolumeCoordinate,
          world: sv.mouseWorldCoordinate,
        } as any);
      };
      v.addPointerMoveListener(publish('pointerMove'));
      v.addPointerDownListener(publish('pointerDown'));
    });
    wrapper.emitter.emit('ready');
    return wrapper;
  }

  // Coordinate control
  setWorldCoord(coord: number[]): void {
    this.viewer.setWorldCoord(coord);
  }

  getWorldCoord(): number[] {
    return this.viewer.currentCoord.slice();
  }

  /**
   * Set position using LPI anatomical world coordinates (mm) regardless of the
   * underlying volume orientation. Converts LPI→volume space and updates slices.
   *
   * LPI means: X=Left(+)/Right(-), Y=Posterior(+)/Anterior(-), Z=Inferior(+)/Superior(-).
   */
  setLPICoord(lpiCoord: [number, number, number]): void {
    const space = this.imageLayer.neuroSpace;
    const lpiSpace = new NeuroSpace(space.dim, space.spacing, space.origin, AxisSet3D.AXIAL_LPI);
    // Transform LPI world → current space world
    const M = lpiSpace.getTransformationMatrixTo(space);
    const v = Matrix.columnVector([lpiCoord[0], lpiCoord[1], lpiCoord[2], 1]);
    const out = M.mmul(v).to1DArray();
    const world = [out[0], out[1], out[2]];
    this.setWorldCoord(world);
  }

  /**
   * Read current position as LPI anatomical world coordinates (mm).
   */
  getLPICoord(): [number, number, number] {
    const space = this.imageLayer.neuroSpace;
    const lpiSpace = new NeuroSpace(space.dim, space.spacing, space.origin, AxisSet3D.AXIAL_LPI);
    const M = space.getTransformationMatrixTo(lpiSpace);
    const c = this.getWorldCoord();
    const v = Matrix.columnVector([c[0], c[1], c[2], 1]);
    const out = M.mmul(v).to1DArray();
    return [out[0], out[1], out[2]];
  }

  /**
   * Set the discrete slice index for a specific orthogonal view.
   * This is often more convenient than computing a world coordinate.
   */
  setSliceIndex(view: 'axial' | 'coronal' | 'sagittal', index: number): void {
    const v = this.viewer.getSliceViewer(view);
    v.model.setCurrentSliceIndex(index);
  }

  /**
   * Get the current slice index for a specific view.
   */
  getSliceIndex(view: 'axial' | 'coronal' | 'sagittal'): number {
    return this.viewer.getSliceViewer(view).model.currentSliceIndex;
  }

  // Layer management
  addLayer(layer: VolLayer): void {
    this.imageLayer.addVolLayer(layer);
    this.redraw();
    this.emitter.emit('layerAdded', { id: layer.id });
  }

  removeLayer(layerId: string): void {
    const layer = this.imageLayer.getVolStack().getLayerById(layerId);
    if (layer) {
      this.imageLayer.removeVolLayer(layer);
      this.redraw();
      this.emitter.emit('layerRemoved', { id: layerId });
    }
  }

  updateLayer(layerId: string, params: {
    colormap?: ColorMap | string;
    range?: [number, number];
    threshold?: [number, number];
    alpha?: number;
    visible?: boolean;
  }): void {
    // Robust, case-insensitive colormap resolution
    if (params.colormap) {
      params.colormap = resolveColorMap(params.colormap as any);
    }
    const updateParams = {
      colormap: params.colormap as any,
      range: params.range,
      threshold: params.threshold,
      alpha: params.alpha,
      visible: params.visible,
    } as any;

    this.viewer.applyToImageLayers(layer => layer.updateLayer(layerId, updateParams));
    this.redraw();
    this.emitter.emit('layerUpdated', { id: layerId });
  }

  /**
   * Replace the underlying volume for an existing layer (keeps z-order and id).
   * Handy for fast overlay updates (e.g., sigma changes) without add/remove.
   */
  updateLayerVolume(
    layerId: string,
    volume: import('../volume/NeuroVol').NeuroVol,
    opts?: { range?: [number, number] | null; threshold?: [number, number]; alpha?: number; colormap?: ColorMap | string }
  ): void {
    // Resolve colormap if provided as string
    const colormap = typeof opts?.colormap === 'string'
      ? resolveColorMap(opts.colormap as any)
      : opts?.colormap;

    // Use the main imageLayer directly (same as addLayer/removeLayer)
    // This ensures we update the shared volumeStack, not per-view layers
    this.imageLayer.replaceVolume(layerId, volume, {
      range: opts?.range ?? null,
      threshold: opts?.threshold,
      alpha: opts?.alpha,
      colormap,
    });
    this.redraw();
    this.emitter.emit('layerUpdated', { id: layerId });
  }

  // Canvas access per view
  getCanvas(view: 'axial' | 'sagittal' | 'coronal'): HTMLCanvasElement {
    return this.viewer.getSliceViewer(view).view.getCanvas();
  }

  // Background (applied per sub-view)
  setBackground(color: number): void {
    const css = `#${(color >>> 0).toString(16).padStart(6, '0')}`;
    (['axial', 'sagittal', 'coronal'] as const).forEach(v => {
      const canvas = this.viewer.getSliceViewer(v).view.getCanvas();
      (canvas as HTMLCanvasElement).style.background = css;
    });
  }

  // Runtime crosshair toggle across all views
  setCrosshairVisible(visible: boolean): void {
    this.viewer.setCrosshairVisible(visible);
  }

  // Event API for external systems
  onReady(handler: () => void): () => void {
    return this.emitter.on('ready', handler);
  }
  onCoordChange(handler: (coord: number[]) => void): () => void {
    return this.emitter.on('coordChanged', handler);
  }
  onSliceChange(handler: (p: { view: 'axial' | 'coronal' | 'sagittal'; index: number }) => void): () => void {
    return this.emitter.on('sliceChanged', handler as any);
  }

  // Alignment controls for overlays with differing FOV/spacing
  setAlignmentOptions(options: Partial<import('./alignment/AlignmentManager').AlignmentManagerOptions>): void {
    this.viewer.applyToImageLayers(layer => layer.setAlignmentOptions(options));
    this.redraw();
  }

  setAlignmentStrategy(strategy: import('./alignment/AlignmentManager').AlignmentStrategyType): void {
    this.viewer.applyToImageLayers(layer => layer.setAlignmentStrategy(strategy));
    this.redraw();
  }

  /**
   * Change z-order of a layer (0 = back/reference). Emits layerOrderChanged.
   */
  moveLayer(layerId: string, toIndex: number): void {
    const stack = this.imageLayer.getVolStack();
    stack.moveLayerById(layerId, toIndex);
    this.redraw();
    this.emitter.emit('layerOrderChanged', stack.getLayerIds());
  }

  // Set which view receives keyboard navigation input
  setFocusedView(view: 'axial' | 'sagittal' | 'coronal' | null): void {
    this.viewer.setFocusedView(view as any);
  }

  // Internal re-render hook
  private redraw(): void {
    // Force re-render by directly calling renderSlice on all views
    // This is necessary because setting the same coordinate doesn't trigger MobX reactions
    (['axial', 'sagittal', 'coronal'] as const).forEach(view => {
      this.viewer.getSliceViewer(view).view.renderSlice();
    });
  }

  // -------- External integration helpers --------
  /**
   * Enumerate layers with display state for external systems.
   */
  listLayers(): Array<{
    id: string;
    colormapName: string;
    range: [number, number];
    threshold: [number, number];
    alpha: number;
    visible: boolean;
  }> {
    const stack = this.imageLayer.getVolStack();
    return stack.getLayerIds().map((id) => {
      const l = stack.getLayerById(id)!;
      return {
        id,
        colormapName: (l.colorMap?.name) || 'Custom',
        range: l.getRange(),
        threshold: l.getThreshold(),
        alpha: l.opacity,
        visible: l.visible,
      };
    });
  }

  /**
   * Snapshot minimal viewer state for persistence.
   */
  getState(): {
    worldCoord: number[];
    lpiCoord: [number, number, number];
    slices: { axial: number; coronal: number; sagittal: number };
    layers: ReturnType<SimpleOrthogonalViewer['listLayers']>;
  } {
    return {
      worldCoord: this.getWorldCoord(),
      lpiCoord: this.getLPICoord(),
      slices: {
        axial: this.getSliceIndex('axial'),
        coronal: this.getSliceIndex('coronal'),
        sagittal: this.getSliceIndex('sagittal'),
      },
      layers: this.listLayers(),
    };
  }

  /**
   * Restore viewer state (best-effort). Does not alter layout.
   */
  applyState(state: Partial<ReturnType<SimpleOrthogonalViewer['getState']>>): void {
    if (state?.worldCoord && state.worldCoord.length === 3) {
      this.setWorldCoord(state.worldCoord);
    } else if (state?.lpiCoord && state.lpiCoord.length === 3) {
      this.setLPICoord(state.lpiCoord as [number, number, number]);
    }
    if (state?.slices) {
      if (typeof state.slices.axial === 'number') this.setSliceIndex('axial', state.slices.axial);
      if (typeof state.slices.coronal === 'number') this.setSliceIndex('coronal', state.slices.coronal);
      if (typeof state.slices.sagittal === 'number') this.setSliceIndex('sagittal', state.slices.sagittal);
    }
    if (state?.layers) {
      state.layers.forEach(l => {
        this.updateLayer(l.id, {
          colormap: l.colormapName,
          range: l.range,
          threshold: l.threshold,
          alpha: l.alpha,
          visible: l.visible,
        });
      });
      // Reorder according to provided order
      state.layers.forEach((l, i) => this.moveLayer(l.id, i));
    }
  }

  /**
   * Export a PNG/JPEG of a specific view's canvas.
   */
  toDataURL(view: 'axial'|'coronal'|'sagittal', type: string = 'image/png', quality?: number): string {
    const canvas = this.getCanvas(view);
    try {
      // @ts-ignore quality optional only for image/jpeg/webp
      return canvas.toDataURL(type, quality);
    } catch {
      return canvas.toDataURL();
    }
  }

  // ─── Zoom & Pan ────────────────────────────────────────────

  /**
   * Set the zoom level for a specific view.
   */
  setZoom(view: 'axial' | 'coronal' | 'sagittal', level: number): void {
    const sv = this.viewer.getSliceViewer(view);
    const v = sv.view as any;
    if (typeof v.setZoom === 'function') {
      v.setZoom(level);
    }
  }

  /**
   * Get the current zoom level for a specific view.
   */
  getZoom(view: 'axial' | 'coronal' | 'sagittal'): number {
    const sv = this.viewer.getSliceViewer(view);
    const v = sv.view as any;
    return typeof v.getZoom === 'function' ? v.getZoom() : 1.0;
  }

  /**
   * Reset zoom and pan for all views.
   */
  resetAllViews(): void {
    (['axial', 'coronal', 'sagittal'] as const).forEach(view => {
      const sv = this.viewer.getSliceViewer(view);
      const v = sv.view as any;
      if (typeof v.resetView === 'function') {
        v.resetView();
      }
    });
  }

  dispose(): void {
    this.viewer.dispose();
  }
}

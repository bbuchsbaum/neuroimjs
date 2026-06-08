// File: src/display/SliceView.ts

import * as PIXI from 'pixi.js';
import { SliceLayer, ScreenLayoutContext } from './SliceLayer';
import { AxisSet3D } from '../geometry/Axis';
import { ImageLayer } from './ImageLayer';
import { CrossHair } from './CrossHair';  // note: updated CrossHair that requires a transformer
import { CoordinateTransformer } from './CoordinateTransformer';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { SliceModel } from './SliceModel';
import { reaction, IReactionDisposer, autorun } from 'mobx';
import { ISliceView, ICoordinateTransformer } from './interfaces';
import { PointerEventHandler, SlicePointerEvent } from './types/display';

/**
 * Options for configuring a SliceView instance.
 */
interface SliceViewOptions {
  width?: number;
  height?: number;
  showCrosshair?: boolean;
  showSlider?: boolean;
}

/**
 * SliceView manages a PIXI.js Application to display slices from one or more
 * volumetric datasets. It:
 *   - Holds a mainContainer for each sprite/layer
 *   - Maintains a CoordinateTransformer for screen↔volume coords
 *   - Listens to a SliceModel for current slice index or 3D coord
 */
export class SliceView implements ISliceView {
  public app!: PIXI.Application;
  public mainContainer!: PIXI.Container;
  // Unscaled, stage-level container for screen-space overlays (e.g. orientation
  // labels). It sits on top of mainContainer and is never scaled or Y-flipped,
  // so its children are positioned directly in viewport pixel coordinates.
  public overlayContainer!: PIXI.Container;
  private canvas: HTMLCanvasElement | null = null;
  public slider: HTMLInputElement | null = null;
  public coordinateTransformer!: CoordinateTransformer;
  public domElement: HTMLElement;

  public layers: SliceLayer[] = [];
  private options: SliceViewOptions;
  private layersMap: Map<string, SliceLayer> = new Map();

  private imageLayer: ImageLayer;
  private neuroSpace: NeuroSpace;
  private viewAxes: AxisSet3D;
  private model: SliceModel;
  private disposers: IReactionDisposer[] = [];
  private boundOnResize: () => void = () => {};
  private resizeObserver: ResizeObserver | null = null;

  // Zoom & Pan state
  private zoomLevel: number = 1.0;
  private panOffset: { x: number; y: number } = { x: 0, y: 0 };
  private readonly MIN_ZOOM = 0.5;
  private readonly MAX_ZOOM = 10.0;

  /**
   * Private constructor. Use `SliceView.create(...)` for async instantiation.
   */
  private constructor(
    domElement: HTMLElement,
    imageLayer: ImageLayer,
    neuroSpace: NeuroSpace,
    viewAxes: AxisSet3D,
    model: SliceModel,
    options?: SliceViewOptions
  ) {
    this.domElement = domElement;
    this.imageLayer = imageLayer;
    this.neuroSpace = neuroSpace;
    this.viewAxes = viewAxes;
    this.model = model;
    this.options = options ?? {};
  }

  /**
   * Factory function to build a SliceView instance (async).
   */
  public static async create(
    domElement: HTMLElement,
    imageLayer: ImageLayer,
    neuroSpace: NeuroSpace,
    viewAxes: AxisSet3D,
    model: SliceModel,
    options?: SliceViewOptions
  ): Promise<SliceView> {
    const view = new SliceView(domElement, imageLayer, neuroSpace, viewAxes, model, options);
    await view.initialize();
    return view;
  }

  /**
   * Internal initialization routine: sets up the PIXI application, 
   * canvas, coordinate transformer, crosshair layer (optionally), etc.
   */
  private async initialize() {
    // 1) Prepare the coordinate system manager
    this.coordinateTransformer = new CoordinateTransformer(this.neuroSpace, this.viewAxes);

    // 2) Create a PIXI Application
    // CRITICAL FIX: Use actual container dimensions instead of hardcoded 800×600
    // This ensures canvas matches the DOM element size from the start
    const containerWidth = this.domElement.clientWidth;
    const containerHeight = this.domElement.clientHeight;
    const width = this.options.width ?? (containerWidth || 800);
    const height = this.options.height ?? (containerHeight || 600);

    const baseOptions: PIXI.ApplicationOptions = {
      width,
      height,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      backgroundColor: 0x000000,
    };

    const PixiAppClass: any = PIXI.Application as any;
    // Pixi v8 path: instance.init(options)
    if (PixiAppClass && PixiAppClass.prototype && typeof PixiAppClass.prototype.init === 'function') {
      this.app = new PixiAppClass();
      // Do NOT use resizeTo — it creates an internal ResizeObserver that resizes
      // the renderer independently without re-fitting content. We handle resizing
      // ourselves via our own ResizeObserver + fitContainerToScreen().
      await (this.app as any).init(baseOptions);
    } else {
      // Pixi v5–v7 path: constructor accepts options
      this.app = new PixiAppClass(baseOptions);
    }

    const canvas = (this.app as any).canvas || (this.app as any).view;
    if (!canvas) {
      throw new Error('PIXI Application did not provide a canvas element');
    }
    this.canvas = canvas as HTMLCanvasElement;

    // 3) Append the canvas
    this.domElement.appendChild(this.canvas);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';

    // 4) Main container for slices
    this.mainContainer = new PIXI.Container();
    this.app.stage.addChild(this.mainContainer);

    // 4b) Overlay container for screen-space layers (orientation labels, etc.).
    // Added after mainContainer so it renders on top, and left at the identity
    // transform so its children live in viewport pixel coordinates.
    this.overlayContainer = new PIXI.Container();
    this.app.stage.addChild(this.overlayContainer);

    // 5) Container style - position: relative for slider absolute positioning
    this.domElement.style.position = 'relative';
    this.domElement.style.width = '100%';
    this.domElement.style.height = '100%';
    this.domElement.style.overflow = 'hidden';

    // 6) Optional slice slider
    if (this.options.showSlider) {
      this.createSlider(this.model.totalSlices, this.model.currentSliceIndex);
    }

    // 7) Optionally add a crosshair overlay layer
    // Note: Window resize is handled automatically by PIXI's resizeTo option
    if (this.options.showCrosshair) {
      // Pass the existing transformer to CrossHair
      const crossHairLayer = new CrossHair(
        this.neuroSpace,
        this.viewAxes,
        this.coordinateTransformer  // <=== share the transform
      );
      this.addLayer('crosshair', crossHairLayer);
    }

    // 8) Watch for container resize so content is re-fit when flex/grid
    //    layouts settle or the window is resized.
    if (typeof ResizeObserver !== 'undefined') {
      let lastW = 0, lastH = 0;
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width: w, height: h } = entry.contentRect;
          if (w > 0 && h > 0 && (Math.abs(w - lastW) > 1 || Math.abs(h - lastH) > 1)) {
            lastW = w;
            lastH = h;
            this.onResize();
          }
        }
      });
      this.resizeObserver.observe(this.domElement);
    }

    // 9) Setup MobX reactions
    this.setupReactions();
  }

  /**
   * Setup MobX reactions/autoruns to track:
   *  - model.currentCoord => updatePosition
   *  - changes in VolLayer properties => re-render
   *  - changes in VolStack => re-render
   */
  private setupReactions(): void {
    // 1) Re-render when currentCoord changes
    const coordDisposer = autorun(() => {
      const coord = this.model.currentCoord.slice();
      this.updatePosition(coord);

      // Sync the slider as well
      if (this.slider) {
        this.slider.value = this.model.currentSliceIndex.toString();
      }
    });
    this.disposers.push(coordDisposer);

    // 2) Reaction to changes in volume layers' properties
    // IMPORTANT: We must actually READ the observable properties for MobX to track them.
    // Just iterating over layers without accessing properties won't trigger on property changes.
    const volLayersDisposer = autorun(() => {
      const layers = this.imageLayer.getVolStack().layers;
      // Touch each layer's observable properties so MobX tracks them
      layers.forEach(layer => {
        // Access observable properties to establish tracking
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _opacity = layer.opacity;
        const _visible = layer.visible;
        const _range = layer.range;
        const _threshold = layer.threshold;
        const _colorMap = layer.colorMap;
        const _version = layer.version;  // Track version for texture cache invalidation
      });
      this.renderSlice();
    });
    this.disposers.push(volLayersDisposer);

    // 3) Reaction to changes in the VolStack
    const volStackDisposer = reaction(
      () => this.imageLayer.getVolStack().layers.length,
      () => {
        this.renderSlice();
      }
    );
    this.disposers.push(volStackDisposer);
  }

  /**
   * Creates a range slider for slice navigation
   */
  private createSlider(totalSlices: number, currentSliceIndex: number) {
    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.min = '0';
    this.slider.max = (totalSlices - 1).toString();
    this.slider.value = currentSliceIndex.toString();
    this.slider.className = 'slice-slider';

    // Style the slider to sit at the bottom of the view
    Object.assign(this.slider.style, {
      position: 'absolute',
      bottom: '8px',
      left: '10%',
      width: '80%',
      height: '20px',
      zIndex: '100',
      cursor: 'pointer',
      accentColor: '#3fb8af'
    });

    this.domElement.appendChild(this.slider);
  }

  /**
   * Updates the displayed position in 3D coordinate space 
   * in the imageLayer + overlay layers, then triggers re-render.
   */
  public updatePosition(coord: number[]): void {
    this.imageLayer.setPosition(coord);
    this.layers.forEach(layer => {
      layer.setPosition(coord);
    });
    this.renderSlice();
  }

  /**
   * Renders the current slice by:
   *  - Setting the pinned slice index in the transformer
   *  - Clearing previous container
   *  - Asking imageLayer + overlays to render
   *  - Fitting to screen
   */
  public renderSlice(): void {
    // Pin the transform to the current slice
    this.coordinateTransformer.setSliceIndex(this.model.currentSliceIndex);


    // Clear old
    this.mainContainer.removeChildren();
    this.overlayContainer.removeChildren();

    // Render main image
    const index = this.model.currentSliceIndex;
    const layerContent = this.imageLayer.renderSlice(
      index,
      this.model.currentCoord,
      this.viewAxes,
      this.mainContainer
    );

    if (layerContent) {
      this.mainContainer.addChild(layerContent);
    }

    // Render overlays. Screen-space layers (e.g. orientation labels) go into the
    // unscaled overlayContainer so they keep a fixed pixel size and are excluded
    // from the image fit-bounds; all other layers render in image content space.
    this.layers.forEach(layer => {
      const target = layer.screenSpace ? this.overlayContainer : this.mainContainer;
      const overlay = layer.renderSlice(
        index,
        this.model.currentCoord,
        this.viewAxes,
        target
      );
      if (overlay) {
        target.addChild(overlay);
      }
    });

    // Force a render so textures finalize before measuring bounds
    try {
      if (this.app.renderer && typeof this.app.renderer.render === 'function') {
        this.app.renderer.render(this.app.stage);
      }
    } catch (e) {
      console.warn('[SliceView] Render error:', e);
    }

    // Fit to screen
    this.fitContainerToScreen();

    // Explicitly render the scene (needed in PIXI v8)
    if (this.app.renderer && typeof this.app.renderer.render === 'function') {
      this.app.renderer.render(this.app.stage);
    }

  }

  /**
   * Fit content to screen + flip Y scale
   */
  private fitContainerToScreen(): void {
    if (!this.mainContainer.children.length) {
      console.warn('No content to fit');
      return;
    }

    try { (this.mainContainer as any).calculateBounds?.(); } catch {}
    const bounds = this.mainContainer.getLocalBounds();

    const findFirstSprite = (container: PIXI.Container): PIXI.Sprite | null => {
      for (const child of container.children) {
        if ((child as any).texture) return child as PIXI.Sprite;
        if ((child as any).children?.length) {
          const res = findFirstSprite(child as PIXI.Container);
          if (res) return res;
        }
      }
      return null;
    };

    const fallbackSprite = findFirstSprite(this.mainContainer);
    let contentW = bounds.width;
    let contentH = bounds.height;

    if (!contentW || !isFinite(contentW) || contentW <= 0 || !contentH || !isFinite(contentH) || contentH <= 0) {
      contentW = fallbackSprite?.texture?.width ?? fallbackSprite?.width ?? 1;
      contentH = fallbackSprite?.texture?.height ?? fallbackSprite?.height ?? 1;
    }

    let availableWidth = this.domElement.clientWidth;
    let availableHeight = this.domElement.clientHeight;

    if (availableWidth <= 0 || availableHeight <= 0) {
      const rect = this.domElement.getBoundingClientRect();
      availableWidth = rect.width || contentW;
      availableHeight = rect.height || contentH;
    }

    const scale = Math.min(availableWidth / contentW, availableHeight / contentH, 4);
    const safeScale = !Number.isFinite(scale) || scale <= 0 ? 1 : scale;

    const pivotX = bounds.x + contentW / 2;
    const pivotY = bounds.y + contentH / 2;
    this.mainContainer.pivot.set(pivotX, pivotY);
    const effectiveScale = safeScale * this.zoomLevel;
    this.mainContainer.scale.set(effectiveScale, -effectiveScale);
    this.mainContainer.position.set(
      availableWidth / 2 + this.panOffset.x,
      availableHeight / 2 + this.panOffset.y
    );

    const renderer = this.app.renderer as any;
    const targetWidth = Math.max(1, Math.round(availableWidth));
    const targetHeight = Math.max(1, Math.round(availableHeight));
    renderer.resize(targetWidth, targetHeight);

    // Re-pin screen-space overlays (orientation labels, etc.) to the viewport.
    // Done here so labels stay pinned through render, resize, zoom, and pan.
    this.layoutScreenSpaceLayers(availableWidth, availableHeight);
  }

  /**
   * Project a point from image-content space (the pre-scale coordinate space the
   * slice sprite occupies) to screen pixels, using the live mainContainer
   * transform. Mirrors PIXI's local→global mapping for an axis-aligned,
   * possibly Y-flipped, scaled, and translated container.
   */
  private projectContentToScreen(contentX: number, contentY: number): { x: number; y: number } {
    const c = this.mainContainer;
    return {
      x: (contentX - c.pivot.x) * c.scale.x + c.position.x,
      y: (contentY - c.pivot.y) * c.scale.y + c.position.y,
    };
  }

  /**
   * Lay out all screen-space layers against the current viewport geometry.
   */
  private layoutScreenSpaceLayers(width: number, height: number): void {
    if (!this.layers.length) return;
    const ctx: ScreenLayoutContext = {
      width,
      height,
      project: (cx: number, cy: number) => this.projectContentToScreen(cx, cy),
    };
    this.layers.forEach(layer => {
      if (layer.screenSpace && typeof layer.layoutScreen === 'function') {
        layer.layoutScreen(ctx);
      }
    });
  }

  /**
   * Programmatic resize handler for manual triggering.
   * Note: Automatic window resize is handled by PIXI's resizeTo option.
   * This method is only needed for edge cases requiring manual resize.
   */
  private onResize(): void {
    // PIXI's resizeTo option handles renderer.resize() automatically
    // We only need to re-fit container and force re-render

    // Invalidate any cached bounds before fitting to ensure fresh calculation
    try {
      (this.mainContainer as any)._boundsID = -1;
      this.mainContainer.children.forEach((child: any) => {
        if (child._boundsID !== undefined) child._boundsID = -1;
      });
    } catch {}

    this.fitContainerToScreen();

    // Force re-render after resize to ensure proper display
    if (this.app.renderer && typeof this.app.renderer.render === 'function') {
      this.app.renderer.render(this.app.stage);
    }
  }

  /**
   * Public method for programmatic resize triggering.
   * Automatic window resize is handled by PIXI's resizeTo option.
   * Uses requestAnimationFrame to ensure DOM layout is settled before calculating sizes.
   */
  public handleResize(): void {
    // Use double RAF to ensure DOM layout is fully settled
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.onResize();
      });
    });
  }

  /**
   * Dispatch pointer move events to layers
   */
  public handlePointerMove(event: SlicePointerEvent): void {
    for (const layer of this.layers) {
      const handled = layer.onPointerMove(event);
      if (handled) {
        break;
      }
    }
  }

  /**
   * Adds a new overlay (e.g., crosshair). 
   */
  public addLayer(id: string, layer: SliceLayer): void {
    if (this.layersMap.has(id)) {
      console.warn(`Layer with id "${id}" already exists. Skipping addition.`);
      return;
    }
    this.layersMap.set(id, layer);
    this.layers.push(layer);
    layer.initialize();
    // Set current position so the layer renders immediately
    layer.setPosition(this.model.currentCoord);
    // Ensure the overlay becomes visible immediately
    this.renderSlice();
  }

  /**
   * Removes an overlay layer by id (e.g., 'crosshair').
   */
  public removeLayer(id: string): void {
    const layer = this.layersMap.get(id);
    if (!layer) return;
    try {
      layer.dispose();
    } catch {
      // ignore
    }
    this.layersMap.delete(id);
    const idx = this.layers.indexOf(layer);
    if (idx >= 0) this.layers.splice(idx, 1);
    // re-render to reflect removal
    this.renderSlice();
  }

  /**
   * Get the coordinate transformer for this view
   */
  public getCoordinateTransformer(): ICoordinateTransformer {
    return this.coordinateTransformer;
  }

  /**
   * Get the canvas element
   */
  public getCanvas(): HTMLCanvasElement {
    if (this.canvas) {
      return this.canvas;
    }
    const fallback = (this.app as any).canvas || (this.app as any).view;
    if (!fallback) {
      throw new Error("PIXI Application canvas is not available");
    }
    return fallback as HTMLCanvasElement;
  }

  /**
   * Add a pointer move event listener
   */
  public addPointerMoveListener(handler: PointerEventHandler): void {
    this.app.stage.on('pointermove', handler);
  }

  /**
   * Add a pointer down event listener
   */
  public addPointerDownListener(handler: PointerEventHandler): void {
    this.app.stage.on('pointerdown', handler);
  }

  /**
   * Remove a pointer move event listener
   */
  public removePointerMoveListener(handler: PointerEventHandler): void {
    this.app.stage.off('pointermove', handler);
  }

  /**
   * Remove a pointer down event listener
   */
  public removePointerDownListener(handler: PointerEventHandler): void {
    this.app.stage.off('pointerdown', handler);
  }

  /**
   * Get the width of the view
   */
  public get width(): number {
    return this.app.renderer.width;
  }

  /**
   * Get the height of the view
   */
  public get height(): number {
    return this.app.renderer.height;
  }

  /**
   * Set the zoom level, clamped to [MIN_ZOOM, MAX_ZOOM].
   */
  public setZoom(level: number): void {
    this.zoomLevel = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, level));
    this.fitContainerToScreen();
    if (this.app.renderer && typeof this.app.renderer.render === 'function') {
      this.app.renderer.render(this.app.stage);
    }
  }

  /**
   * Get the current zoom level.
   */
  public getZoom(): number {
    return this.zoomLevel;
  }

  /**
   * Set the pan offset.
   */
  public setPan(offset: { x: number; y: number }): void {
    this.panOffset = { x: offset.x, y: offset.y };
    this.fitContainerToScreen();
    if (this.app.renderer && typeof this.app.renderer.render === 'function') {
      this.app.renderer.render(this.app.stage);
    }
  }

  /**
   * Get the current pan offset.
   */
  public getPan(): { x: number; y: number } {
    return { ...this.panOffset };
  }

  /**
   * Reset zoom to 1.0 and pan to (0, 0).
   */
  public resetView(): void {
    this.zoomLevel = 1.0;
    this.panOffset = { x: 0, y: 0 };
    this.fitContainerToScreen();
    if (this.app.renderer && typeof this.app.renderer.render === 'function') {
      this.app.renderer.render(this.app.stage);
    }
  }

  /**
   * Get the current scale applied to the slice content.
   */
  public getScale(): number {
    return this.mainContainer ? this.mainContainer.scale.x : 1;
  }

  /**
   * Cleanup
   */
  public dispose(): void {
    // Clean up ResizeObserver
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Clean up reactions
    this.disposers.forEach(disposer => disposer());

    // Dispose layers
    this.layers.forEach(layer => layer.dispose());
    this.layers = [];

    this.mainContainer.destroy({ children: true });
    this.app.destroy(true, { children: true });

    if (this.canvas && this.domElement.contains(this.canvas)) {
      this.domElement.removeChild(this.canvas);
    }
    this.canvas = null;

    // Remove slider
    if (this.slider && this.slider.parentElement) {
      this.slider.parentElement.removeChild(this.slider);
    }
  }
}

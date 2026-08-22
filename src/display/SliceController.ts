// File: src/display/SliceController.ts

import { makeObservable, observable, action } from 'mobx';
import { SliceModel } from './SliceModel';
import { SliceView } from './SliceView';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { AxisSet3D } from '../geometry/Axis';
import { ISliceController } from './interfaces/index';
import { rafThrottle } from './utils/debounce';
import { SlicePointerEvent } from './types/display';

/**
 * The SliceController handles user input events related to slice navigation.
 * - We track mouse movement to update mouse coordinates (image, voxel, world).
 * - We handle mouse clicks to update the model's crosshair coordinate,
 *   causing the slice to re-center or reslice as appropriate.
 */
export class SliceController implements ISliceController {
  private model: SliceModel;
  private view: SliceView;    
  private neuroSpace: NeuroSpace;
  private viewAxes: AxisSet3D;
  private sliderHandler?: (ev: Event) => void;

  /**
   * (1) The local 2D slice coordinate [x, y], in the "slice" plane (pixels).
   */
  @observable public mouseImagePosition: { x: number; y: number } | null = null;

  /**
   * (2) The pinned-volume coordinate [i, j, k] in **voxel** space,
   *     as returned by sliceToVolumeCoord(...).
   *     This might be fractional if partial pixels are selected.
   */
  @observable public mouseVolumeCoordinate: number[] | null = null;

  /**
   * (3) The original "world" coordinate [X, Y, Z] in real-world mm,
   *     i.e. un-pinned "raw" NeuroSpace.
   */
  @observable public mouseWorldCoordinate: number[] | null = null;

  private enabled: boolean = true;
  private throttledPointerMove!: (event: SlicePointerEvent) => void;

  // Pan state
  private isPanning: boolean = false;
  private panStart: { x: number; y: number } = { x: 0, y: 0 };
  private panOffsetStart: { x: number; y: number } = { x: 0, y: 0 };

  // Bound handlers for cleanup
  private boundOnWheel!: (e: WheelEvent) => void;
  private boundOnDblClick!: () => void;
  private boundOnCanvasPointerDown!: (e: PointerEvent) => void;
  private boundOnCanvasPointerMove!: (e: PointerEvent) => void;
  private boundOnCanvasPointerUp!: (e: PointerEvent) => void;

  constructor(
    model: SliceModel,
    view: SliceView,
    neuroSpace: NeuroSpace,
    viewAxes: AxisSet3D
  ) {
    this.model = model;
    this.view = view;
    this.neuroSpace = neuroSpace;
    this.viewAxes = viewAxes;

    makeObservable(this);
    this.initialize();
  }

  private initialize() {
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);

    // Create throttled version of pointer move for performance
    this.throttledPointerMove = rafThrottle(this.onPointerMove);

    // Enable pointer events
    this.view.app.stage.interactive = true;
    this.view.app.stage.on('pointermove', this.throttledPointerMove);
    this.view.app.stage.on('pointerdown', this.onPointerDown);

    // Attach wheel, double-click, and pan handlers to the canvas element
    const canvas = this.view.getCanvas();

    this.boundOnWheel = this.onWheel.bind(this);
    canvas.addEventListener('wheel', this.boundOnWheel, { passive: false });

    this.boundOnDblClick = this.onDblClick.bind(this);
    canvas.addEventListener('dblclick', this.boundOnDblClick);

    this.boundOnCanvasPointerDown = this.onCanvasPointerDown.bind(this);
    this.boundOnCanvasPointerMove = this.onCanvasPointerMove.bind(this);
    this.boundOnCanvasPointerUp = this.onCanvasPointerUp.bind(this);
    canvas.addEventListener('pointerdown', this.boundOnCanvasPointerDown);
    canvas.addEventListener('pointermove', this.boundOnCanvasPointerMove);
    canvas.addEventListener('pointerup', this.boundOnCanvasPointerUp);

    // Listen to slider changes (if present)
    if (this.view.slider) {
      this.sliderHandler = (ev: Event) => {
        const val = parseInt((ev.target as HTMLInputElement).value, 10);
        this.model.setCurrentSliceIndex(val);
      };
      this.view.slider.addEventListener('input', this.sliderHandler);
    }
  }

  /**
   * Wheel handler: plain scroll = slice navigation, Ctrl/Meta+scroll = zoom.
   */
  private onWheel(e: WheelEvent): void {
    if (!this.enabled) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Zoom
      const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = this.view.getZoom() * zoomDelta;
      this.view.setZoom(newZoom);
    } else {
      // Slice scroll
      if (e.deltaY > 0) {
        this.model.nextSlice();
      } else if (e.deltaY < 0) {
        this.model.previousSlice();
      }
    }
  }

  /**
   * Double-click resets zoom/pan to default.
   */
  private onDblClick(): void {
    if (!this.enabled) return;
    this.view.resetView();
  }

  /**
   * Middle-mouse button down starts panning.
   */
  private onCanvasPointerDown(e: PointerEvent): void {
    if (!this.enabled) return;
    // Middle mouse button (button === 1)
    if (e.button === 1) {
      e.preventDefault();
      this.isPanning = true;
      this.panStart = { x: e.clientX, y: e.clientY };
      this.panOffsetStart = this.view.getPan();
    }
  }

  /**
   * Update pan offset while middle-mouse is held.
   */
  private onCanvasPointerMove(e: PointerEvent): void {
    if (!this.enabled || !this.isPanning) return;
    const dx = e.clientX - this.panStart.x;
    const dy = e.clientY - this.panStart.y;
    this.view.setPan({
      x: this.panOffsetStart.x + dx,
      y: this.panOffsetStart.y + dy,
    });
  }

  /**
   * End panning on pointer up.
   */
  private onCanvasPointerUp(_e: PointerEvent): void {
    this.isPanning = false;
  }

  /**
   * Called whenever the mouse moves. We compute:
   *   A) imageCoord = screen -> local slice (pixels)
   *   B) volCoord   = slice -> pinned voxel coords
   *   C) worldCoord = slice -> original world mm
   */
  private onPointerMove(rawEvent: SlicePointerEvent): void {
    if (!this.enabled) return;
    const globalPoint = rawEvent.global || (rawEvent.data && rawEvent.data.global);
    if (!globalPoint) return;
    const { x, y } = globalPoint;

    // 1) screen => local slice
    const imageCoord = this.view.coordinateTransformer.screenToImageCoord(
      x, y, this.view.mainContainer
    );
    const isFiniteImage = Number.isFinite(imageCoord.x) && Number.isFinite(imageCoord.y);
    if (isFiniteImage) {
      this.setMouseImagePosition(imageCoord);
    } else {
      this.setMouseImagePosition({ x: 0, y: 0 });
    }

    // 2) slice => pinned voxel (safe, with clamping)
    const volCoordSafe = this.view.coordinateTransformer.sliceToVolumeCoordSafe(imageCoord, { clamp: true });
    if (volCoordSafe && volCoordSafe.every(Number.isFinite)) {
      this.setMouseVolumeCoordinate(volCoordSafe);
      // 3) voxel => world mm using neuroSpace
      const world = this.neuroSpace.gridToCoord(volCoordSafe);
      this.setMouseWorldCoordinate(world);
    } else {
      this.setMouseVolumeCoordinate([ ] as unknown as number[]);
      this.setMouseWorldCoordinate([ ] as unknown as number[]);
    }
  }

  /**
   * Called when user clicks => set the model's crosshair coordinate in mm.
   */
  private onPointerDown(rawEvent: SlicePointerEvent): void {
    if (!this.enabled) return;
    const globalPoint = rawEvent.global || (rawEvent.data && rawEvent.data.global);
    if (!globalPoint) return;
    const { x, y } = globalPoint;
    const imageCoord = this.view.coordinateTransformer.screenToImageCoord(
      x, y, this.view.mainContainer
    );
    if (!imageCoord) return;

    // slice => pinned voxel
    const volCoord_voxel = this.view.coordinateTransformer.sliceToVolumeCoord(imageCoord);

    // Convert pinned voxel => real-world mm, because SliceModel expects mm coords
    const mmCoord = this.neuroSpace.gridToCoord(volCoord_voxel);

    // Now set the crosshair coordinate in mm
    this.model.setCurrentCoord(mmCoord);
  }

  @action
  private setMouseImagePosition(pos: { x: number; y: number }) {
    this.mouseImagePosition = pos;
  }

  @action
  private setMouseVolumeCoordinate(coord: number[]) {
    // pinned voxel coords
    this.mouseVolumeCoordinate = coord.slice();
  }

  @action
  private setMouseWorldCoordinate(coord: number[]) {
    // raw mm coords
    this.mouseWorldCoordinate = coord.slice();
  }

  /**
   * Enable or disable the controller
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if the controller is enabled
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Cleans up event listeners.
   */
  public dispose(): void {
    this.view.app.stage.off('pointermove', this.throttledPointerMove);
    this.view.app.stage.off('pointerdown', this.onPointerDown);

    // Remove canvas event listeners
    const canvas = this.view.getCanvas();
    canvas.removeEventListener('wheel', this.boundOnWheel);
    canvas.removeEventListener('dblclick', this.boundOnDblClick);
    canvas.removeEventListener('pointerdown', this.boundOnCanvasPointerDown);
    canvas.removeEventListener('pointermove', this.boundOnCanvasPointerMove);
    canvas.removeEventListener('pointerup', this.boundOnCanvasPointerUp);

    // Remove slider event listener if it was added
    if (this.view.slider && this.sliderHandler) {
      this.view.slider.removeEventListener('input', this.sliderHandler);
      this.sliderHandler = undefined;
    }
  }
}

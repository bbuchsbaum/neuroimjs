// File: src/display/IntensityReadout.ts

import * as PIXI from 'pixi.js';
import { SliceLayer } from './SliceLayer';
import { AxisSet3D } from '../geometry/Axis';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { CoordinateTransformer } from './CoordinateTransformer';
import { VolStack } from './VolStack';
import { SlicePointerEvent } from './types/display';

/**
 * Options for the IntensityReadout layer.
 */
export interface IntensityReadoutOptions {
  /** Where to display the text: fixed corner or following cursor */
  position?: 'bottom-left' | 'top-right' | 'cursor';
  /** Font size in pixels */
  fontSize?: number;
  /** Text color */
  color?: number;
  /** Background color behind the text (set alpha to 0 to disable) */
  backgroundColor?: number;
  /** Background alpha */
  backgroundAlpha?: number;
  /** Padding in pixels */
  padding?: number;
}

/**
 * IntensityReadout is a SliceLayer that displays the voxel intensity value
 * under the cursor as a text overlay. It reads the value from the primary
 * VolLayer in the VolStack.
 */
export class IntensityReadout implements SliceLayer {
  public neuroSpace: NeuroSpace;
  private volStack: VolStack;
  private coordinateTransformer: CoordinateTransformer;
  private container: PIXI.Container;
  private textDisplay: PIXI.Text;
  private background: PIXI.Graphics;
  private options: Required<IntensityReadoutOptions>;
  private currentCoord: number[] = [];
  private viewAxes!: AxisSet3D;
  private currentSliceIndex: number = 0;
  private lastIntensity: number | null = null;
  private lastImageCoord: { x: number; y: number } | null = null;

  constructor(
    neuroSpace: NeuroSpace,
    volStack: VolStack,
    coordinateTransformer: CoordinateTransformer,
    options?: IntensityReadoutOptions
  ) {
    this.neuroSpace = neuroSpace;
    this.volStack = volStack;
    this.coordinateTransformer = coordinateTransformer;
    this.options = {
      position: options?.position ?? 'bottom-left',
      fontSize: options?.fontSize ?? 12,
      color: options?.color ?? 0xffffff,
      backgroundColor: options?.backgroundColor ?? 0x000000,
      backgroundAlpha: options?.backgroundAlpha ?? 0.6,
      padding: options?.padding ?? 4,
    };

    this.container = new PIXI.Container();
    this.background = new PIXI.Graphics();
    this.textDisplay = new PIXI.Text('', {
      fontSize: this.options.fontSize,
      fill: this.options.color,
      fontFamily: 'monospace',
    } as any);

    this.container.addChild(this.background);
    this.container.addChild(this.textDisplay);
  }

  initialize(): void {
    // no-op
  }

  renderSlice(
    sliceIndex: number,
    coord: number[],
    viewAxes: AxisSet3D,
    _parentContainer: PIXI.Container
  ): PIXI.Container | null {
    this.currentSliceIndex = sliceIndex;
    this.currentCoord = coord;
    this.viewAxes = viewAxes;
    this.updateDisplay();
    return this.container;
  }

  setPosition(coord: number[]): void {
    this.currentCoord = coord;
  }

  onPointerMove(event: SlicePointerEvent): boolean {
    const globalPoint = (event as any).global || (event as any).data?.global;
    if (globalPoint) {
      this.lastImageCoord = { x: globalPoint.x, y: globalPoint.y };
    }
    return false; // Don't consume the event
  }

  onPointerDown(_event: SlicePointerEvent): boolean {
    return false;
  }

  /**
   * Update the text display with the current intensity value.
   * Called externally by the controller or view when mouse moves.
   */
  public updateIntensity(
    volumeCoord: number[] | null,
    imageCoord?: { x: number; y: number } | null
  ): void {
    if (imageCoord) {
      this.lastImageCoord = imageCoord;
    }

    if (!volumeCoord || volumeCoord.length < 3) {
      this.lastIntensity = null;
      this.updateDisplay();
      return;
    }

    // Read intensity from the primary layer (index 0)
    try {
      const primaryLayer = this.volStack.getLayer(0);
      const vol = primaryLayer.volume;
      const i = Math.round(volumeCoord[0]);
      const j = Math.round(volumeCoord[1]);
      const k = Math.round(volumeCoord[2]);
      const dims = vol.dim;

      if (i >= 0 && i < dims[0] && j >= 0 && j < dims[1] && k >= 0 && k < dims[2]) {
        const linearIndex = i + j * dims[0] + k * dims[0] * dims[1];
        this.lastIntensity = vol.get(linearIndex);
      } else {
        this.lastIntensity = null;
      }
    } catch {
      this.lastIntensity = null;
    }

    this.updateDisplay();
  }

  private updateDisplay(): void {
    if (this.lastIntensity === null) {
      this.textDisplay.text = '';
      this.background.clear();
      return;
    }

    // Format the intensity value
    const value = Number.isInteger(this.lastIntensity)
      ? this.lastIntensity.toString()
      : this.lastIntensity.toFixed(2);
    this.textDisplay.text = `Val: ${value}`;

    // Draw background
    const pad = this.options.padding;
    const tw = this.textDisplay.width;
    const th = this.textDisplay.height;

    this.background.clear();
    (this.background as any).beginFill(this.options.backgroundColor, this.options.backgroundAlpha);
    (this.background as any).drawRoundedRect(-pad, -pad, tw + pad * 2, th + pad * 2, 3);
    (this.background as any).endFill();
  }

  dispose(): void {
    this.container.destroy({ children: true });
  }
}

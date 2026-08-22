/**
 * Factory for creating viewer components with dependency injection
 */

import { SliceModel } from './SliceModel';
import { SliceView } from './SliceView';
import { SliceController } from './SliceController';
import { SliceViewer } from './SliceViewer';
import { ImageLayer } from './ImageLayer';
import { OrthogonalImageViewer } from './OrthogonalImageViewer';
import { AxisSet3D } from '../geometry/Axis';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { ISliceModel, ISliceView, ISliceController } from './interfaces/index';

export interface ViewerOptions {
  width?: number;
  height?: number;
  showCrosshair?: boolean;
  showSlider?: boolean;
}

/**
 * Factory class for creating viewer components
 */
export class ViewerFactory {
  /**
   * Create a SliceModel instance
   */
  static createSliceModel(
    totalSlices: number,
    initialCoord: number[],
    neuroSpace: NeuroSpace,
    viewAxes: AxisSet3D
  ): ISliceModel {
    return new SliceModel(totalSlices, initialCoord, neuroSpace, viewAxes);
  }

  /**
   * Create a SliceView instance
   */
  static async createSliceView(
    domElement: HTMLElement,
    imageLayer: ImageLayer,
    neuroSpace: NeuroSpace,
    viewAxes: AxisSet3D,
    model: ISliceModel,
    options?: ViewerOptions
  ): Promise<ISliceView> {
    // Cast to concrete type for creation
    const concreteModel = model as SliceModel;
    return await SliceView.create(
      domElement,
      imageLayer,
      neuroSpace,
      viewAxes,
      concreteModel,
      options
    );
  }

  /**
   * Create a SliceController instance
   */
  static createSliceController(
    model: ISliceModel,
    view: ISliceView,
    neuroSpace: NeuroSpace,
    viewAxes: AxisSet3D
  ): ISliceController {
    // Cast to concrete types for creation
    const concreteModel = model as SliceModel;
    const concreteView = view as SliceView;
    return new SliceController(
      concreteModel,
      concreteView,
      neuroSpace,
      viewAxes
    );
  }

  /**
   * Create a complete SliceViewer with all components
   */
  static async createSliceViewer(
    domElement: HTMLElement,
    imageLayer: ImageLayer,
    viewAxes: AxisSet3D,
    options?: ViewerOptions
  ): Promise<SliceViewer> {
    return await SliceViewer.create(
      domElement,
      imageLayer,
      viewAxes,
      options
    );
  }

  /**
   * Create an OrthogonalImageViewer with multiple SliceViewers
   * (This is a placeholder - OrthogonalImageViewer would need similar refactoring)
   */
  static async createOrthogonalViewer(
    domElement: HTMLElement,
    imageLayer: ImageLayer,
    options?: ViewerOptions
  ): Promise<OrthogonalImageViewer> {
    return OrthogonalImageViewer.create({
      container: domElement,
      imageLayer,
      options: {
        showCrosshair: options?.showCrosshair,
        showSlider: options?.showSlider,
        width: options?.width,
        height: options?.height,
      },
    });
  }
}

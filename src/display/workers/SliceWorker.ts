/**
 * Web Worker for offloading slice computation
 * This worker handles heavy slice extraction and processing operations
 */

import { 
  WorkerRequestData, 
  WorkerResponseData,
  ExtractSliceData,
  ProcessSliceData,
  ResampleData,
  ProcessParams,
  SliceOperation,
  isExtractSliceData,
  isProcessSliceData,
  isResampleData
} from '../types/display';

// Worker message types
export interface SliceWorkerRequest {
  id: string;
  type: 'extractSlice' | 'processSlice' | 'resample';
  data: WorkerRequestData;
}

export interface SliceWorkerResponse {
  id: string;
  type: 'result' | 'error' | 'progress';
  data?: WorkerResponseData;
  error?: string;
  progress?: number;
}

// Define the worker context type
declare const self: Worker;

// Worker implementation
if (typeof self !== 'undefined' && 'postMessage' in self) {

  // Handle incoming messages
  self.addEventListener('message', (event: MessageEvent<SliceWorkerRequest>) => {
    const { id, type, data } = event.data;

    try {
      switch (type) {
        case 'extractSlice':
          if (isExtractSliceData(data)) {
            handleExtractSlice(id, data);
          } else {
            sendError(id, 'Invalid data for extractSlice');
          }
          break;

        case 'processSlice':
          if (isProcessSliceData(data)) {
            handleProcessSlice(id, data);
          } else {
            sendError(id, 'Invalid data for processSlice');
          }
          break;

        case 'resample':
          if (isResampleData(data)) {
            handleResample(id, data);
          } else {
            sendError(id, 'Invalid data for resample');
          }
          break;

        default:
          sendError(id, `Unknown request type: ${type}`);
      }
    } catch (error) {
      sendError(id, error instanceof Error ? error.message : String(error));
    }
  });
  
  /**
   * Extract a slice from volume data
   */
  function handleExtractSlice(id: string, data: ExtractSliceData): void {
    const { volumeData, dimensions, sliceIndex, axis, spacing } = data;
    
    // Send progress
    sendProgress(id, 0);
    
    // Calculate slice dimensions
    const sliceDims = dimensions.filter((_, i) => i !== axis);
    const sliceSize = sliceDims.reduce((a, b) => a * b, 1);
    const sliceData = new Float32Array(sliceSize);
    
    // Extract slice data
    const strides = calculateStrides(dimensions);
    const sliceStrides = strides.filter((_, i) => i !== axis);
    
    for (let i = 0; i < sliceSize; i++) {
      // Calculate position in slice
      const sliceCoords = indexToCoords(i, sliceDims);
      
      // Insert slice index at the appropriate axis
      const volumeCoords = [...sliceCoords];
      volumeCoords.splice(axis, 0, sliceIndex);
      
      // Get value from volume
      const volumeIndex = coordsToIndex(volumeCoords, strides);
      sliceData[i] = volumeData[volumeIndex];
      
      // Update progress
      if (i % 1000 === 0) {
        sendProgress(id, (i / sliceSize) * 100);
      }
    }
    
    // Create ImageData
    const width = sliceDims[0];
    const height = sliceDims[1];
    const imageData = new ImageData(width, height);
    
    // Convert to RGBA (assuming grayscale for now)
    for (let i = 0; i < sliceSize; i++) {
      const value = Math.floor(sliceData[i] * 255);
      const idx = i * 4;
      imageData.data[idx] = value;     // R
      imageData.data[idx + 1] = value; // G
      imageData.data[idx + 2] = value; // B
      imageData.data[idx + 3] = 255;   // A
    }
    
    sendResult(id, {
      imageData: imageData,
      width,
      height,
      spacing: sliceDims.map((_, i) => spacing[i < axis ? i : i + 1]) as [number, number]
    });
  }
  
  /**
   * Process a slice with filters or transformations
   */
  function handleProcessSlice(id: string, data: ProcessSliceData): void {
    const { imageData, operation, params } = data;
    
    sendProgress(id, 0);
    
    let result: ImageData;
    
    switch (operation) {
      case 'blur':
        result = applyGaussianBlur(imageData, params.radius || 1);
        break;
        
      case 'sharpen':
        result = applySharpen(imageData, params.strength || 1);
        break;
        
      case 'edge':
        result = applyEdgeDetection(imageData, params.threshold || 50);
        break;
        
      case 'threshold':
        result = applyThreshold(imageData, params.min || 0, params.max || 255);
        break;
        
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
    
    sendResult(id, { imageData: result });
  }
  
  /**
   * Resample slice data
   */
  function handleResample(id: string, data: ResampleData): void {
    const { imageData, targetWidth, targetHeight, method } = data;
    
    sendProgress(id, 0);
    
    const result = new ImageData(targetWidth, targetHeight);
    const scaleX = imageData.width / targetWidth;
    const scaleY = imageData.height / targetHeight;
    
    for (let y = 0; y < targetHeight; y++) {
      for (let x = 0; x < targetWidth; x++) {
        const srcX = x * scaleX;
        const srcY = y * scaleY;
        
        let r, g, b, a;
        
        switch (method) {
          case 'nearest':
            [r, g, b, a] = getNearestPixel(imageData, srcX, srcY);
            break;
            
          case 'bilinear':
            [r, g, b, a] = getBilinearPixel(imageData, srcX, srcY);
            break;
            
          case 'bicubic':
            [r, g, b, a] = getBicubicPixel(imageData, srcX, srcY);
            break;
        }
        
        const idx = (y * targetWidth + x) * 4;
        result.data[idx] = r;
        result.data[idx + 1] = g;
        result.data[idx + 2] = b;
        result.data[idx + 3] = a;
      }
      
      sendProgress(id, (y / targetHeight) * 100);
    }
    
    sendResult(id, { imageData: result });
  }
  
  // Utility functions
  
  function calculateStrides(dimensions: number[]): number[] {
    const strides = new Array(dimensions.length);
    strides[dimensions.length - 1] = 1;
    
    for (let i = dimensions.length - 2; i >= 0; i--) {
      strides[i] = strides[i + 1] * dimensions[i + 1];
    }
    
    return strides;
  }
  
  function indexToCoords(index: number, dimensions: number[]): number[] {
    const coords = new Array(dimensions.length);
    let remaining = index;
    
    for (let i = 0; i < dimensions.length; i++) {
      coords[i] = remaining % dimensions[i];
      remaining = Math.floor(remaining / dimensions[i]);
    }
    
    return coords;
  }
  
  function coordsToIndex(coords: number[], strides: number[]): number {
    let index = 0;
    for (let i = 0; i < coords.length; i++) {
      index += coords[i] * strides[i];
    }
    return index;
  }
  
  // Image processing functions
  
  function applyGaussianBlur(imageData: ImageData, radius: number): ImageData {
    // Simple box blur approximation for performance
    const result = new ImageData(imageData.width, imageData.height);
    const { width, height, data } = imageData;
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0, a = 0, count = 0;
        
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const idx = (ny * width + nx) * 4;
              r += data[idx];
              g += data[idx + 1];
              b += data[idx + 2];
              a += data[idx + 3];
              count++;
            }
          }
        }
        
        const idx = (y * width + x) * 4;
        result.data[idx] = r / count;
        result.data[idx + 1] = g / count;
        result.data[idx + 2] = b / count;
        result.data[idx + 3] = a / count;
      }
    }
    
    return result;
  }
  
  function applySharpen(imageData: ImageData, strength: number): ImageData {
    const kernel = [
      0, -1, 0,
      -1, 4 + strength, -1,
      0, -1, 0
    ];
    return applyConvolution(imageData, kernel, 3);
  }
  
  function applyEdgeDetection(imageData: ImageData, threshold: number): ImageData {
    const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
    
    const gx = applyConvolution(imageData, sobelX, 3);
    const gy = applyConvolution(imageData, sobelY, 3);
    
    const result = new ImageData(imageData.width, imageData.height);
    
    for (let i = 0; i < gx.data.length; i += 4) {
      const magnitude = Math.sqrt(
        gx.data[i] * gx.data[i] + gy.data[i] * gy.data[i]
      );
      
      const value = magnitude > threshold ? 255 : 0;
      result.data[i] = value;
      result.data[i + 1] = value;
      result.data[i + 2] = value;
      result.data[i + 3] = 255;
    }
    
    return result;
  }
  
  function applyThreshold(imageData: ImageData, min: number, max: number): ImageData {
    const result = new ImageData(imageData.width, imageData.height);
    
    for (let i = 0; i < imageData.data.length; i += 4) {
      const gray = 0.299 * imageData.data[i] + 
                   0.587 * imageData.data[i + 1] + 
                   0.114 * imageData.data[i + 2];
      
      const value = (gray >= min && gray <= max) ? 255 : 0;
      result.data[i] = value;
      result.data[i + 1] = value;
      result.data[i + 2] = value;
      result.data[i + 3] = imageData.data[i + 3];
    }
    
    return result;
  }
  
  function applyConvolution(imageData: ImageData, kernel: number[], size: number): ImageData {
    const result = new ImageData(imageData.width, imageData.height);
    const { width, height, data } = imageData;
    const half = Math.floor(size / 2);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0;
        
        for (let ky = 0; ky < size; ky++) {
          for (let kx = 0; kx < size; kx++) {
            const nx = x + kx - half;
            const ny = y + ky - half;
            
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const idx = (ny * width + nx) * 4;
              const kidx = ky * size + kx;
              
              r += data[idx] * kernel[kidx];
              g += data[idx + 1] * kernel[kidx];
              b += data[idx + 2] * kernel[kidx];
            }
          }
        }
        
        const idx = (y * width + x) * 4;
        result.data[idx] = Math.max(0, Math.min(255, r));
        result.data[idx + 1] = Math.max(0, Math.min(255, g));
        result.data[idx + 2] = Math.max(0, Math.min(255, b));
        result.data[idx + 3] = data[idx + 3];
      }
    }
    
    return result;
  }
  
  // Resampling functions
  
  function getNearestPixel(imageData: ImageData, x: number, y: number): [number, number, number, number] {
    const ix = Math.round(x);
    const iy = Math.round(y);
    const idx = (iy * imageData.width + ix) * 4;
    
    return [
      imageData.data[idx],
      imageData.data[idx + 1],
      imageData.data[idx + 2],
      imageData.data[idx + 3]
    ];
  }
  
  function getBilinearPixel(imageData: ImageData, x: number, y: number): [number, number, number, number] {
    const x0 = Math.floor(x);
    const x1 = Math.ceil(x);
    const y0 = Math.floor(y);
    const y1 = Math.ceil(y);
    
    const fx = x - x0;
    const fy = y - y0;
    
    const p00 = getPixel(imageData, x0, y0);
    const p10 = getPixel(imageData, x1, y0);
    const p01 = getPixel(imageData, x0, y1);
    const p11 = getPixel(imageData, x1, y1);
    
    return [
      lerp(lerp(p00[0], p10[0], fx), lerp(p01[0], p11[0], fx), fy),
      lerp(lerp(p00[1], p10[1], fx), lerp(p01[1], p11[1], fx), fy),
      lerp(lerp(p00[2], p10[2], fx), lerp(p01[2], p11[2], fx), fy),
      lerp(lerp(p00[3], p10[3], fx), lerp(p01[3], p11[3], fx), fy)
    ];
  }
  
  function getBicubicPixel(imageData: ImageData, x: number, y: number): [number, number, number, number] {
    // Simplified bicubic for performance
    return getBilinearPixel(imageData, x, y);
  }
  
  function getPixel(imageData: ImageData, x: number, y: number): [number, number, number, number] {
    x = Math.max(0, Math.min(imageData.width - 1, x));
    y = Math.max(0, Math.min(imageData.height - 1, y));
    
    const idx = (y * imageData.width + x) * 4;
    return [
      imageData.data[idx],
      imageData.data[idx + 1],
      imageData.data[idx + 2],
      imageData.data[idx + 3]
    ];
  }
  
  function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }
  
  // Message sending utilities
  
  function sendResult(id: string, data: WorkerResponseData): void {
    const response: SliceWorkerResponse = {
      id,
      type: 'result',
      data
    };
    self.postMessage(response);
  }
  
  function sendError(id: string, error: string): void {
    const response: SliceWorkerResponse = {
      id,
      type: 'error',
      error
    };
    self.postMessage(response);
  }
  
  function sendProgress(id: string, progress: number): void {
    const response: SliceWorkerResponse = {
      id,
      type: 'progress',
      progress
    };
    self.postMessage(response);
  }
}
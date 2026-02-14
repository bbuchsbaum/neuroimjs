/**
 * 3D Kernel implementation for spatial convolution operations
 */

import { Kernel3D as IKernel3D } from './ISpatialFilter';

/**
 * Implementation of 3D kernel for convolution operations
 */
export class Kernel3D implements IKernel3D {
  data: number[][][];
  size: [number, number, number];

  constructor(data: number[][][]) {
    this.data = data;
    this.size = [data.length, data[0].length, data[0][0].length];
    
    // Validate dimensions
    for (let i = 0; i < data.length; i++) {
      if (data[i].length !== this.size[1]) {
        throw new Error('Inconsistent kernel dimensions');
      }
      for (let j = 0; j < data[i].length; j++) {
        if (data[i][j].length !== this.size[2]) {
          throw new Error('Inconsistent kernel dimensions');
        }
      }
    }
  }

  /**
   * Normalize the kernel so weights sum to 1
   */
  normalize(): Kernel3D {
    let sum = 0;
    for (let i = 0; i < this.size[0]; i++) {
      for (let j = 0; j < this.size[1]; j++) {
        for (let k = 0; k < this.size[2]; k++) {
          sum += this.data[i][j][k];
        }
      }
    }

    if (sum === 0) {
      return this; // Can't normalize zero kernel
    }

    const normalized = this.data.map(plane =>
      plane.map(row =>
        row.map(val => val / sum)
      )
    );

    return new Kernel3D(normalized);
  }

  /**
   * Get weight at specific position
   */
  getWeight(i: number, j: number, k: number): number {
    if (i < 0 || i >= this.size[0] || 
        j < 0 || j >= this.size[1] || 
        k < 0 || k >= this.size[2]) {
      return 0;
    }
    return this.data[i][j][k];
  }

  /**
   * Create a Gaussian kernel
   */
  static gaussian(sigma: number | [number, number, number], size?: number): Kernel3D {
    const sigmaX = Array.isArray(sigma) ? sigma[0] : sigma;
    const sigmaY = Array.isArray(sigma) ? sigma[1] : sigma;
    const sigmaZ = Array.isArray(sigma) ? sigma[2] : sigma;

    // Determine kernel size if not provided
    if (!size) {
      const maxSigma = Math.max(sigmaX, sigmaY, sigmaZ);
      size = Math.ceil(maxSigma * 6) | 1; // Make it odd
    }

    const center = Math.floor(size / 2);
    const data: number[][][] = [];

    for (let i = 0; i < size; i++) {
      data[i] = [];
      for (let j = 0; j < size; j++) {
        data[i][j] = [];
        for (let k = 0; k < size; k++) {
          const x = i - center;
          const y = j - center;
          const z = k - center;
          
          const weight = Math.exp(
            -(x * x) / (2 * sigmaX * sigmaX) -
            (y * y) / (2 * sigmaY * sigmaY) -
            (z * z) / (2 * sigmaZ * sigmaZ)
          );
          
          data[i][j][k] = weight;
        }
      }
    }

    return new Kernel3D(data).normalize();
  }

  /**
   * Create a box (mean) filter kernel
   */
  static box(size: number): Kernel3D {
    const data: number[][][] = [];
    const weight = 1.0;

    for (let i = 0; i < size; i++) {
      data[i] = [];
      for (let j = 0; j < size; j++) {
        data[i][j] = [];
        for (let k = 0; k < size; k++) {
          data[i][j][k] = weight;
        }
      }
    }

    return new Kernel3D(data).normalize();
  }

  /**
   * Create a spherical kernel
   */
  static sphere(radius: number): Kernel3D {
    const size = 2 * radius + 1;
    const center = radius;
    const data: number[][][] = [];

    for (let i = 0; i < size; i++) {
      data[i] = [];
      for (let j = 0; j < size; j++) {
        data[i][j] = [];
        for (let k = 0; k < size; k++) {
          const x = i - center;
          const y = j - center;
          const z = k - center;
          const distance = Math.sqrt(x * x + y * y + z * z);
          
          data[i][j][k] = distance <= radius ? 1 : 0;
        }
      }
    }

    return new Kernel3D(data).normalize();
  }

  /**
   * Create a Laplacian kernel for edge detection
   */
  static laplacian(): Kernel3D {
    const data = [
      [
        [0, 0, 0],
        [0, 1, 0],
        [0, 0, 0]
      ],
      [
        [0, 1, 0],
        [1, -6, 1],
        [0, 1, 0]
      ],
      [
        [0, 0, 0],
        [0, 1, 0],
        [0, 0, 0]
      ]
    ];

    return new Kernel3D(data);
  }

  /**
   * Create a Sobel kernel for edge detection in specific direction
   */
  static sobel(direction: 'x' | 'y' | 'z'): Kernel3D {
    let data: number[][][];

    switch (direction) {
      case 'x':
        data = [
          [
            [-1, 0, 1],
            [-2, 0, 2],
            [-1, 0, 1]
          ],
          [
            [-2, 0, 2],
            [-4, 0, 4],
            [-2, 0, 2]
          ],
          [
            [-1, 0, 1],
            [-2, 0, 2],
            [-1, 0, 1]
          ]
        ];
        break;
      case 'y':
        data = [
          [
            [-1, -2, -1],
            [0, 0, 0],
            [1, 2, 1]
          ],
          [
            [-2, -4, -2],
            [0, 0, 0],
            [2, 4, 2]
          ],
          [
            [-1, -2, -1],
            [0, 0, 0],
            [1, 2, 1]
          ]
        ];
        break;
      case 'z':
        data = [
          [
            [-1, -2, -1],
            [-2, -4, -2],
            [-1, -2, -1]
          ],
          [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0]
          ],
          [
            [1, 2, 1],
            [2, 4, 2],
            [1, 2, 1]
          ]
        ];
        break;
    }

    return new Kernel3D(data);
  }
}
/**
 * PIXI v8 compatibility types
 * These extend the old @types/pixi.js definitions to include v8 APIs
 */

import * as PIXI from 'pixi.js';

declare module 'pixi.js' {
  interface Graphics {
    setStrokeStyle(options: { width?: number; color?: number; alpha?: number }): this;
    stroke(): this;
    rect(x: number, y: number, width: number, height: number): this;
  }

  interface Texture {
    source?: {
      update(): void;
      resource?: any;
    };
  }

  interface ApplicationOptions {
    autoDensity?: boolean;
  }
}

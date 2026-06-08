import { vi } from 'vitest';

// Mock pixi.js globally for tests to avoid real WebGL/canvas initialization
vi.mock('pixi.js', () => {
  class Texture {
    static EMPTY = new Texture();
    static from(_: any): Texture { return new Texture(); }
    destroy() {}
  }

  class Container {
    children: any[] = [];
    visible = true;
    alpha = 1;
    parent: any = null;
    scale = { x: 1, y: 1, set: (x: number, y?: number) => { this.scale.x = x; this.scale.y = (y ?? x); } } as any;
    position = { x: 0, y: 0, set: (x: number, y: number) => { this.position.x = x; this.position.y = y; } } as any;
    pivot = { x: 0, y: 0, set: (x: number, y: number) => { this.pivot.x = x; this.pivot.y = y; } } as any;
    rotation = 0;
    addChild(child: any) { child.parent = this; this.children.push(child); return child; }
    removeChild(child: any) { this.children = this.children.filter(c => c !== child); child.parent = null; }
    removeChildren() { this.children.forEach(c => c.parent = null); this.children = []; }
    getLocalBounds() { return { x: 0, y: 0, width: 100, height: 100 }; }
    on() {}
    off() {}
    destroy(_: any = {}) { this.removeChildren(); }
  }

  class Graphics extends Container {
    // PIXI v7 / legacy API
    lineStyle(_: number, __?: number, ___?: number) { return this; }
    moveTo(_: number, __: number) { return this; }
    lineTo(_: number, __: number) { return this; }
    beginFill(_?: number, __?: number) { return this; }
    drawRect(_: number, __: number, ___: number, ____: number) { return this; }
    endFill() { return this; }
    // PIXI v8 API
    setStrokeStyle(_?: any) { return this; }
    setFillStyle(_?: any) { return this; }
    stroke(_?: any) { return this; }
    fill(_?: any) { return this; }
    rect(_: number, __: number, ___: number, ____: number) { return this; }
    roundRect(_: number, __: number, ___: number, ____: number, _____?: number) { return this; }
    circle(_: number, __: number, ___: number) { return this; }
    ellipse(_: number, __: number, ___: number, ____: number) { return this; }
    poly(_: number[]) { return this; }
    arc(_: number, __: number, ___: number, ____: number, _____: number) { return this; }
    closePath() { return this; }
  }

  class Sprite extends Container {
    texture: any = Texture.EMPTY;
    anchor = { x: 0, y: 0, set: (x: number, y: number) => { this.anchor.x = x; this.anchor.y = y; } } as any;
    tint = 0xFFFFFF;
    constructor(texture?: any) { super(); if (texture) this.texture = texture; }
  }

  class TextStyle {
    constructor(public style: any = {}) { Object.assign(this, style); }
  }

  class Text extends Container {
    text: string;
    style: any;
    anchor = { x: 0, y: 0, set: (x: number, y: number) => { this.anchor.x = x; this.anchor.y = y; } } as any;
    // Support both the v8 options form `new Text({ text, style })` and the
    // legacy positional form `new Text(text, style)` used throughout the code.
    constructor(textOrOptions?: any, style?: any) {
      super();
      if (textOrOptions && typeof textOrOptions === 'object' && 'text' in textOrOptions) {
        this.text = String(textOrOptions.text ?? '');
        this.style = textOrOptions.style ?? {};
      } else {
        this.text = textOrOptions != null ? String(textOrOptions) : '';
        this.style = style ?? {};
      }
    }
  }

  class Application {
    renderer: any;
    stage: any;
    canvas?: HTMLCanvasElement;
    view?: HTMLCanvasElement;
    constructor(options?: any) {
      this.stage = new Container();
      this.renderer = { width: options?.width ?? 800, height: options?.height ?? 600, resize: (w: number, h: number) => { this.renderer.width = w; this.renderer.height = h; } };
      // v7-style property
      if (typeof document !== 'undefined') {
        this.view = document.createElement('canvas');
      }
    }
    async init(options: any) {
      this.renderer = { width: options?.width ?? 800, height: options?.height ?? 600, resize: (w: number, h: number) => { this.renderer.width = w; this.renderer.height = h; } };
      if (typeof document !== 'undefined') {
        this.canvas = document.createElement('canvas');
      }
      return this;
    }
    destroy(_: any = {}) {}
  }

  return { Texture, Container, Graphics, Sprite, Text, TextStyle, Application };
});

// Mock canvas module
vi.mock('canvas', () => ({
  createCanvas: (width: number, height: number) => {
    const canvas = {
      width,
      height,
      getContext: vi.fn((contextType: string) => {
        if (contextType === '2d') {
          return {
            putImageData: vi.fn(),
            drawImage: vi.fn(),
            getImageData: vi.fn(() => new (window as any).ImageData(width, height)),
            clearRect: vi.fn(),
            fillRect: vi.fn(),
            strokeRect: vi.fn(),
            fillText: vi.fn(),
            strokeText: vi.fn(),
            beginPath: vi.fn(),
            closePath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            arc: vi.fn(),
            fill: vi.fn(),
            stroke: vi.fn(),
            save: vi.fn(),
            restore: vi.fn(),
            translate: vi.fn(),
            rotate: vi.fn(),
            scale: vi.fn(),
            setTransform: vi.fn(),
            createLinearGradient: vi.fn(),
            createRadialGradient: vi.fn(),
            createPattern: vi.fn(),
            measureText: vi.fn(() => ({ width: 0 })),
            font: '10px sans-serif',
            fillStyle: '#000000',
            strokeStyle: '#000000',
            lineWidth: 1,
            lineCap: 'butt',
            lineJoin: 'miter',
            globalAlpha: 1,
            globalCompositeOperation: 'source-over',
          };
        }
        return null;
      }),
      toBuffer: vi.fn((callback: Function) => {
        callback(null, Buffer.from([]));
      }),
      toDataURL: vi.fn(() => 'data:image/png;base64,'),
    };
    return canvas;
  },
  createImageData: (widthOrData: number | Uint8ClampedArray, heightOrWidth?: number, height?: number) => {
    if (typeof widthOrData === 'number') {
      // createImageData(width, height)
      const width = widthOrData;
      const h = heightOrWidth!;
      const data = new Uint8ClampedArray(width * h * 4);
      return {
        width,
        height: h,
        data,
        colorSpace: 'srgb' as PredefinedColorSpace
      };
    } else {
      // createImageData(data, width, height)
      const data = widthOrData;
      const width = heightOrWidth!;
      const h = height!;
      return {
        width,
        height: h,
        data,
        colorSpace: 'srgb' as PredefinedColorSpace
      };
    }
  },
  ImageData: class ImageData {
    width: number;
    height: number;
    data: Uint8ClampedArray;
    colorSpace: PredefinedColorSpace;
    
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
      this.data = new Uint8ClampedArray(width * height * 4);
      this.colorSpace = 'srgb';
    }
  }
}));

// Mock window.ImageData if not available
if (typeof window !== 'undefined' && !window.ImageData) {
  (window as any).ImageData = class ImageData {
    width: number;
    height: number;
    data: Uint8ClampedArray;
    colorSpace: PredefinedColorSpace;
    
    constructor(arg1: number | Uint8ClampedArray, arg2?: number, arg3?: number) {
      if (arg1 instanceof Uint8ClampedArray) {
        this.data = arg1;
        this.width = arg2!;
        this.height = arg3!;
      } else {
        this.width = arg1;
        this.height = arg2!;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      }
      this.colorSpace = 'srgb';
    }
  };
}

// Enhance document.createElement if it exists
if (typeof document !== 'undefined' && document.createElement) {
  const originalCreateElement = document.createElement.bind(document);
  
  // Override createElement to provide mocked canvas methods
  (document as any).createElement = function(tag: string) {
    const element = originalCreateElement(tag);
    
    if (tag === 'canvas') {
      // Mock the getContext method on the real canvas element
      vi.spyOn(element, 'getContext').mockImplementation((contextType: string) => {
        if (contextType === '2d') {
          return {
            putImageData: vi.fn(),
            drawImage: vi.fn(),
            getImageData: vi.fn(() => new (window as any).ImageData(1, 1)),
            clearRect: vi.fn(),
            fillRect: vi.fn(),
            strokeRect: vi.fn(),
            fillText: vi.fn(),
            strokeText: vi.fn(),
            beginPath: vi.fn(),
            closePath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            arc: vi.fn(),
            fill: vi.fn(),
            stroke: vi.fn(),
            save: vi.fn(),
            restore: vi.fn(),
            translate: vi.fn(),
            rotate: vi.fn(),
            scale: vi.fn(),
            setTransform: vi.fn(),
            createLinearGradient: vi.fn(),
            createRadialGradient: vi.fn(),
            createPattern: vi.fn(),
            measureText: vi.fn(() => ({ width: 0 })),
            font: '10px sans-serif',
            fillStyle: '#000000',
            strokeStyle: '#000000',
            lineWidth: 1,
            lineCap: 'butt',
            lineJoin: 'miter',
            globalAlpha: 1,
            globalCompositeOperation: 'source-over',
          };
        }
        return null;
      });
    }
    
    return element;
  };
}

global.window = global.window || {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
  ImageData: (global as any).ImageData || class ImageData {
    width: number;
    height: number;
    data: Uint8ClampedArray;
    colorSpace: PredefinedColorSpace;
    
    constructor(arg1: number | Uint8ClampedArray, arg2?: number, arg3?: number) {
      if (arg1 instanceof Uint8ClampedArray) {
        this.data = arg1;
        this.width = arg2!;
        this.height = arg3!;
      } else {
        this.width = arg1;
        this.height = arg2!;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      }
      this.colorSpace = 'srgb';
    }
  }
} as any;

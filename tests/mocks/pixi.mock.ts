import { vi } from 'vitest';

// Create a factory function to generate fresh mocks for each test
export function createPixiMock() {
  // Create a real canvas element using jsdom's document
  const createMockCanvas = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    
    // Return the actual canvas element - jsdom will handle getContext
    return canvas;
  };

  // Create mock PIXI objects
  const mockContainer = () => {
    const container = {
      children: [] as any[],
      addChild: vi.fn(function(this: any, child: any) {
        this.children.push(child);
        child.parent = this;
        return child;
      }),
      removeChild: vi.fn(function(this: any, child: any) {
        const index = this.children.indexOf(child);
        if (index > -1) {
          this.children.splice(index, 1);
          child.parent = null;
        }
        return child;
      }),
      removeChildren: vi.fn(function(this: any) {
        this.children.forEach((child: any) => {
          child.parent = null;
        });
        this.children = [];
      }),
      position: { 
        set: vi.fn(),
        x: 0,
        y: 0
      },
      scale: { 
        set: vi.fn(),
        x: 1,
        y: 1
      },
      pivot: { 
        set: vi.fn(),
        x: 0,
        y: 0
      },
      toLocal: vi.fn((point) => point),
      getLocalBounds: vi.fn(() => ({ x: 0, y: 0, width: 100, height: 100 })),
      interactive: true,
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      parent: null,
      visible: true,
      alpha: 1,
      width: 0,
      height: 0,
      destroy: vi.fn(),
    };
    
    return container;
  };

  const mockSprite = function(this: any, texture?: any) {
    this.position = { 
      set: vi.fn(),
      x: 0,
      y: 0
    };
    this.scale = { 
      set: vi.fn(),
      x: 1,
      y: 1
    };
    this.pivot = { 
      set: vi.fn(),
      x: 0,
      y: 0
    };
    this.anchor = {
      set: vi.fn(),
      x: 0,
      y: 0
    };
    this.alpha = 1;
    this.texture = texture || null;
    this.destroy = vi.fn();
    this.visible = true;
    this.width = 0;
    this.height = 0;
    this.rotation = 0;
    this.tint = 0xFFFFFF;
    this.parent = null;
  };

  const mockGraphics = () => ({
    clear: vi.fn().mockReturnThis(),
    lineStyle: vi.fn().mockReturnThis(),
    moveTo: vi.fn().mockReturnThis(),
    lineTo: vi.fn().mockReturnThis(),
    beginFill: vi.fn().mockReturnThis(),
    drawRect: vi.fn().mockReturnThis(),
    drawCircle: vi.fn().mockReturnThis(),
    endFill: vi.fn().mockReturnThis(),
    position: { 
      set: vi.fn(),
      x: 0,
      y: 0
    },
    visible: true,
    alpha: 1,
    destroy: vi.fn(),
  });

  const mockText = () => ({
    position: { 
      set: vi.fn(),
      x: 0,
      y: 0
    },
    text: '',
    style: {},
    visible: true,
    alpha: 1,
    destroy: vi.fn(),
  });

  // Create the main Application mock as a class with proper prototype
  class MockApplication {
    public canvas: any;
    public view: any;
    public renderer: any;
    public stage: any;
    public ticker: any;
    public screen: any;

    constructor() {
      const canvas = createMockCanvas();
      const stage = mockContainer();

      this.canvas = undefined; // Will be set after init
      this.view = undefined; // Will be set after init
      this.renderer = {
        resize: vi.fn(),
        render: vi.fn(),
        backgroundColor: 0x000000,
        width: 400,
        height: 400,
        options: {},
      };
      this.stage = stage;
      this.ticker = {
        add: vi.fn(),
        remove: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      this.screen = {
        width: 400,
        height: 400,
      };

      // Store canvas reference for init
      (this as any)._mockCanvas = canvas;
    }

    async init() {
      // After init, the canvas property should be available
      this.canvas = (this as any)._mockCanvas;
      this.view = (this as any)._mockCanvas;
      return Promise.resolve();
    }

    destroy() {
      // Mock destroy
    }
  }

  // Create a proper Sprite constructor for instanceof to work
  const SpriteConstructor = vi.fn(mockSprite);

  // Return the complete PIXI mock
  return {
    Application: MockApplication,
    Container: vi.fn().mockImplementation(mockContainer),
    Sprite: SpriteConstructor,
    Graphics: vi.fn().mockImplementation(mockGraphics),
    Text: vi.fn().mockImplementation(mockText),
    TextStyle: vi.fn().mockImplementation((style) => ({ ...style })),
    Texture: Object.assign(
      vi.fn().mockImplementation((source) => ({
        source,
        width: 100,
        height: 100,
        baseTexture: { width: 100, height: 100 },
        destroy: vi.fn(),
      })),
      {
        // Static method: Texture.from()
        from: vi.fn().mockImplementation((source) => ({
          source,
          width: 100,
          height: 100,
          baseTexture: { width: 100, height: 100 },
          destroy: vi.fn(),
        }))
      }
    ),
    BaseTexture: vi.fn().mockImplementation((source) => ({ 
      source,
      width: 100,
      height: 100,
      destroy: vi.fn(),
    })),
    CanvasSource: vi.fn().mockImplementation(({ resource }) => ({ 
      resource,
      width: 100,
      height: 100,
    })),
    Point: vi.fn().mockImplementation((x = 0, y = 0) => ({ x, y })),
    Rectangle: vi.fn().mockImplementation((x = 0, y = 0, width = 0, height = 0) => ({ 
      x, y, width, height,
      contains: vi.fn(),
    })),
    FederatedPointerEvent: vi.fn().mockImplementation(() => ({
      global: { x: 0, y: 0 },
      screen: { x: 0, y: 0 },
      movement: { x: 0, y: 0 },
      local: { x: 0, y: 0 },
      target: null,
      currentTarget: null,
      type: 'pointermove',
      data: {},
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    })),
    utils: {
      EventEmitter: vi.fn(),
    },
  };
}

// Export a function to set up the mock
export function setupPixiMock() {
  vi.mock('pixi.js', () => createPixiMock());
}
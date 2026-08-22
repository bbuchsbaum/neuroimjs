import chroma from 'chroma-js';
import { ColorMap } from './ColorMap';
import type { Color } from './ColorMap';

/** Convert the normalized RGB(A) tuples used by ColorMap into chroma's GL color space. */
function tupleToHex(color: Color): string {
  return chroma.gl(color[0], color[1], color[2], color[3] ?? 1).hex();
}

/**
 * Configuration for creating preset color maps
 */
export interface PresetConfig {
  name: string;
  range?: [number, number];
  threshold?: [number, number];
  alpha?: number | number[];
}

/**
 * Factory class for creating ColorMap instances
 */
export class ColorMapFactory {
  private static _presetMaps: Map<string, string[]> = new Map();
  private static _initialized = false;

  /**
   * Initialize preset color maps
   */
  private static initializePresets(): void {
    if (this._initialized) return;

    const presetNames = [
      'OrRd', 'PuBu', 'BuPu', 'Oranges', 'BuGn', 'YlOrBr', 'YlGn',
      'Reds', 'RdPu', 'Greens', 'YlGnBu', 'Purples', 'GnBu', 'Greys',
      'YlOrRd', 'PuRd', 'Blues', 'PuBuGn', 'Viridis', 'Spectral',
      'RdYlGn', 'RdBu', 'PiYG', 'PRGn', 'RdYlBu', 'BrBG', 'RdGy',
      'PuOr', 'Set2', 'Accent', 'Set1', 'Set3', 'Dark2', 'Paired',
      'Pastel2', 'Pastel1'
    ];

    for (const name of presetNames) {
      try {
        const colors = this.generatePresetColors(name);
        this._presetMaps.set(name, colors);
      } catch (error) {
        // Skip invalid presets silently
      }
    }

    // Add grayscale preset
    const grayscaleColors = Array.from({ length: 256 }, (_, i) => {
      const v = i / 255;
      return chroma(v, v, v).hex();
    });
    this._presetMaps.set('Grayscale', grayscaleColors);

    this._initialized = true;
  }

  /**
   * Generate colors for a preset using chroma-js
   */
  private static generatePresetColors(name: string): string[] {
    const brewerScale = chroma.brewer[name as keyof typeof chroma.brewer];
    if (!brewerScale) {
      throw new Error(`Unknown preset: ${name}`);
    }
    
    // Convert to LCH mode for smoother transitions
    return chroma.scale(brewerScale).mode('lch').colors(256);
  }

  /**
   * Create a grayscale ColorMap
   */
  static createGrayscale(config?: Partial<PresetConfig>): ColorMap {
    const colors: Color[] = Array.from({ length: 256 }, (_, i) => {
      const v = i / 255;
      return [v, v, v] as Color;
    });

    return new ColorMap(colors, {
      name: 'Grayscale',
      range: config?.range || [0, 1],
      threshold: config?.threshold || [0, 0],
      alpha: config?.alpha
    });
  }

  /**
   * Create a hot ColorMap (black -> red -> yellow -> white)
   */
  static createHot(config?: Partial<PresetConfig>): ColorMap {
    const colors: Color[] = Array.from({ length: 256 }, (_, i) => {
      const v = i / 255;
      let r = 0, g = 0, b = 0;
      
      if (v < 0.33) {
        // Black to red
        r = v * 3;
      } else if (v < 0.66) {
        // Red to yellow
        r = 1;
        g = (v - 0.33) * 3;
      } else {
        // Yellow to white
        r = 1;
        g = 1;
        b = (v - 0.66) * 3;
      }
      
      return [r, g, b] as Color;
    });

    return new ColorMap(colors, {
      name: 'Hot',
      range: config?.range || [0, 1],
      threshold: config?.threshold || [0, 0],
      alpha: config?.alpha
    });
  }

  /**
   * Create a ColorMap from a preset name
   */
  static fromPreset(presetName: string, config?: Partial<PresetConfig>): ColorMap {
    this.initializePresets();

    const presetColors = this._presetMaps.get(presetName);
    if (!presetColors) {
      throw new Error(`Unknown preset: ${presetName}`);
    }

    // Convert hex colors to Color tuples
    const colors: Color[] = presetColors.map(hex => {
      const rgb = chroma(hex).rgb();
      return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255] as Color;
    });

    return new ColorMap(colors, {
      name: presetName,
      range: config?.range || [0, 1],
      threshold: config?.threshold || [0, 0],
      alpha: config?.alpha
    });
  }

  /**
   * Create a ColorMap from a custom color array
   */
  static fromColors(colors: (string | Color)[], config?: Partial<PresetConfig>): ColorMap {
    // Convert all colors to Color format
    const normalizedColors: Color[] = colors.map(color => {
      if (typeof color === 'string') {
        const rgb = chroma(color).rgb();
        return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255] as Color;
      }
      return color;
    });

    return new ColorMap(normalizedColors, {
      name: config?.name || 'Custom',
      range: config?.range || [0, 1],
      threshold: config?.threshold || [0, 0],
      alpha: config?.alpha
    });
  }

  /**
   * Create a ColorMap with a linear gradient between two colors
   */
  static createGradient(
    startColor: string | Color, 
    endColor: string | Color, 
    steps: number = 256,
    config?: Partial<PresetConfig>
  ): ColorMap {
    const start = typeof startColor === 'string' ? startColor : tupleToHex(startColor);
    const end = typeof endColor === 'string' ? endColor : tupleToHex(endColor);
    
    const colors: Color[] = chroma.scale([start, end]).mode('lch').colors(steps).map(hex => {
      const rgb = chroma(hex).rgb();
      return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255] as Color;
    });

    return new ColorMap(colors, {
      name: config?.name || 'Gradient',
      range: config?.range || [0, 1],
      threshold: config?.threshold || [0, 0],
      alpha: config?.alpha
    });
  }

  /**
   * Create a ColorMap with multiple color stops
   */
  static createMultiStop(
    colorStops: (string | Color)[], 
    steps: number = 256,
    config?: Partial<PresetConfig>
  ): ColorMap {
    const hexStops = colorStops.map(color => 
      typeof color === 'string' ? color : tupleToHex(color)
    );
    
    const colors: Color[] = chroma.scale(hexStops).mode('lch').colors(steps).map(hex => {
      const rgb = chroma(hex).rgb();
      return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255] as Color;
    });

    return new ColorMap(colors, {
      name: config?.name || 'MultiStop',
      range: config?.range || [0, 1],
      threshold: config?.threshold || [0, 0],
      alpha: config?.alpha
    });
  }

  /**
   * Get list of available preset names
   */
  static getAvailablePresets(): string[] {
    this.initializePresets();
    return Array.from(this._presetMaps.keys());
  }

  /**
   * Create a ColorMap suitable for label/cluster data
   */
  static createCategorical(numCategories: number, config?: Partial<PresetConfig>): ColorMap {
    // Use Set1 or Set3 for categorical data
    const baseColors = numCategories <= 9 
      ? chroma.brewer.Set1 
      : chroma.brewer.Set3;
    
    const colors: Color[] = chroma.scale(baseColors)
      .mode('lch')
      .colors(numCategories)
      .map(hex => {
        const rgb = chroma(hex).rgb();
        return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255] as Color;
      });

    return new ColorMap(colors, {
      name: config?.name || 'Categorical',
      range: config?.range || [0, numCategories - 1],
      threshold: config?.threshold || [0, 0],
      alpha: config?.alpha
    });
  }

  /**
   * Create a diverging ColorMap (good for data with a meaningful center point)
   */
  static createDiverging(
    negativeColor: string | Color = '#0000ff',
    neutralColor: string | Color = '#ffffff', 
    positiveColor: string | Color = '#ff0000',
    steps: number = 256,
    config?: Partial<PresetConfig>
  ): ColorMap {
    const neg = typeof negativeColor === 'string' ? negativeColor : tupleToHex(negativeColor);
    const neu = typeof neutralColor === 'string' ? neutralColor : tupleToHex(neutralColor);
    const pos = typeof positiveColor === 'string' ? positiveColor : tupleToHex(positiveColor);
    
    const colors: Color[] = chroma.scale([neg, neu, pos])
      .mode('lch')
      .colors(steps)
      .map(hex => {
        const rgb = chroma(hex).rgb();
        return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255] as Color;
      });

    return new ColorMap(colors, {
      name: config?.name || 'Diverging',
      range: config?.range || [-1, 1],
      threshold: config?.threshold || [0, 0],
      alpha: config?.alpha
    });
  }
}

import mitt, { Emitter } from 'mitt';
import chroma from 'chroma-js';

/**
 * Configuration options for creating or modifying a ColorMap.
 */
interface ColorMapOptions {
  /**
   * The numerical range of the data that will be mapped to the color scale.
   * Values below the minimum map to the first color, and values above the
   * maximum map to the last color.
   * 
   * Default is [0, 1].
   */
  range?: [number, number];

  /**
   * A [low, high] pair specifying a "thresholding" region. Data values
   * strictly inside this region become fully transparent, while values
   * outside are displayed as normal. If `low >= high`, thresholding is disabled.
   * 
   * Default is [0, 0] (meaning no thresholding).
   */
  threshold?: [number, number];

  /**
   * Overall alpha/opacity setting for the color map. This can be:
   *   - A single number (0..1) applied to all colors equally.
   *   - An array of length equal to the number of color stops, specifying
   *     alpha per color stop (0..1).
   * 
   * Default is undefined (no change to alpha in the provided colors).
   */
  alpha?: number | number[];

  /**
   * A human-readable name for the color map (e.g., "Viridis" or "Custom").
   * Used for referencing or debugging. Defaults to "Custom".
   */
  name?: string;
}

/**
 * A single color entry in the color map, specified as either
 *   - [R, G, B]  or
 *   - [R, G, B, A]
 * with components in the range [0..1].
 */
type Color = [number, number, number] | [number, number, number, number];

/**
 * Events that can be emitted by the ColorMap class, for reactive updates:
 *   - "rangeChanged": fired after setRange() calls
 *   - "thresholdChanged": fired after setThreshold() calls
 *   - "alphaChanged": fired after setAlpha() calls
 */
type ColorMapEvents = {
  rangeChanged: [number, number];
  thresholdChanged: [number, number];
  alphaChanged: [boolean];
};

/**
 * Numeric arrays that this class can handle for colorization, e.g. in fillImageData().
 */
type NumericTypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

/**
 * Range validation result
 */
interface RangeValidation {
  isValid: boolean;
  range: [number, number];
  warnings?: string[];
}

/**
 * Validates a range for use in ColorMap
 */
export class RangeValidator {
  static validate(range?: [number, number]): RangeValidation {
    const warnings: string[] = [];
    
    // Check if range is provided and has correct format
    if (!Array.isArray(range) || range.length !== 2 || !range.every(v => typeof v === 'number')) {
      return {
        isValid: false,
        range: [0, 1],
        warnings: ['Invalid range format. Using default range [0, 1].']
      };
    }

    const [min, max] = range;

    // Check for non-finite values
    if (!isFinite(min) || !isFinite(max)) {
      return {
        isValid: false,
        range: [0, 1],
        warnings: ['Range contains non-finite values. Using default range [0, 1].']
      };
    }

    // Check for valid min/max relationship
    if (min >= max) {
      return {
        isValid: false,
        range: [0, 1],
        warnings: ['Range minimum must be less than maximum. Using default range [0, 1].']
      };
    }

    // Check for extremely large ranges (potential data type issues)
    const rangeSpan = max - min;
    if (rangeSpan > 1e9) {
      warnings.push(`Very large range span detected: ${rangeSpan}. This may indicate a data type issue.`);
    }

    return {
      isValid: true,
      range: [min, max],
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }
}

/**
 * ColorMap is responsible for mapping numerical data to colors (RGB or RGBA).
 * It supports:
 *   - Setting a [min, max] range that is scaled into the color ramp.
 *   - Thresholding a [low, high] band for full transparency.
 *   - Optional alpha array or global alpha for transparency control.
 */
export class ColorMap {
  private colors: Color[];               // Internal list of colors forming the palette
  private _hasAlpha: boolean;            // Whether the color map includes alpha
  private range: [number, number] = [0, 1];
  private threshold: [number, number] = [0, 0];
  private emitter: Emitter<ColorMapEvents>;
  public name: string;                   // A label for the color map (e.g., "Grayscale")
  public isCustom: boolean;              // True if name === "Custom"

  /**
   * Constructs a ColorMap with given colors and optional configuration.
   * @param colors An array of color entries. Each color is [R, G, B] or [R, G, B, A] in [0..1].
   * @param options Additional settings for range, threshold, alpha, etc.
   */
  constructor(colors: Color[], options: ColorMapOptions = {}) {
    if (!Array.isArray(colors) || colors.length === 0) {
      throw new TypeError('Colors must be a non-empty array');
    }

    // Verify that every color in the array has the same length (3 or 4).
    const firstColorLength = colors[0].length;
    if (!colors.every(color => color.length === firstColorLength)) {
      throw new TypeError('All colors must have the same format (either RGB or RGBA)');
    }

    this.emitter = mitt<ColorMapEvents>();
    this.colors = colors.map(color => this.parseColor(color));
    // If the first color is RGBA, we assume all are RGBA
    this._hasAlpha = this.colors[0].length === 4;

    this.setRange(options.range);
    this.setThreshold(options.threshold);

    if (options.alpha !== undefined) {
      this.setAlpha(options.alpha);
    }

    // If no name is provided, default to "Custom"
    this.name = options.name || 'Custom';
    this.isCustom = (this.name === 'Custom');
  }

  /**
   * A built-in static ColorMap instance from black to white. This is
   * commonly used as a baseline or fallback map.
   */
  public static readonly GRAY_SCALE: ColorMap = new ColorMap(
    Array.from({ length: 256 }, (_, i) => [i / 255, i / 255, i / 255] as Color),
    { range: [0, 1], threshold: [0, 0], alpha: 1, name: 'Grayscale' }
  );

  /**
   * Subscribe to color map events such as "rangeChanged," "thresholdChanged," or "alphaChanged."
   * @param type The event name, e.g. `'rangeChanged'`.
   * @param handler Function to call when the event fires.
   */
  on<K extends keyof ColorMapEvents>(type: K, handler: (args: ColorMapEvents[K]) => void): void {
    this.emitter.on(type, handler);
  }

  /**
   * Unsubscribe from color map events.
   * @param type The event name.
   * @param handler The specific function to remove.
   */
  off<K extends keyof ColorMapEvents>(type: K, handler: (args: ColorMapEvents[K]) => void): void {
    this.emitter.off(type, handler);
  }

  /**
   * Returns the raw internal array of color stops used for mapping.
   * Useful if you want to examine or iterate over the color map in detail.
   */
  getColorMap(): Color[] {
    return this.colors;
  }

  /**
   * Sets the data range [min, max] for color mapping. Data below min maps
   * to the first color, data above max maps to the last color.
   * @param range The [min, max] values; if invalid, defaults to [0, 1].
   */
  setRange(range?: [number, number]): void {
    const validation = RangeValidator.validate(range);
    
    if (validation.warnings) {
      // In production, we might want to use a proper logging system
      // For now, we'll store warnings but not log to console
    }

    this.range = validation.range;
    this.emitter.emit('rangeChanged', this.range);
  }

  /**
   * Sets the threshold values [low, high]. Data strictly between
   * low and high is fully transparent, outside that region is fully
   * visible. If low >= high, thresholding is disabled.
   * @param threshold The new threshold values; default [0, 0] (no threshold).
   */
  setThreshold(threshold?: [number, number]): void {
    if (
      Array.isArray(threshold) &&
      threshold.length === 2 &&
      threshold.every(v => typeof v === 'number') &&
      threshold[0] <= threshold[1]
    ) {
      this.threshold = threshold;
    } else {
      this.threshold = [0, 0];
    }
    this.emitter.emit('thresholdChanged', this.threshold);
  }

  /**
   * Gets the current range
   */
  getRange(): [number, number] {
    return [...this.range] as [number, number];
  }

  /**
   * Gets the current threshold
   */
  getThreshold(): [number, number] {
    return [...this.threshold] as [number, number];
  }

  /**
   * Internal helper to ensure a color is in [R,G,B] or [R,G,B,A] numeric form.
   * Accepts hex strings (e.g. "#ff0000") or numeric arrays.
   */
  private parseColor(color: string | number[]): Color {
    if (typeof color === 'string' && color.startsWith('#')) {
      return this.hexToRgb(color);
    }
    if (
      Array.isArray(color) &&
      (color.length === 3 || color.length === 4) &&
      color.every(v => typeof v === 'number')
    ) {
      return color as Color;
    }
    throw new TypeError('Invalid color format');
  }

  /**
   * Convert a hex color string "#rrggbb" or "#rrggbbaa" to an RGBA or RGB array in [0..1].
   */
  private hexToRgb(hex: string): Color {
    hex = hex.replace(/^#/, '');
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;

    // Handle alpha channel if present
    if (hex.length === 8) {
      const a = parseInt(hex.slice(6, 8), 16) / 255;
      return [r, g, b, a];
    }
    return [r, g, b];
  }

  /**
   * Sets a global alpha or per-color alpha array. Rebuilds the internal
   * color array to ensure alpha is included if any is provided.
   * @param alpha Either a single alpha in [0..1] or an array of length
   *              = number of colors, or undefined to preserve the current alpha.
   */
  setAlpha(alpha?: number | number[]): void {
    if (alpha === undefined) {
      // No change — remain with existing alpha (if any).
      this._hasAlpha = this.colors[0].length === 4;
      return;
    }

    // If the user provides a single alpha
    if (typeof alpha === 'number' && alpha >= 0 && alpha <= 1) {
      this.colors = this.colors.map(color =>
        color.length === 3 ? [...color, alpha] : [color[0], color[1], color[2], alpha]
      );
    }
    // Or if the user provides an array matching the color length
    else if (
      Array.isArray(alpha) &&
      alpha.length === this.colors.length &&
      alpha.every(v => typeof v === 'number' && v >= 0 && v <= 1)
    ) {
      this.colors = this.colors.map((color, i) =>
        color.length === 3
          ? [...color, alpha[i]]
          : [color[0], color[1], color[2], alpha[i]]
      );
    } else {
      throw new TypeError('Invalid alpha parameter');
    }

    this._hasAlpha = true;
    this.emitter.emit('alphaChanged', [this._hasAlpha]);
  }

  /**
   * Maps a single numeric data value to a color, applying range scaling
   * and threshold-based transparency if present.
   * @param value The numeric value to map.
   * @returns An [R, G, B] or [R, G, B, A] color (in [0..1]).
   */
  getColor(value: number): Color {
    if (typeof value !== 'number') {
      throw new TypeError('Value must be a number');
    }
    const [min, max] = this.range;
    const [low, high] = this.threshold;

    // Non-finite values (NaN, Infinity) represent "no data" and must render
    // as fully transparent rather than producing a NaN LUT index (opaque black).
    if (!Number.isFinite(value)) {
      return this._hasAlpha ? [0, 0, 0, 0] : [0, 0, 0];
    }

    // Normalize value => [0..1] fraction along the color map.
    // Guard the divisor so a degenerate range (max === min) can't yield NaN.
    const rangeDelta = (max - min) || 1;
    const normalizedValue = (value - min) / rangeDelta;
    const index = Math.min(
      Math.max(
        Math.floor(normalizedValue * (this.colors.length - 1)),
        0
      ),
      this.colors.length - 1
    );
    let color = this.colors[index];

    // If threshold is non-empty, values strictly between low and high are transparent
    if (low < high) {
      if (value > low && value < high) {
        // Within threshold => fully transparent
        return this._hasAlpha
          ? [color[0], color[1], color[2], 0]
          : [color[0], color[1], color[2]];
      } else {
        // Outside threshold => keep color as is
        return this._hasAlpha
          ? [color[0], color[1], color[2], color[3]!]
          : (color.slice(0, 3) as Color);
      }
    } else {
      // No thresholding
      return this._hasAlpha
        ? [color[0], color[1], color[2], color[3]!]
        : (color.slice(0, 3) as Color);
    }
  }

  /**
   * Fills a provided ImageData object with RGBA values derived from this color map.
   * @param imageData An ImageData object to fill.
   * @param values A numerical array or TypedArray of the same length as the
   *               number of pixels in imageData.
   * @returns The modified ImageData (same object).
   */
  fillImageData(imageData: ImageData, values: number[] | NumericTypedArray): ImageData {
    const data = imageData.data;
    const [min, max] = this.range;
    const [low, high] = this.threshold;
    const numColorsMinus1 = this.colors.length - 1;
    const hasAlpha = this._hasAlpha;
    const useThreshold = low < high;
    const rangeDelta = max - min || 1; // Avoid dividing by zero

    // Precompute scaled color channels in [0..255] for performance
    const scaledColors = this.colors.map(color => [
      Math.round(color[0] * 255),                               // R
      Math.round(color[1] * 255),                               // G
      Math.round(color[2] * 255),                               // B
      hasAlpha ? Math.round((color[3] ?? 1) * 255) : 255,       // A
    ]);

    for (let i = 0, len = values.length; i < len; i++) {
      const value = values[i];
      const offset = i * 4;

      // Non-finite values (NaN, Infinity) represent "no data" and must render
      // as fully transparent rather than producing a NaN LUT index, which would
      // write `undefined` (clamped to 0) and yield an opaque black pixel.
      if (!Number.isFinite(value)) {
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
        data[offset + 3] = 0;
        continue;
      }

      const normalizedValue = (value - min) / rangeDelta;
      let index = Math.floor(normalizedValue * numColorsMinus1);
      index = Math.max(0, Math.min(index, numColorsMinus1));

      const color = scaledColors[index];

      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];

      if (useThreshold && value > low && value < high) {
        // Inside threshold => transparent
        data[offset + 3] = 0;
      } else {
        data[offset + 3] = color[3];
      }
    }

    return imageData;
  }

  /**
   * Maps a numeric array to a Float32Array of color components (RGB or RGBA).
   * This is often used for GPU-based rendering or custom shader pipelines.
   * @param values An array or Float32Array of scalar values.
   * @returns A Float32Array of length = values.length * (3 or 4).
   */
  getColorArray(values: number[] | Float32Array): Float32Array {
    if (!(Array.isArray(values) || values instanceof Float32Array) || values.length === 0) {
      throw new TypeError('Values must be a non-empty array or Float32Array');
    }

    const componentsPerColor = this._hasAlpha ? 4 : 3;
    const colorArray = new Float32Array(values.length * componentsPerColor);
    const [min, max] = this.range;
    const [low, high] = this.threshold;

    // Guard the divisor so a degenerate range (max === min) can't yield NaN indices.
    const rangeDelta = (max - min) || 1;

    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      const offset = i * componentsPerColor;

      // Non-finite values (NaN, Infinity) represent "no data" and must render
      // as fully transparent rather than producing a NaN LUT index. The
      // Float32Array is already zero-initialized, so RGB stays 0; explicitly
      // set alpha=0 when present.
      if (!Number.isFinite(value)) {
        colorArray[offset] = 0;
        colorArray[offset + 1] = 0;
        colorArray[offset + 2] = 0;
        if (this._hasAlpha) {
          colorArray[offset + 3] = 0;
        }
        continue;
      }

      const normalizedValue = (value - min) / rangeDelta;
      const index = Math.min(
        Math.max(
          Math.floor(normalizedValue * (this.colors.length - 1)),
          0
        ),
        this.colors.length - 1
      );
      const color = this.colors[index];

      colorArray[offset] = color[0];
      colorArray[offset + 1] = color[1];
      colorArray[offset + 2] = color[2];

      if (this._hasAlpha) {
        // For thresholding, set alpha=0 if strictly within (low,high).
        if (low < high && value > low && value < high) {
          colorArray[offset + 3] = 0;
        } else {
          colorArray[offset + 3] = color[3] ?? 1;
        }
      }
    }

    return colorArray;
  }

  /**
   * Returns an array of color entries for each data value in the input array,
   * i.e., calling getColor() on each value in sequence.
   * @param values A numeric array to map.
   * @returns An array of Colors in [0..1].
   */
  getColors(values: number[]): Color[] {
    if (!Array.isArray(values) || !values.every(v => typeof v === 'number')) {
      throw new TypeError('Values must be an array of numbers');
    }
    return values.map(this.getColor.bind(this));
  }

  /**
   * Indicates whether this color map has an alpha channel (based on
   * the first color or forced by setAlpha()).
   */
  get hasAlpha(): boolean {
    return this._hasAlpha;
  }

  /**
   * Returns the number of color stops in this color map.
   */
  length(): number {
    return this.colors.length;
  }

  /**
   * Creates a new ColorMap as a copy of the current one but with a changed
   * color array or name. Range, threshold, etc. are duplicated from the original.
   * @param newColors The array of new color stops.
   * @param newName Optional new name. Defaults to something like "<oldName> (Copy)".
   */
  copy(newColors: Color[], newName?: string): ColorMap {
    const options: ColorMapOptions = {
      range: this.range,
      threshold: this.threshold,
      name: newName || `${this.name} (Copy)`
    };
    const copiedMap = new ColorMap(newColors, options);
    return copiedMap;
  }

  /**
   * Holds a static dictionary of preset color scales from ColorBrewer via `chroma.js`.
   * This is dynamically populated on first access in `get presetMaps()`.
   */
  private static _presetMaps: { [key: string]: string[] } = {};

  /**
   * Lazy getter for preset colormaps, returning a dictionary from preset name
   * to array of hex color strings. We also add "Grayscale" as a known preset.
   */
  static get presetMaps(): { [key: string]: string[] } {
    if (Object.keys(ColorMap._presetMaps).length === 0) {
      // Initialize once
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
          ColorMap._presetMaps[name] = ColorMap.generatePreset(name);
        } catch (error) {
          // Skip invalid presets silently
        }
      }

      // Add an explicit "Grayscale" from our GRAY_SCALE constant
      ColorMap._presetMaps['Grayscale'] = ColorMap.GRAY_SCALE.colors.map(color => 
        chroma(color[0], color[1], color[2]).hex()
      );
    }
    return ColorMap._presetMaps;
  }

  /**
   * Generates a 256-color scale from the named ColorBrewer scale if available,
   * else defaults to a black-white scale.
   * @param name The scale name, e.g., "Viridis" or "RdYlBu".
   */
  static generatePreset(name: string): string[] {
    // Attempt to look up the named scale in chroma.brewer
    const brewerScale = chroma.brewer[name as keyof typeof chroma.brewer];
    if (brewerScale) {
      // Convert to LCH mode for smoother transitions
      return chroma.scale(brewerScale).mode('lch').colors(256);
    }
    // Silently fallback to grayscale
    return chroma.scale(['#000000', '#FFFFFF']).colors(256);
  }

  /**
   * Retrieves a list of all known preset map names. This includes both
   * official ColorBrewer sets and the "Grayscale" fallback.
   */
  static getAvailableMaps(): string[] {
    return Object.keys(ColorMap.presetMaps);
  }

  /**
   * Returns a new ColorMap using a named preset. If "existingColorMap" is provided
   * and name is "Custom", a copy is created from the existing color map's colors.
   * @param name The preset name (must exist in `ColorMap.presetMaps`).
   * @param options Additional options. If 'existingColorMap' is provided with name="Custom",
   *                a direct copy is performed.
   */
  static fromPreset(
    name: string,
    options: ColorMapOptions & { existingColorMap?: ColorMap } = {}
  ): ColorMap {
    if (name === 'Custom' && options.existingColorMap) {
      return options.existingColorMap.copy(options.existingColorMap.colors, 'Custom');
    }

    if (!ColorMap.presetMaps.hasOwnProperty(name)) {
      throw new Error(`Preset "${name}" not found`);
    }
    const presetColors = ColorMap.presetMaps[name];

    // Convert the array of hex strings to [r,g,b,(a)] in [0..1]
    const colorTuples: Color[] = presetColors.map(color => {
      const rgba = chroma(color).rgba().map(v => v / 255);
      return rgba.length === 4
        ? [rgba[0], rgba[1], rgba[2], rgba[3]]
        : [rgba[0], rgba[1], rgba[2]];
    });

    if (options.existingColorMap instanceof ColorMap) {
      // Copy the new colorTuples but maintain the old color map's range, threshold, etc.
      return options.existingColorMap.copy(colorTuples, name);
    }

    return new ColorMap(colorTuples, { ...options, name });
  }
}
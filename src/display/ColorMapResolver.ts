import { ColorMap } from './ColorMap';
import { ColorMapFactory } from './ColorMapFactory';

/**
 * Resolve a user-provided colormap identifier to a ColorMap instance.
 * - Accepts case-insensitive names.
 * - Supports common aliases: 'gray', 'grey', 'grayscale', 'greys'.
 * - Supports 'hot'.
 * - Falls back to nearest preset name (case-insensitive) or grayscale.
 */
export function resolveColorMap(input: string | ColorMap, existing?: ColorMap): ColorMap {
  if (input instanceof ColorMap) return input;

  const name = (input || '').toString().trim();
  if (!name) return ColorMapFactory.createGrayscale();

  const lower = name.toLowerCase();

  // Common aliases
  if (lower === 'gray' || lower === 'grey' || lower === 'grayscale' || lower === 'greys') {
    return ColorMapFactory.createGrayscale({});
  }
  if (lower === 'hot') {
    return ColorMapFactory.createHot({});
  }

  // Case-insensitive preset matching using factory presets
  try {
    const presets = ColorMapFactory.getAvailablePresets();
    const match = presets.find(p => p.toLowerCase() === lower);
    if (match) {
      return ColorMapFactory.fromPreset(match, {});
    }
  } catch {}

  // Fallback to the ColorMap class' presets
  try {
    const presetNames = (ColorMap as any).getAvailableMaps?.() as string[] | undefined;
    const match = presetNames?.find(p => p.toLowerCase() === lower);
    if (match) {
      // Use ColorMap's own preset generator; keep existing map's settings if provided
      return ColorMap.fromPreset(match, existing ? { existingColorMap: existing } : {});
    }
  } catch {}

  // Last resort
  return ColorMapFactory.createGrayscale({});
}


import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NeuroSpace } from '../geometry/NeuroSpace';
import { FloatNeuroVol } from '../volume/DenseNeuroVol';
import { assertSameVolumeGeometry, getVolumeGeometry } from '../geometry/VolumeGeometry';
import { readNiftiArrayBuffer } from '../io/browserNifti';
import { ColorMap } from '../display/ColorMap';
import { ColorMapFactory } from '../display/ColorMapFactory';
import { VolLayer } from '../display/VolLayer';
import { VolStack } from '../display/VolStack';
import { LayerControlPanel, type LayerControlState } from '../controls/LayerControlPanelLit';

function volume(origin: number[] = [0, 0, 0], fill = 0): FloatNeuroVol {
  const space = new NeuroSpace([4, 5, 6], [2, 2, 2], origin);
  const data = Float32Array.from({ length: 4 * 5 * 6 }, (_, i) => fill + i);
  return new FloatNeuroVol(space, data);
}

describe('VolumeGeometry', () => {
  it('describes a volume grid as JSON-safe metadata', () => {
    const geometry = getVolumeGeometry(volume());
    expect(geometry.dimensions).toEqual([4, 5, 6]);
    expect(geometry.spacing).toEqual([2, 2, 2]);
    expect(geometry.orientation).toHaveLength(3);
    expect(geometry.affine).toHaveLength(4);
    expect(JSON.parse(JSON.stringify(geometry))).toEqual(geometry);
  });

  it('rejects volumes on shifted grids', () => {
    expect(() => assertSameVolumeGeometry(volume(), volume())).not.toThrow();
    expect(() => assertSameVolumeGeometry(volume(), volume([1, 0, 0]))).toThrow(/origin/);
  });

  it('makes VolLayer.replaceVolume fail closed on affine mismatch', () => {
    const layer = new VolLayer('overlay', volume(), ColorMap.fromPreset('Viridis'));
    expect(() => layer.replaceVolume(volume([0, 0, 0], 5))).not.toThrow();
    expect(() => layer.replaceVolume(volume([0, 3, 0]))).toThrow(/^replaceVolume: Volume geometry mismatch/);
  });
});

describe('report colormap presets', () => {
  it('provides BlueRed and Inferno in both preset registries', () => {
    for (const name of ['BlueRed', 'Inferno']) {
      expect(ColorMap.getAvailableMaps()).toContain(name);
      expect(ColorMap.fromPreset(name).name).toBe(name);
    }
    expect(ColorMapFactory.getAvailablePresets()).toEqual(expect.arrayContaining(['BlueRed', 'Inferno']));
    const blueRed = ColorMap.fromPreset('BlueRed').getColorMap();
    const first = blueRed[0];
    const last = blueRed[blueRed.length - 1];
    expect(first[2]).toBeGreaterThan(first[0]); // negative end is blue
    expect(last[0]).toBeGreaterThan(last[2]); // positive end is red
  });
});

describe('readNiftiArrayBuffer', () => {
  const file = resolve(__dirname, '../../tests/data/volumes/tpl-MNI152NLin2009aAsym_res-1_T1w.nii.gz');

  it.skipIf(!existsSync(file))('decodes gzip-compressed NIfTI bytes without Node I/O', () => {
    const bytes = readFileSync(file);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const vol = readNiftiArrayBuffer(buffer);
    expect(vol.space.dim).toHaveLength(3);
    expect(vol.space.dim.every(d => d > 1)).toBe(true);
    expect(() => readNiftiArrayBuffer(buffer, { index: 1 })).toThrow(/outside/);
  });

  it('rejects non-NIfTI input', () => {
    expect(() => readNiftiArrayBuffer(new ArrayBuffer(16))).toThrow(/not a valid NIfTI/);
  });
});

describe('LayerControlPanel programmatic state', () => {
  async function mount(visible: LayerControlPanel['visibleControls'] = null) {
    const background = new VolLayer('background', volume(), ColorMapFactory.createGrayscale(), [0, 100]);
    const overlay = new VolLayer('overlay', volume(), ColorMap.fromPreset('Inferno'), [0, 50], [0, 0], 0.8);
    const panel = new LayerControlPanel();
    panel.visibleControls = visible;
    panel.volStack = new VolStack(background, overlay);
    document.body.appendChild(panel);
    await panel.updateComplete;
    await panel.updateComplete;
    return { panel, overlay };
  }

  it('selects, applies, emits, and resets per-layer state', async () => {
    const { panel, overlay } = await mount();
    panel.selectLayer('overlay');
    const baseline = panel.setDefaultsFromCurrent('overlay');
    expect(baseline).toMatchObject({ layerId: 'overlay', colormap: 'Inferno', opacity: 0.8, visible: true });

    const events: LayerControlState[] = [];
    panel.addEventListener('layer-control-change', e => events.push((e as CustomEvent).detail));
    const next = panel.applyState({ colormap: 'Viridis', opacity: 0.25, range: [1, 9] });
    expect(next).toMatchObject({ colormap: 'Viridis', opacity: 0.25, range: [1, 9] });
    expect(overlay.opacity).toBe(0.25);
    expect(events.at(-1)).toEqual(next);

    expect(() => panel.applyState({ opacity: 2 })).toThrow(/opacity/);
    expect(() => panel.applyState({ range: [5, 1] })).toThrow(/range/);
    expect(() => panel.selectLayer('missing')).toThrow(/Unknown layer id/);

    expect(panel.resetToDefaults('overlay')).toEqual(baseline);
    panel.remove();
  });

  it('labels the alpha row "Opacity" and honours visibleControls', async () => {
    const { panel } = await mount(['range', 'opacity']);
    await panel.updateComplete;
    const root = panel.shadowRoot!;
    expect(root.querySelector('[aria-label="Opacity value"]')).not.toBeNull();
    expect(root.querySelector('[aria-label="Alpha value"]')).toBeNull();
    expect(root.querySelector('[aria-label="Colormap"]')).toBeNull();
    expect(root.querySelector('[aria-label="Threshold low"]')).toBeNull();
    expect(root.querySelector('.reset-btn')).not.toBeNull();

    panel.visibleControls = [];
    await panel.updateComplete;
    expect(root.querySelector('.reset-btn')).toBeNull();
    panel.remove();
  });
});

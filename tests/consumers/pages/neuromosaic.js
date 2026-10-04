/**
 * neuromosaic contract page.
 *
 * Mirrors inst/htmlwidgets/lib/neuromosaic-volume/adapter.js in the
 * neuromosaic R package (adapter_version 1.5.0, vendoring neuroimjs 0.5.0),
 * which loads the UMD bundle as a classic <script> and drives the
 * `window.neuroimjs` global from plain JavaScript. Each step below is a call
 * (or call sequence) the adapter makes, in the order it makes them. Several of
 * the adapter's calls are guarded by `typeof x === "function"`, which means a
 * rename degrades the report silently instead of failing; this page asserts
 * those members exist so the rename fails here instead.
 *
 * TOLERATED INTERNALS — reached by the adapter although they are private in
 * the TypeScript declarations (or absent from them). Renaming any of these
 * breaks neuromosaic even though the public API is unchanged:
 *   - ColorMap._presetMaps (private static): the adapter replaces the whole
 *     preset registry object to curate and reorder the colour-map menu.
 *   - SimpleOrthogonalViewer#viewer (private) -> OrthogonalImageViewer
 *     #getSliceViewer(view).view.app (SliceView#app is not on ISliceView):
 *     PNG export forces a frame with app.renderer.render(app.stage).
 *   - LayerControlPanel private members, wrapped or replaced on the instance:
 *     colormapNamesIncluding, clampToThresholdDomain, readField, fmt,
 *     applyThreshold, syncThresholdLink, onThresholdLowInput,
 *     onThresholdHighInput, onRangeLowInput, onRangeHighInput,
 *     onThresholdUpdate; and private state read or written directly:
 *     threshold, range, volumeRange, thresholdLinked.
 *   - LayerControlPanel shadow DOM: `.section` > `.label` text ("Range",
 *     "Threshold") next to `range-slider` elements whose own shadow roots hold
 *     two input[type=range] and which accept `.step`.
 *   - Viewer DOM: cells marked data-nij-view="axial|coronal|sagittal" (each
 *     holding the view's canvas) and the legend cell marked data-nij-legend.
 *   - Volume construction by `new volume.constructor(volume.space, data)`
 *     with getData() returning that same array (the adapter's fallback path
 *     writes the internal `data` field directly).
 * The adapter also probes SimpleOrthogonalViewer#handleResize, which does
 * not exist in 0.5.0 (the guard makes it a no-op); it is not asserted.
 */
import {
  check,
  encodeNifti1,
  nextFrame,
  runConsumer,
  statVolume,
  underlayVolume,
} from './harness';

const REPORT_PALETTE = 'NM Report';
const HIDDEN_PRESETS = ['Set1', 'Set2', 'Set3', 'Paired', 'Pastel1', 'Greys'];
const BACKGROUND_LAYER_ID = 'background';
const OVERLAY_LAYER_ID = 'overlay';

const GROUNDS = {
  dark: { stage: 0x0b0d12, cross: 0x9fd4ff, crossAlpha: 0.9, halo: 0x000000, haloAlpha: 0.6, label: 0xe8eef7, labelAlpha: 0.9, labelShadow: 0.7 },
  light: { stage: 0xffffff, cross: 0x1f5f8b, crossAlpha: 0.9, halo: 0xffffff, haloAlpha: 0.7, label: 0x1b1f27, labelAlpha: 0.85, labelShadow: 0 },
};

// adapter.js groundTheme()
function groundTheme(ground) {
  const look = GROUNDS[ground];
  return {
    backgroundColor: look.stage,
    crosshair: { crossColor: look.cross, crossAlpha: look.crossAlpha, haloColor: look.halo, haloAlpha: look.haloAlpha },
    orientationLabels: { color: look.label, alpha: look.labelAlpha, shadowAlpha: look.labelShadow },
  };
}

// geometry.js normalizeDecodedGeometry(): the adapter checks every decoded
// asset against the scene's recorded geometry using these fields.
function normalizeDecodedGeometry(decoded) {
  const dimensions = decoded.dimensions || decoded.dims || decoded.shape;
  const nested = decoded.affine;
  check(Array.isArray(nested) && nested.length === 4 && Array.isArray(nested[0]), 'getVolumeGeometry().affine must be 4 nested rows');
  const affine = [];
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) affine.push(Number(nested[row][column]));
  }
  check(Array.isArray(dimensions) && dimensions.length === 3, 'getVolumeGeometry().dimensions must have 3 entries');
  check(Array.isArray(decoded.spacing) && decoded.spacing.length === 3, 'getVolumeGeometry().spacing must have 3 entries');
  check(Array.isArray(decoded.origin) && decoded.origin.length === 3, 'getVolumeGeometry().origin must have 3 entries');
  check(typeof decoded.orientation === 'string', 'getVolumeGeometry().orientation must be a string');
  return { dimensions: dimensions.map(Number), spacing: decoded.spacing.map(Number), origin: decoded.origin.map(Number), orientation: decoded.orientation, affine };
}

function expectGeometry(synthetic, decoded, label) {
  const g = normalizeDecodedGeometry(decoded);
  const close = (a, b) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-6);
  check(close(g.dimensions, synthetic.dim), `${label}: dimensions ${g.dimensions} != ${synthetic.dim}`);
  check(close(g.spacing, synthetic.spacing), `${label}: spacing ${g.spacing}`);
  check(close(g.origin, synthetic.origin), `${label}: origin ${g.origin}`);
  check(g.orientation === 'RAS', `${label}: orientation ${g.orientation}`);
  const flat = [];
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) flat.push(synthetic.affine[row][column]);
  }
  check(close(g.affine, flat), `${label}: affine`);
  return g;
}

const ctx = {};

await runConsumer([
  ['global', () => {
    ctx.api = window.neuroimjs;
    check(ctx.api && typeof ctx.api === 'object', 'window.neuroimjs is missing: the UMD bundle did not initialise');
    const names = ['readNiftiArrayBuffer', 'getVolumeGeometry', 'assertSameVolumeGeometry', 'ColorMap', 'VolLayer', 'VolStack', 'SimpleOrthogonalViewer', 'LayerControlPanel'];
    const missing = names.filter((name) => typeof ctx.api[name] !== 'function');
    check(missing.length === 0, `UMD global lacks: ${missing.join(', ')}`);
    return names;
  }],

  // decodeAsset(): readNiftiArrayBuffer + getVolumeGeometry validated against the scene.
  ['decodeAsset', () => {
    const { api } = ctx;
    ctx.synthetic = { underlay: underlayVolume(), mapA: statVolume(1), mapB: statVolume(0.5) };
    ctx.underlayRaw = api.readNiftiArrayBuffer(encodeNifti1(ctx.synthetic.underlay));
    ctx.mapA = api.readNiftiArrayBuffer(encodeNifti1(ctx.synthetic.mapA));
    ctx.mapB = api.readNiftiArrayBuffer(encodeNifti1(ctx.synthetic.mapB));
    expectGeometry(ctx.synthetic.underlay, api.getVolumeGeometry(ctx.underlayRaw), 'underlay');
    expectGeometry(ctx.synthetic.mapA, api.getVolumeGeometry(ctx.mapA), 'mapA');
    return api.getVolumeGeometry(ctx.mapA).dimensions;
  }],

  // selectMap(): maps of one analysis must share a grid; the underlay need not.
  ['assertSameVolumeGeometry', () => {
    ctx.api.assertSameVolumeGeometry(ctx.mapA, ctx.mapB);
    let threw = false;
    try {
      ctx.api.assertSameVolumeGeometry(ctx.mapA, ctx.underlayRaw);
    } catch {
      threw = true;
    }
    check(threw, 'assertSameVolumeGeometry accepted volumes on different grids');
  }],

  // backgroundFloor()/headBounds()/prepareUnderlay()/withData(): raw voxel access.
  ['volumeDataAccess', () => {
    const volume = ctx.underlayRaw;
    const range = volume.getRange().map(Number);
    check(range.length === 2 && range.every(Number.isFinite) && range[1] > range[0], `getRange() ${range}`);
    const data = volume.getData();
    const dim = volume.space && volume.space.dim;
    check(data && dim && data.length === dim[0] * dim[1] * dim[2], 'getData()/space.dim mismatch');
    const replacement = new Float32Array(data.length).fill(1);
    const Volume = volume.constructor;
    const made = new Volume(volume.space, replacement);
    check(made.getData() === replacement, 'new volume.constructor(space, data).getData() must return data itself');
    ctx.underlay = { volume, range: [range[0] + 50, range[1] * 0.9] };
    return range;
  }],

  // curatePresets()/registerReportPalette(): the shared preset registry.
  ['presetRegistry', () => {
    const { ColorMap } = ctx.api;
    const presets = ColorMap.presetMaps;
    check(presets && typeof presets === 'object' && Array.isArray(presets.BlueRed), 'ColorMap.presetMaps lacks BlueRed');
    // Tolerated internal: the adapter swaps the backing registry object.
    check(Object.prototype.hasOwnProperty.call(ColorMap, '_presetMaps'), 'ColorMap._presetMaps (tolerated internal) is gone');
    const ordered = {};
    ordered[REPORT_PALETTE] = presets.BlueRed;
    Object.keys(presets).forEach((name) => {
      if (name !== REPORT_PALETTE && HIDDEN_PRESETS.indexOf(name) < 0) ordered[name] = presets[name];
    });
    ColorMap._presetMaps = ordered;
    check(ColorMap.presetMaps === ordered, 'assigning ColorMap._presetMaps no longer replaces ColorMap.presetMaps');
    ColorMap.presetMaps[REPORT_PALETTE] = ['#2166ac', '#f7f7f7', '#b2182b'];
    const available = ColorMap.getAvailableMaps();
    check(available[0] === REPORT_PALETTE, `getAvailableMaps() order: ${available.slice(0, 3)}`);
    check(available.indexOf('Greys') < 0, 'curated preset still listed');
    const map = ColorMap.fromPreset(REPORT_PALETTE);
    check(map.name === REPORT_PALETTE, `fromPreset name ${map.name}`);
    const restretched = ColorMap.fromPreset(REPORT_PALETTE, { existingColorMap: map });
    check(restretched instanceof ColorMap, 'fromPreset({ existingColorMap }) did not return a ColorMap');
    ctx.overlayMap = map;
    return available.length;
  }],

  // underlayColorMap(): a custom 256-step ramp.
  ['customColorMap', () => {
    const colors = [];
    for (let i = 0; i < 256; i += 1) colors.push([i / 255, i / 255, i / 255]);
    ctx.underlayMap = new ctx.api.ColorMap(colors, { range: ctx.underlay.range, name: 'Custom' });
    check(ctx.underlayMap.name === 'Custom', 'ColorMap options.name ignored');
  }],

  // backgroundLayer()/overlayLayer(): VolLayer construction and display options.
  ['volLayers', () => {
    const { api } = ctx;
    const background = new api.VolLayer(BACKGROUND_LAYER_ID, ctx.underlay.volume, ctx.underlayMap, ctx.underlay.range, [0, 0], 1);
    const overlay = new api.VolLayer(OVERLAY_LAYER_ID, ctx.mapA, ctx.overlayMap, [-6, 6], [-2, 2], 0.9);
    const guarded = ['setEdgeFade', 'setInterpolation', 'setOutline', 'setMinOutlineClusterSize'];
    const missing = guarded.filter((name) => typeof overlay[name] !== 'function');
    check(missing.length === 0, `VolLayer lacks (adapter would silently skip): ${missing.join(', ')}`);
    background.setEdgeFade(3);
    background.setInterpolation('cubic');
    overlay.setInterpolation('smooth');
    overlay.setOutline(0.3);
    overlay.setMinOutlineClusterSize(10);
    ctx.stack = new api.VolStack(background, overlay);
    check(typeof ctx.stack.getLayerById === 'function', 'VolStack#getLayerById missing');
    const found = ctx.stack.getLayerById(OVERLAY_LAYER_ID);
    check(found === overlay, 'getLayerById did not return the overlay');
    check(ctx.stack.length === 2 && ctx.stack.getLayer(1).id === OVERLAY_LAYER_ID, 'VolStack length/getLayer fallback');
    return ctx.stack.length;
  }],

  // createViewer(): SimpleOrthogonalViewer.create with the adapter's options.
  ['createViewer', async () => {
    const theme = groundTheme('dark');
    ctx.element = document.getElementById('viewer');
    ctx.viewer = await ctx.api.SimpleOrthogonalViewer.create(ctx.element, ctx.stack, {
      layout: 'ortho',
      showCrosshair: true,
      showSlider: false,
      showOrientationLabels: true,
      gapPx: 1,
      cellPaddingPx: 24,
      stackBelowPx: 520,
      stackedLegendHeightPx: 292,
      stackMode: 'single',
      backgroundColor: theme.backgroundColor,
      focusOutline: null,
      crosshairOptions: Object.assign({ crossThickness: 1, crosshairGap: 22 }, theme.crosshair),
      orientationLabelOptions: Object.assign({
        fontSize: 11,
        fontWeight: '600',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
        letterSpacing: 0.6,
        strokeWidth: 0,
        shadowBlur: 3,
        margin: 5,
        anchor: 'image',
      }, theme.orientationLabels),
    });
    await nextFrame();
  }],

  ['viewerDom', () => {
    const { viewer, element } = ctx;
    check(typeof viewer.setFitBounds === 'function', 'setFitBounds missing (adapter would skip head fitting)');
    viewer.setFitBounds({ min: [2, 2, 2], max: [29, 33, 27] });
    const cells = Array.from(element.querySelectorAll('[data-nij-view]'));
    const views = cells.map((cell) => cell.dataset.nijView).sort();
    check(views.join() === 'axial,coronal,sagittal', `data-nij-view cells: ${views}`);
    check(cells.every((cell) => cell.querySelector('canvas')), 'a view cell has no canvas');
    const legend = viewer.getLegendElement();
    check(legend && legend.dataset.nijLegend !== undefined, 'getLegendElement() is not the data-nij-legend cell');
    check(Array.from(element.children).includes(legend), 'legend cell is not a child of the container');
    return views;
  }],

  // buildViewSwitch(): stacked single-view mode in a narrow embedding.
  ['stackedView', async () => {
    const { viewer, element } = ctx;
    check(typeof viewer.setStackedView === 'function', 'setStackedView missing (adapter would drop the view switch)');
    check(viewer.isStacked() === false, 'wide container reported as stacked');
    element.style.width = '400px';
    await nextFrame();
    await nextFrame();
    check(viewer.isStacked() === true, 'narrow container (< stackBelowPx) not stacked');
    viewer.setStackedView('sagittal');
    const shown = Array.from(element.querySelectorAll('[data-nij-view]'))
      .filter((cell) => cell.style.display !== 'none')
      .map((cell) => cell.dataset.nijView);
    check(shown.join() === 'sagittal', `stackMode 'single' shows ${shown}`);
    element.style.width = '';
    await nextFrame();
    await nextFrame();
    check(viewer.isStacked() === false, 'wide container still stacked after resize');
    return shown;
  }],

  // Cursor, readout and coordinate subscription.
  ['cursor', () => {
    const { viewer } = ctx;
    const seen = [];
    const off = viewer.onCoordChange((coord) => seen.push(coord));
    check(typeof off === 'function', 'onCoordChange must return an unsubscribe function');
    viewer.setWorldCoord([12, 0, 4]);
    const world = viewer.getWorldCoord();
    check(world.length === 3 && Math.abs(world[0] - 12) < 2.5, `getWorldCoord ${world}`);
    const value = viewer.getValue(OVERLAY_LAYER_ID);
    check(typeof value === 'number' && value > 3, `getValue at the positive peak: ${value}`);
    check(seen.length > 0, 'onCoordChange handler not called by setWorldCoord');
    off();
    const count = seen.length;
    viewer.setWorldCoord([0, 0, 0]);
    check(seen.length === count, 'unsubscribe from onCoordChange did not stop events');
    const layer = ctx.stack.getLayerById(OVERLAY_LAYER_ID);
    check(typeof layer.space.coordToGrid === 'function' && layer.space.spacing.length === 3, 'VolLayer#space');
    check(layer.getVolumeRange().length === 2, 'VolLayer#getVolumeRange');
    check(layer.getThreshold().length === 2 && layer.getRange().length === 2, 'VolLayer threshold/range getters');
    check(typeof layer.opacity === 'number' && layer.colorMap.name === REPORT_PALETTE, 'VolLayer#opacity/colorMap');
    return value;
  }],

  // createViewer()/customizeControls(): the layer control panel.
  ['controlPanel', async () => {
    const { api, viewer, stack } = ctx;
    const panel = new api.LayerControlPanel();
    const methods = ['colormapNamesIncluding', 'clampToThresholdDomain', 'readField', 'fmt', 'applyThreshold',
      'syncThresholdLink', 'onThresholdLowInput', 'onThresholdHighInput', 'onRangeLowInput', 'onRangeHighInput',
      'onThresholdUpdate', 'resetToDefaults', 'selectLayer', 'setDefaultsFromCurrent', 'getState', 'applyState', 'requestUpdate'];
    const missing = methods.filter((name) => typeof panel[name] !== 'function');
    check(missing.length === 0, `LayerControlPanel lacks (tolerated internals): ${missing.join(', ')}`);
    // customizeControls(): wrap and replace instance members.
    const formatted = [];
    panel.fmt = (value) => { formatted.push(value); return `~${Number(value).toFixed(2)}`; };
    const selectLayer = panel.selectLayer;
    panel.selectLayer = function () { return selectLayer.apply(panel, arguments); };
    const onRangeLowInput = panel.onRangeLowInput;
    panel.onRangeLowInput = function (event) { return onRangeLowInput.call(panel, event); };
    panel.visibleControls = ['range', 'threshold', 'colormap', 'opacity'];
    panel.volStack = stack;
    panel.viewer = viewer;
    document.getElementById('controls').appendChild(panel);
    await panel.updateComplete;
    panel.selectLayer(OVERLAY_LAYER_ID);
    await panel.updateComplete;
    const defaults = panel.setDefaultsFromCurrent(OVERLAY_LAYER_ID);
    for (const key of ['layerId', 'range', 'threshold', 'colormap', 'opacity', 'visible']) {
      check(key in defaults, `setDefaultsFromCurrent() state lacks ${key}`);
    }
    check(defaults.layerId === OVERLAY_LAYER_ID && defaults.range.length === 2, 'defaults describe the overlay');
    check(Array.isArray(panel.threshold) && Array.isArray(panel.range) && Array.isArray(panel.volumeRange), 'panel threshold/range/volumeRange state');
    check(typeof panel.thresholdLinked === 'boolean', 'panel thresholdLinked state');
    panel.volumeRange = [-8, 8];
    check(formatted.length > 0, 'fmt override was not used to render the numeric fields');
    // labelSliders(): the shadow-DOM structure the adapter labels.
    const shadow = panel.shadowRoot;
    check(shadow, 'LayerControlPanel has no shadowRoot');
    const sliders = Array.from(shadow.querySelectorAll('range-slider'));
    const labels = sliders.map((slider) => {
      const section = slider.closest('.section');
      const labelNode = section && section.querySelector('.label');
      return labelNode ? labelNode.textContent.trim() : null;
    });
    check(labels.includes('Range') && labels.includes('Threshold'), `range-slider section labels: ${labels}`);
    for (const slider of sliders) {
      await slider.updateComplete;
      check(slider.shadowRoot && slider.shadowRoot.querySelectorAll('input[type="range"]').length === 2, 'range-slider lacks two range inputs');
      slider.step = 0.5;
    }
    // Change events and state round trip.
    const events = [];
    panel.addEventListener('layer-control-change', (event) => events.push(event.detail));
    const saved = panel.getState(OVERLAY_LAYER_ID);
    const applied = panel.applyState({ ...saved, threshold: [-3, 3] });
    check(applied.threshold[0] === -3 && applied.threshold[1] === 3, `applyState threshold ${applied.threshold}`);
    const layer = stack.getLayerById(OVERLAY_LAYER_ID);
    check(layer.getThreshold()[1] === 3, `applyState did not reach the layer: ${layer.getThreshold()}`);
    check(events.length > 0 && events[events.length - 1].layerId === OVERLAY_LAYER_ID, 'no layer-control-change event');
    panel.requestUpdate();
    await panel.updateComplete;
    ctx.panel = panel;
    return labels;
  }],

  // selectMap()/applyExtent(): swap the overlay volume in place.
  ['updateLayerVolume', () => {
    const { viewer, stack, api } = ctx;
    const before = stack.getLayerById(OVERLAY_LAYER_ID);
    viewer.updateLayerVolume(OVERLAY_LAYER_ID, ctx.mapB, {
      range: [-6, 6],
      threshold: [-1, 1],
      alpha: 0.8,
      colormap: api.ColorMap.fromPreset(REPORT_PALETTE),
    });
    const after = stack.getLayerById(OVERLAY_LAYER_ID);
    check(after.volume === ctx.mapB, 'updateLayerVolume did not replace the volume');
    check(after === before || after.id === OVERLAY_LAYER_ID, 'overlay layer identity');
    viewer.updateLayer(OVERLAY_LAYER_ID, { colormap: api.ColorMap.fromPreset(REPORT_PALETTE, { existingColorMap: after.colorMap }) });
    check(after.colorMap.name === REPORT_PALETTE, `updateLayer colormap ${after.colorMap.name}`);
  }],

  // switchGround(): restyle in place.
  ['setTheme', () => {
    const { viewer } = ctx;
    viewer.setTheme(groundTheme('light'));
    viewer.updateLayer(BACKGROUND_LAYER_ID, { colormap: ctx.underlayMap, threshold: [0, 0] });
  }],

  // exportPNG(): force a frame through the tolerated internals and copy it.
  ['exportPng', async () => {
    const { viewer, element } = ctx;
    await nextFrame();
    const inner = viewer.viewer;
    check(inner && typeof inner.getSliceViewer === 'function', 'SimpleOrthogonalViewer#viewer.getSliceViewer (tolerated internal) is gone');
    const sizes = [];
    for (const view of ['sagittal', 'coronal', 'axial']) {
      const app = inner.getSliceViewer(view).view.app;
      check(app && app.renderer && app.stage, `getSliceViewer('${view}').view.app (tolerated internal) is gone`);
      app.renderer.render(app.stage);
      const canvas = element.querySelector(`[data-nij-view="${view}"] canvas`);
      check(canvas && canvas.width > 0 && canvas.height > 0, `${view} canvas has no size`);
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const context = copy.getContext('2d');
      context.drawImage(canvas, 0, 0);
      const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
      let lit = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] + pixels[i + 1] + pixels[i + 2] < 600 && pixels[i + 3] > 0) lit += 1;
      }
      // Light ground: the stage is white, the anatomy and the map are not.
      check(lit > 50, `${view}: exported frame shows no anatomy (${lit} non-white pixels)`);
      sizes.push([canvas.width, canvas.height]);
    }
    return sizes;
  }],

  ['dispose', () => {
    ctx.panel.remove();
    ctx.viewer.dispose();
  }],
]);

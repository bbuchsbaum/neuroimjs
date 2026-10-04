# ADR-0003: Rendering substrate for the GPU slice pipeline

- **Status:** Proposed
- **Date:** 2026-10-03
- **Scope:** `src/display/` (`SliceView`, `ImageLayer`, `VolLayer`/`VolStack`, the viewers)

PIXI facts below were checked against the installed `pixi.js@8.20.0` (`node_modules/pixi.js/lib/...`), which `package.json` requires as `^8.20.0`.

## Context

**Current pipeline (CPU).** Each layer's slice is colour-mapped on the CPU into an RGBA `ImageData`, drawn onto a 2D canvas and uploaded with `PIXI.Texture.from(canvas)` (`src/display/ImageLayer.ts:138-178`). Textures are cached per layer, slice index, axes, version and filter mode (`ImageLayer.ts:296-301`). Changing window/level, colormap or threshold therefore means a full CPU re-map and a new upload.

**Contexts.** Every `SliceView` creates its own `PIXI.Application` (`src/display/SliceView.ts:117-145`), so an orthogonal viewer holds three GPU contexts (`OrthogonalImageViewer.ts:480`). No `preference` is passed (`SliceView.ts:125-133`). PIXI then tries `webgl`, then `webgpu`, then `canvas` (`rendering/renderers/autoDetectRenderer.mjs:6`). WebGL is therefore used when it is available. Nothing in neuroimjs requires it, and a machine without WebGL silently gets WebGPU or Canvas. The code has no `webglcontextlost` handling (a repo search finds none). Chromium caps active WebGL contexts at 16 and silently loses the oldest when the cap is exceeded ([Chromium review 14217005](https://codereview.chromium.org/14217005/); WebKit has a matching [test](https://webkit.googlesource.com/WebKit/+/master/LayoutTests/webgl/max-active-contexts-oldest-context-lost-expected.txt)). A page with six or more ortho viewers is enough to hit it.

**PIXI v8 constraints**

- `TextureSource.dimensions` is documented as "currently v8 only supports 2d" (`rendering/renderers/shared/texture/sources/TextureSource.d.ts:41,190`). A `'3d'` view dimension does map to `TEXTURE_3D` (`gl/texture/utils/mapViewDimensionToGlTarget.mjs`). However, `GlTextureSystem` has no allocation or upload path for it and throws "Unsupported texture target for empty allocation". Only 2D, 2D-array (allocation only) and cube are handled (`gl/texture/GlTextureSystem.mjs:203-212`). The buffer uploader calls only `texImage2D`/`texSubImage2D` (`gl/texture/uploaders/glUploadBufferImageResource.mjs`). PIXI's WebGPU texture path passes the dimension through but uploads with `depthOrArrayLayers: 1` (`gpu/texture/uploaders/gpuUploadBufferImageResource.mjs:19`). **PIXI cannot upload a volume as a 3D texture.**
- Single-channel float formats exist: `r16float` maps to `R16F` and `r32float` to `R32F` (`gl/texture/utils/mapFormatToGlInternalFormat.mjs:28,36`). PIXI checks for `OES_texture_float_linear` (`gl/context/GlContextSystem.mjs:133`).
- A custom `Filter` or `Shader` needs a `glProgram` for WebGL and a `gpuProgram` (WGSL) for WebGPU (`filters/Filter.d.ts:73`). A filter without the program for the active renderer is silently skipped (`:74`), so a GLSL-only shader does nothing under WebGPU.
- Escape hatches: `ExternalSource` wraps an external `WebGLTexture` or `GPUTexture` as a PIXI texture (`shared/texture/sources/ExternalSource.d.ts`). `renderer.resetState()` exists for sharing a context with another library (`shared/system/AbstractRenderer.d.ts:345-358`). `multiView` lets one WebGL renderer draw to several canvases (`gl/context/GlContextSystem.d.ts:55-60`).

**WebGL2 / WebGPU facts**

- Core WebGL 2.0 includes `OES_texture_half_float_linear` "but not `OES_texture_float_linear`" ([WebGL 2.0 spec](https://registry.khronos.org/webgl/specs/latest/2.0/)). `R16F` is filterable everywhere. `R32F` with `LINEAR` filtering needs the extension ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/OES_texture_float_linear)). Half floats have an 11-bit significand, so raw BOLD intensities around 10⁴ are quantized in steps of 8. Normalize before using R16F, or use R32F with `NEAREST` and interpolate in the shader.
- WebGPU has 3D textures in core, but filtering `r32float` needs the optional `float32-filterable` feature ([MDN GPUSupportedFeatures](https://developer.mozilla.org/en-US/docs/Web/API/GPUSupportedFeatures)). WebGPU is on by default in Chrome and Edge, in Firefox 141 on Windows only, and in Safari 26 ([web.dev](https://web.dev/blog/webgpu-supported-major-browsers)). Linux Firefox and older Safari do not have it.

**Headless.** Tests run in jsdom with PIXI and canvas mocked (`tests/setup.ts`). There is no GPU in CI, so the CPU colormap path is the only one that can be tested numerically.

## Decision drivers

- Interactive window/level, threshold and colormap changes without CPU re-mapping.
- Exact-enough agreement with the CPU reference, so the CPU path stays testable.
- Context budget and robustness to context loss.
- Keep PIXI's scene graph for the crosshair, labels, text and interaction.
- Leave room for oblique and 3D sampling later.

## Considered options

**(a) All PIXI: 2D scalar slice textures plus a custom shader.** Upload the extracted slice as `r32float` (or normalized `r16float`) with a 256×1 colormap LUT texture. Window, threshold, opacity and NaN transparency run in a `Filter` or `Mesh` shader. *Pros:* small change; keeps PIXI everywhere; slice extraction and reorientation stay on the CPU, where they are tested; a slice upload is small (256² × 4 B = 256 KB). *Cons:* no 3D textures, so the CPU still extracts every slice and oblique reslicing is CPU-only; needs a WGSL twin or a pinned `preference: 'webgl'`.

**(b) PIXI for chrome, raw WebGL2 for slice layers, one shared context.** A raw WebGL2 pass on PIXI's `gl` uses `texImage3D`, `sampler3D` and arbitrary slice planes, renders to a texture, and that texture is shown with `ExternalSource`. `resetState()` keeps the two state machines apart. *Pros:* true 3D and oblique sampling; uploads once per volume; PIXI keeps overlays. *Cons:* two GL abstractions to maintain; state-leak bugs; WebGL only.

**(c) Full raw WebGL2, or a thin library such as twgl or regl.** *Pros:* full control and one context per page. *Cons:* the crosshair, labels, text, hit-testing and theming would all have to be rewritten. That is a large regression risk for a viewer stack that already works.

**(d) WebGPU first.** *Pros:* modern API, 3D textures and compute for on-GPU stats. *Cons:* incomplete browser coverage; `r32float` filtering is optional; no headless path; PIXI's WebGPU renderer would need a WGSL version of every shader.

## Recommendation

Use **(a) now, and keep (b) as the planned extension**. Do not do (c) or (d) now. Stages:

0. **Hygiene.** Pass `preference: 'webgl'` explicitly. Handle `webglcontextlost`/`restored` by rebuilding textures from the cache keys. Prototype one shared renderer for multiple panes (`multiView`) and measure its copy cost against three Applications.
1. **Scalar textures and a GLSL colormap shader** behind a `renderMode: 'gpu' | 'cpu'` option. Use R32F with `NEAREST` filtering, plus bilinear interpolation in the shader where linear interpolation is requested, so the extension is not needed. The CPU path stays the **reference** (golden pixel comparisons with a tolerance), the **fallback** (when there is no WebGL2 or float textures are unavailable) and the **headless** path.
2. **3D textures through (b)**, only when oblique views or volume-level operations justify it. Add a WGSL twin only if WebGPU becomes a target.

## Consequences

- `ImageLayer` splits into a sampler (CPU slice extraction, unchanged) and a shader that replaces the colormap-to-RGBA step. `ColorMap` gains a LUT export.
- Native-dtype or lazily scaled data ([ADR-0001](./0001-canonical-4d-layout.md), S3) can be uploaded raw, with the slope applied in the shader.
- Pixel-parity tests need a real GPU runner, such as Playwright with Chromium, in addition to jsdom.

## Open questions

1. Does `multiView` perform acceptably for three or more panes? It renders into a hidden canvas, which `ensureCanvasSize` enlarges to fit the largest target (`gl/context/GlContextSystem.mjs:78-90`), and then blits the result into each pane's 2D context with `drawImage` (`gl/renderTarget/GlRenderTargetAdaptor.mjs:491`).
2. Is oblique reslicing on the roadmap? If not, stage 2 may never be needed.
3. Is a pinned WebGL renderer acceptable, given that WebGL2 coverage is effectively universal in desktop browsers?

# PIXI.js Neuroimaging Visualization Ideas

Novel visualization features that leverage PIXI.js's GPU-accelerated rendering, custom shaders, particle systems, and real-time interactivity.

## 1. Particle-Based Connectivity Flow

Animate particles flowing along white matter tracts or functional connectivity paths.

- Flow from seed region to targets at speeds proportional to connection strength
- Use color gradients showing correlation sign (+/-)
- Accumulate at nodes to show hub connectivity
- React to user hovering over regions (highlight connected pathways)

**PIXI features:** Particle containers, sprite batching, blend modes

## 2. Temporal Dynamics Heatwave

For fMRI time-series, instead of frame-by-frame movies:

- Show activation as rippling "heatwaves" emanating from regions
- Temporal lag between regions shown as phase-shifted waves
- Click a voxel to see its temporal influence propagate through the brain
- Custom shader for smooth interpolation between timepoints

**PIXI features:** Custom filters/shaders, ticker for animation

## 3. Uncertainty Visualization with Animated Noise

For probabilistic atlases or statistical maps:

- Render low-confidence regions with animated stippling/static
- High-confidence regions render solid
- The "jitter" intensity maps to p-value or variance
- Makes uncertainty viscerally obvious vs. static transparency

**PIXI features:** Noise shaders, filter composition

## 4. Multi-Subject Morphing

For group studies or atlas comparisons:

- Smoothly morph between individual subjects' anatomy
- Overlay functional data that interpolates along with anatomy
- Scrub through subjects like a timeline
- Instantly see anatomical variability and how it affects activation localization

**PIXI features:** Texture interpolation, displacement filters

## 5. Depth-Enhanced Slice Viewing

Use PIXI filters to add depth cues to 2D slices:

- Subtle parallax effect when moving cursor (slices behind shift slightly)
- Shadow/ambient occlusion for 3D structures
- "Focus" blur based on distance from current slice
- Makes spatial relationships more intuitive without full 3D rendering

**PIXI features:** Blur filters, multi-layer compositing, pointer events

## 6. Real-Time ROI Sculpting

Interactive ROI drawing with immediate visual feedback:

- Paint tool with smooth GPU-accelerated brush
- Live preview of statistics as you draw (mean signal, volume)
- Undo/redo with smooth transitions
- Watershed/region-growing that animates outward

**PIXI features:** RenderTexture for drawing, Graphics for shapes

## 7. Connectivity Matrix <-> Brain Bidirectional View

Link a correlation matrix to brain slices:

- Hover over matrix cell -> animate connection on brain
- Select brain region -> highlight matrix row/column
- Particle system shows top N connections simultaneously
- Smooth transitions as threshold changes

**PIXI features:** Linked containers, particle system, tweening

---

## Top Pick: Temporal Flow Particles

This would be unique and scientifically valuable - showing how activation propagates through the brain over time using particles that:

1. Spawn at regions with rising activation
2. Flow toward functionally connected regions
3. Speed/density reflects correlation strength
4. Color reflects timing (early=blue, late=red)

This would make temporal dynamics *visible* in a way static maps can't achieve, and PIXI's particle system is perfect for it.

### Implementation sketch

```typescript
interface FlowParticle {
  x, y: number;           // Current position
  sourceRegion: number;   // Origin ROI
  targetRegion: number;   // Destination ROI
  progress: number;       // 0-1 along path
  speed: number;          // Based on correlation strength
  color: number;          // Based on temporal lag
}

class TemporalFlowLayer extends Container {
  private particles: ParticleContainer;
  private paths: Map<string, Point[]>;  // Precomputed bezier paths

  update(timeSeries: Float32Array[], timeIndex: number) {
    // Spawn particles at regions with rising activation
    // Move existing particles along connectivity paths
    // Remove particles that reach destination
  }
}
```

### Data requirements

- Functional connectivity matrix (correlation/coherence)
- Time-series data for each region
- ROI centroids for particle spawn/target positions
- Optional: streamline paths for anatomically-informed flow

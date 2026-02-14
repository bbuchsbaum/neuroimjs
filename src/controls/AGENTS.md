<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-13 | Updated: 2026-02-13 -->

# controls

## Purpose
Web Component UI controls built with Lit for interactive viewer configuration. Provides layer control panels, range sliders, and status bars.

## Key Files

| File | Description |
|------|-------------|
| `LayerControlPanelLit.ts` | `LayerControlPanel` — Lit web component for controlling layer visibility, opacity, colormap, and thresholds |
| `RangeSlider.ts` | Range slider component using noUiSlider |
| `RangeSlider2.ts` | Alternative range slider implementation |
| `StatusBar.ts` | `StatusBar` — displays current coordinate, voxel value, and atlas label |

## For AI Agents

### Working In This Directory
- Components use Lit (`lit-element`) for web component rendering.
- `LayerControlPanel` integrates with `VolStack` to control overlay layers.
- `StatusBar` subscribes to viewer events for real-time coordinate display.
- These are browser-only components — exported from `browser.ts`.

### Testing Requirements
- Test through E2E tests or manual browser testing.
- Web Components require a real DOM — not fully testable in jsdom.

<!-- MANUAL: -->

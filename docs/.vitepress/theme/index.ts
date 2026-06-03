import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import { h } from 'vue'
import BrainViewer from '../components/BrainViewer.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  // Drop a real, interactive brain into the hero image slot.
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'home-hero-image': () =>
        h(BrainViewer, {
          mode: 'axial',
          height: 380,
          showSlider: true,
          crosshair: false,
          class: 'hero-brain',
        }),
    }),
  enhanceApp({ app }) {
    // Make <BrainViewer /> usable directly in any markdown page.
    app.component('BrainViewer', BrainViewer)
  },
} satisfies Theme

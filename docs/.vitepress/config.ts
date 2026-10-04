import { defineConfig, type DefaultTheme } from 'vitepress'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

// Deployed at https://bbuchsbaum.github.io/neuroimjs/
const base = '/neuroimjs/'
// Show the released version from package.json so the nav never goes stale.
const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf-8'),
) as { version: string }

// TypeDoc (via typedoc-vitepress-theme) writes the API sidebar here on `docs:api`.
// Load it defensively so `vitepress dev` works even before the first generation.
function apiSidebar(): DefaultTheme.SidebarItem[] {
  try {
    const json = readFileSync(
      fileURLToPath(new URL('../api/typedoc-sidebar.json', import.meta.url)),
      'utf-8',
    )
    return JSON.parse(json) as DefaultTheme.SidebarItem[]
  } catch {
    return [{ text: 'Run `npm run docs:api` to generate the reference', link: '/api/' }]
  }
}

export default defineConfig({
  base,
  lang: 'en-US',
  title: 'neuroimjs',
  titleTemplate: ':title · neuroimjs',
  description:
    'Neuroimaging for JavaScript — volumetric data, NIfTI I/O, spatial transforms, and live WebGL brain viewers, in the browser and Node.',
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: false,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }],
    ['meta', { name: 'theme-color', content: '#7c5cff' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'neuroimjs — neuroimaging for JavaScript' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Volumetric data, NIfTI I/O, spatial transforms, and live WebGL brain viewers for the browser and Node.',
      },
    ],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/guide/', activeMatch: '/guide/' },
      { text: 'Examples', link: '/examples/', activeMatch: '/examples/' },
      { text: 'API', link: '/api/', activeMatch: '/api/' },
      {
        text: `v${version}`,
        items: [
          { text: 'Release Notes', link: 'https://github.com/bbuchsbaum/neuroimjs/releases' },
          { text: 'npm', link: 'https://www.npmjs.com/package/neuroimjs' },
          { text: 'Stability & Roadmap', link: '/guide/stability' },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          collapsed: false,
          items: [
            { text: 'What is neuroimjs?', link: '/guide/' },
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Stability & Roadmap', link: '/guide/stability' },
          ],
        },
        {
          text: 'Core Concepts',
          collapsed: false,
          items: [
            { text: 'Data Structures', link: '/guide/concepts' },
            { text: 'Volumes & Slices', link: '/guide/volumes' },
            { text: 'Time Series & Hypervectors', link: '/guide/time-series' },
            { text: 'Coordinate Systems', link: '/guide/coordinate-systems' },
            { text: 'Reading & Writing (I/O)', link: '/guide/io' },
          ],
        },
        {
          text: 'Processing & Analysis',
          collapsed: false,
          items: [
            { text: 'Spatial & Resampling', link: '/guide/processing' },
            { text: 'Statistics & Searchlight', link: '/guide/analysis' },
            { text: 'Regions of Interest', link: '/guide/roi' },
            { text: 'Group Statistics & Review', link: '/guide/group-stats' },
          ],
        },
        {
          text: 'Visualization',
          collapsed: false,
          items: [
            { text: 'Viewers', link: '/guide/viewers' },
            { text: 'Colormaps & Layers', link: '/guide/colormaps' },
            { text: 'Composable Views', link: '/guide/composable-views' },
            { text: 'Multi-Layer Alignment', link: '/guide/alignment' },
            { text: 'UI Controls', link: '/guide/controls' },
            { text: 'Custom Layers', link: '/guide/custom-layers' },
          ],
        },
      ],
      '/examples/': [
        {
          text: 'Live Examples',
          items: [
            { text: 'Overview', link: '/examples/' },
            { text: 'Full Viewer with Controls', link: '/examples/viewer-workbench' },
            { text: 'Orthogonal Viewer', link: '/examples/orthogonal-viewer' },
            { text: 'Single Slice View', link: '/examples/single-view' },
          ],
        },
      ],
      '/api/': [{ text: 'API Reference', items: apiSidebar() }],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/bbuchsbaum/neuroimjs' }],

    search: { provider: 'local' },

    editLink: {
      pattern: 'https://github.com/bbuchsbaum/neuroimjs/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024–present Bradley Buchsbaum',
    },

    outline: { level: [2, 3] },
  },

  vue: {
    template: {
      // Lit web components shipped by the library (e.g. <layer-control-panel>).
      compilerOptions: { isCustomElement: (tag) => tag.includes('-panel') },
    },
  },

  vite: {
    resolve: {
      alias: [
        // The live demos import the library straight from source. Both specifiers
        // resolve to the browser-safe entry, so demos never pull in Node modules.
        {
          find: /^neuroimjs(\/browser)?$/,
          replacement: fileURLToPath(new URL('../../src/browser.ts', import.meta.url)),
        },
      ],
    },
    optimizeDeps: {
      // Pre-bundle every Lit entry the controls use together; otherwise Vite
      // discovers them separately and Lit's core is loaded twice in dev.
      include: [
        'pixi.js',
        'mobx',
        'chroma-js',
        'nifti-reader-js',
        'lit',
        'lit/decorators.js',
        'lit/directives/live.js',
      ],
    },
    ssr: {
      // These are only ever pulled in via client-side dynamic import, but keep them
      // out of SSR externalization to avoid resolution surprises during the build.
      noExternal: ['nifti-reader-js'],
    },
  },

  // Contributor notes, design ideas and agent docs live under docs/ but are not part of the site.
  srcExclude: ['**/internal/**', '**/AGENTS.md', 'NPM_SCRIPTS.md', 'design/**'],
})

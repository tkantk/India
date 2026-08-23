/**
 * The colours the tour art is drawn in.
 *
 * A MIRROR of the custom properties in src/styles/base.css, not a second
 * palette: `Symbol.test.tsx` fails if a value here is not declared there, and
 * fails if a symbol paints with anything that is not here. Two rules, and
 * eleven symbols drawn at different times still look like one set.
 *
 * Why literals rather than `var(--saffron)`: these are SVG presentation
 * attributes, and WebKit's legacy SVG engine — the one on every iPad this has
 * to run on — does not resolve custom properties in them. A `fill` that
 * silently falls back to black is exactly the failure a child would see and
 * nobody would catch in Chrome.
 */
export const PALETTE = {
  ink: '#12241c',
  paper: '#fdf8ef',
  deep: '#0b3d2e',
  saffron: '#f0851f',
  gold: '#ffd400',

  sea: '#2b7ba9',
  seaPale: '#bfe0ef',
  leaf: '#3f8f57',
  leafDeep: '#256b3d',
  bark: '#7a5a3c',
  sand: '#e3c98f',
  sandDeep: '#c9a45f',
  sandShade: '#b08b4a',
  stone: '#cbb894',
  stoneDeep: '#a08d68',
  rose: '#ef8fa8',
  rosePale: '#f9cdd8',
  mango: '#f7b731',
  peacock: '#1b6ea8',
  peacockTeal: '#2a8f8a',
  snow: '#ffffff',

  flagSaffron: '#ff9933',
  flagGreen: '#138808',
  flagNavy: '#000080',

  /**
   * THE PRINTED PAGE — see the block of the same name in base.css for what
   * these are for. `inkLine` is the one ink every drawn edge is drawn in;
   * the eight `mat*` values are the grounds a reveal can be printed on.
   *
   * They live here as well as in base.css for the usual reason: they are
   * painted as SVG presentation attributes (`Card`'s mat and rule), and
   * WebKit's legacy engine will not resolve `var()` in one.
   */
  inkLine: '#4b3a25',

  matSand: '#f3d79b',
  matRose: '#f8ccd8',
  matLeaf: '#d2e7b2',
  matSun: '#ffe19a',
  matSky: '#b8dcf3',
  matStone: '#e6d8bd',
  matTeal: '#b6e0d8',
} as const

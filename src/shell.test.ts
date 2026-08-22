import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

const html = readFileSync('index.html', 'utf8')
const css = readFileSync('src/styles/base.css', 'utf8')

describe('index.html platform hardening', () => {
  it('sets a device-width viewport that covers the safe area', () => {
    const meta = html.match(/<meta name="viewport"[^>]*>/)?.[0] ?? ''
    expect(meta).toContain('width=device-width')
    expect(meta).toContain('initial-scale=1')
    expect(meta).toContain('viewport-fit=cover')
  })

  it('wears the project\'s own icon, and carries no scaffold artwork', () => {
    // The first commit shipped Vite's purple lightning bolt — a third-party
    // brand mark with Figma-exported filter ids, no provenance and no
    // licence — as the site's identity, while the project's own peacock
    // feather sat unused behind the web manifest. The bolt is gone; nothing
    // may quietly reinstate it.
    expect(existsSync('public/favicon.svg'), 'the scaffold favicon is back').toBe(false)
    const icon = html.match(/<link rel="icon"[^>]*>/)?.[0] ?? ''
    expect(icon).toContain('icon-192.png')
    expect(html).not.toContain('favicon.svg')
    // A relative href: a leading slash 404s on a GitHub Pages project page.
    expect(icon).not.toMatch(/href="\//)
  })

  it('declares itself installable to the Home Screen', () => {
    // Home Screen install is the only way to escape the 7-day storage purge.
    expect(html).toContain('manifest.webmanifest')
    expect(html).toMatch(/apple-mobile-web-app-capable/)
  })
})

describe('base.css', () => {
  it('pins the body so the rubber-band bounce cannot happen', () => {
    // overscroll-behavior does NOT work here: WebKit's implementation has no
    // effect on scroll containers with no scrollable overflow.
    expect(css).toMatch(/body\s*\{[^}]*position:\s*fixed/s)
    expect(css).toMatch(/body\s*\{[^}]*overflow:\s*hidden/s)
  })

  it('kills the tap flash, the long-press callout and text selection', () => {
    expect(css).toContain('-webkit-tap-highlight-color')
    expect(css).toContain('-webkit-touch-callout')
    expect(css).toContain('-webkit-user-select')
  })

  it('sets touch-action: manipulation, which is what actually removes the tap delay', () => {
    expect(css).toMatch(/touch-action:\s*manipulation/)
  })

  it('declares a 104px tap target, the researched size for a child under nine', () => {
    expect(css).toMatch(/--tap:\s*104px/)
  })

  it('leaves a gutter for the un-blockable edge back-swipe', () => {
    expect(css).toMatch(/--gutter:\s*28px/)
  })
})

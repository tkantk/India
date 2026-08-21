import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const html = readFileSync('index.html', 'utf8')
const css = readFileSync('src/styles/base.css', 'utf8')

describe('index.html platform hardening', () => {
  it('sets a device-width viewport that covers the safe area', () => {
    const meta = html.match(/<meta name="viewport"[^>]*>/)?.[0] ?? ''
    expect(meta).toContain('width=device-width')
    expect(meta).toContain('initial-scale=1')
    expect(meta).toContain('viewport-fit=cover')
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

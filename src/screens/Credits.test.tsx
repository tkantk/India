import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { Credits } from './Credits'
import geo from '../data/geo.json'
import world from '../data/world.json'
import photos from '../data/photo-credits.json'
import sounds from '../data/sound-credits.json'

/**
 * THIS IS THE TEST THAT STOPS THE LICENCE BREACH COMING BACK.
 *
 * 18 of the 20 photographs and 7 of the 11 sounds carry
 * `attributionRequired: true`. CC BY 4.0 s3(a) and CC BY-SA 4.0 s3(a) attach
 * that duty to SHARING the work, not to putting it on screen — and this
 * repository and the deployed site both share all 31 files. So the credit is
 * not decoration that can be deferred until the landmark screens exist: it
 * is the condition on which the files may be in the repository at all.
 *
 * The check is deliberately against the JSON rather than a fixed list. Fetch
 * a new photograph tomorrow and this test starts demanding its credit
 * without anybody editing it.
 */
type Credit = { attributionRequired: boolean; attributionHtml: string; licence: string }
const PHOTOS: Record<string, Credit> = photos
const SOUNDS: Record<string, Credit & { modifications: string; licenceShort: string }> = sounds

const every = [
  ...Object.entries(PHOTOS).map(([id, c]) => [`photo ${id}`, c] as const),
  ...Object.entries(SOUNDS).map(([id, c]) => [`sound ${id}`, c] as const),
]

/**
 * "Verbatim" has to be judged after parsing, not before it.
 *
 * `kerala.backwaters` carries a literal U+00A0 in its artist string, and the
 * DOM serialises that back out as `&nbsp;` — so the raw JSON and the rendered
 * markup differ by an entity while being the same document. Round-tripping
 * the expected string through the same parser removes that difference and no
 * other: a credit that lost a link, a name or a licence still fails.
 */
const asRendered = (html: string) => {
  const box = document.createElement('div')
  box.innerHTML = html
  return box.innerHTML
}

describe('the credits page', () => {
  it('renders the attribution every file that requires one legally requires', () => {
    const { container } = render(<Credits />)
    const required = every.filter(([, c]) => c.attributionRequired)
    // 18 photographs + 7 sounds. A refactor that quietly stopped rendering
    // the lists would otherwise make this pass on an empty set.
    expect(required.length).toBe(25)
    for (const [what, credit] of required) {
      expect(container.innerHTML, `${what} is not credited`).toContain(asRendered(credit.attributionHtml))
    }
  })

  it('credits the public-domain files too, which is manners rather than law', () => {
    const { container } = render(<Credits />)
    for (const [what, credit] of every.filter(([, c]) => !c.attributionRequired)) {
      expect(container.innerHTML, `${what} is not credited`).toContain(asRendered(credit.attributionHtml))
    }
  })

  it('credits DataMeet for the boundaries', () => {
    render(<Credits />)
    expect(screen.getByText(geo.attribution)).toBeVisible()
  })

  // Task 5: Natural Earth is public domain and asks for no credit at all —
  // this project credits every third-party source it ships regardless, the
  // same "manners rather than law" standard the public-domain photographs
  // and sounds above are already held to.
  it('credits Natural Earth for the neighbouring land, though public domain requires none', () => {
    render(<Credits />)
    expect(screen.getByText(world.attribution)).toBeVisible()
    expect(world.attribution).toMatch(/public domain/i)
  })

  it('groups the four kinds of thing so a reader can tell what is what', () => {
    render(<Credits />)
    for (const name of [/^map$/i, /^neighbouring land$/i, /^photographs$/i, /^sounds$/i]) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeVisible()
    }
  })

  it('says what was done to each sound, which s3(a)(1)(B) requires', () => {
    const { container } = render(<Credits />)
    for (const [id, credit] of Object.entries(SOUNDS)) {
      expect(container.textContent, `${id} does not say how it was modified`)
        .toContain(credit.modifications)
    }
  })

  it('offers every modified share-alike sound under the same licence as its source', () => {
    render(<Credits />)
    const shareAlike = Object.entries(SOUNDS).filter(([, c]) => /^cc-by-sa/i.test(c.licence))
    expect(shareAlike.length).toBe(7)
    for (const [id, credit] of shareAlike) {
      const item = screen.getByTestId(`credit-sound-${id}`)
      // Not merely "we changed it": the adapted file must itself be offered
      // under the source's licence, and the page has to say so.
      expect(item.textContent, `${id} does not offer the adaptation under ${credit.licenceShort}`)
        .toMatch(new RegExp(`offered under ${credit.licenceShort.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    }
  })

  it('does not claim the photographs were adapted, because they were not', () => {
    render(<Credits />)
    const section = screen.getByRole('region', { name: /photographs/i })
    // fetch-photos.mjs asks Wikimedia's own servers for a thumbnail and
    // stores what comes back, byte for byte. That is a change of format, not
    // an adaptation, and saying otherwise would be over-claiming.
    expect(within(section).getByText(/unaltered/i)).toBeVisible()
    expect(section.textContent).not.toMatch(/adapted material/i)
  })

  it('leads back to the map', () => {
    render(<Credits />)
    const back = screen.getByRole('link', { name: /back to the map/i })
    expect(back).toHaveAttribute('href', '#/')
  })
})

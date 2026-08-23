import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import vocab from '../../../content/vocab.json'
import { CUE_VERBS } from '../../../content/schema.ts'
import {
  DEFAULT_SUBJECT,
  SUBJECTS,
  VERB_SUBJECT_KEYS,
  missingSubjects,
  subjectKeyFor,
  subjectOf,
} from './subject'
import { Symbol } from './Symbol'
import { Flag } from './Flag'
import { Counter } from './Counter'
import { River } from './River'
import { Here } from './Here'
import { Seas } from './art/Sea'
import { Outline } from './art/Outline'

/** The revealSymbol names whose art is a Layer, not a Card — they have no
 *  page of their own to paint, so they are covered by their own dedicated
 *  tests below rather than the generic "every card" loop. */
const LAYER_SYMBOLS = new Set(['outline', 'arabian-sea', 'bay-of-bengal', 'indian-ocean'])

describe('every subject in the content has an entry in the table', () => {
  it('has a row for every revealSymbol content/vocab.json declares', () => {
    for (const name of vocab.revealSymbol) {
      expect(SUBJECTS, `${name} has no entry in SUBJECTS`).toHaveProperty(name)
    }
  })

  it('has a row for every river content/vocab.json declares', () => {
    for (const name of vocab.rivers) {
      expect(SUBJECTS, `${name} has no entry in SUBJECTS`).toHaveProperty(name)
    }
  })

  it('has a row for every verb that is its own subject', () => {
    for (const verb of VERB_SUBJECT_KEYS) {
      expect(SUBJECTS, `${verb} has no entry in SUBJECTS`).toHaveProperty(verb)
    }
  })

  it('classifies only real cue verbs as their own subject', () => {
    // Catches a typo in VERB_SUBJECT_KEYS itself — the one hand-typed list
    // in this file, checked against content/schema.ts's own authoritative
    // list rather than trusted by eye.
    for (const verb of VERB_SUBJECT_KEYS) {
      expect(CUE_VERBS, `${verb} is not a real cue verb`).toContain(verb)
    }
  })
})

/**
 * `missingSubjects` is the pure comparison `checkSubjectCoverage` throws
 * from at import time — see subject.ts's own top note on why a subject with
 * no entry has to fail loudly rather than render grey. Exercised directly,
 * including the failing case, rather than only ever being seen to pass
 * because the real table happens to agree with the real content today.
 * Mirrors `scripts/lib/words.test.mjs`'s own test of `verbCoverageIssues`,
 * the same shape of guard for the same reason.
 */
describe('missingSubjects: the loud-failure detector', () => {
  it('reports every required key a table has no row for', () => {
    expect(missingSubjects(['tiger', 'ghost'], { tiger: {} })).toEqual(['ghost'])
  })

  it('reports nothing when the table covers every required key', () => {
    expect(missingSubjects(['tiger'], { tiger: {}, lotus: {} })).toEqual([])
  })

  it('finds nothing missing in the real table today', () => {
    // subject.ts already ran this exact check, successfully, at import
    // time (see checkSubjectCoverage) — the module import above pulling
    // in SUBJECTS without throwing is the "did not fail" half of the
    // proof. This re-derives the same comparison by hand, against the
    // real files, as a named assertion a future gap will fail loudly
    // here rather than only as an opaque import-time crash elsewhere.
    const required = [...vocab.revealSymbol, ...vocab.rivers, ...VERB_SUBJECT_KEYS]
    expect(missingSubjects(required, SUBJECTS)).toEqual([])
  })
})

describe('subjectKeyFor', () => {
  it('keys revealSymbol and traceRiver by their own argument', () => {
    expect(subjectKeyFor('revealSymbol', 'tiger')).toBe('tiger')
    expect(subjectKeyFor('traceRiver', 'ganga')).toBe('ganga')
  })

  it('keys countTo, showScript, unfurlFlag, raiseMountains and zoomTo by the verb, never the argument', () => {
    // The real bug this guards: content/tour.json's countTo/traceRiver/
    // showScript cues always carry an argument ("28", "ganga", "namaste"),
    // so a naive `cue.arg ?? cue.do` never once reaches the verb branch —
    // it would key the counting disc by the number it happens to be
    // showing rather than by "counting".
    expect(subjectKeyFor('countTo', '28')).toBe('countTo')
    expect(subjectKeyFor('showScript', 'namaste')).toBe('showScript')
    expect(subjectKeyFor('unfurlFlag', undefined)).toBe('unfurlFlag')
    expect(subjectKeyFor('raiseMountains', undefined)).toBe('raiseMountains')
    expect(subjectKeyFor('zoomTo', 'delhi')).toBe('zoomTo')
  })

  it('answers undefined for a cue that puts no picture on stage', () => {
    expect(subjectKeyFor('playSfx', 'tiger-growl')).toBeUndefined()
    expect(subjectKeyFor('highlightAllStates', undefined)).toBeUndefined()
    expect(subjectKeyFor('highlightState', 'kerala')).toBeUndefined()
  })
})

describe('subjectOf', () => {
  it('never throws and always answers the default for an uncoloured key', () => {
    expect(subjectOf('unicorn')).toEqual(DEFAULT_SUBJECT)
    expect(subjectOf(null)).toEqual(DEFAULT_SUBJECT)
    expect(subjectOf(undefined)).toEqual(DEFAULT_SUBJECT)
  })

  it('answers a real row for a real subject', () => {
    expect(subjectOf('tiger')).toEqual(SUBJECTS.tiger)
  })
})

/**
 * "No subject reads a colour from anywhere else." Every one of these renders
 * the real component and checks its painted colour against `subjectOf`,
 * rather than against a second hand-typed hex — so a component that quietly
 * went back to a literal of its own (matching subject.ts today, drifting
 * from it tomorrow) fails here rather than passing by coincidence.
 */
describe('every reveal paints itself from subject.ts', () => {
  const pageRect = (container: HTMLElement) =>
    container.querySelector('svg.cue-art')?.querySelector(':scope > rect') ?? null

  it("gives every Card-based symbol its own row's page and ink", () => {
    const cardSymbols = vocab.revealSymbol.filter((n) => !LAYER_SYMBOLS.has(n))
    expect(cardSymbols.length).toBeGreaterThan(0)
    for (const name of cardSymbols) {
      const { container, unmount } = render(<Symbol name={name} />)
      const rect = pageRect(container)
      expect(rect, `${name} drew no page`).toHaveAttribute('fill', subjectOf(name).page)
      const rects = container.querySelector('svg.cue-art')!.querySelectorAll(':scope > rect')
      const rule = rects[rects.length - 1]
      expect(rule, `${name} drew no rule`).toHaveAttribute('stroke', subjectOf(name).ink)
      unmount()
    }
  })

  it("gives the flag its own row's page, not the plain-paper default by coincidence", () => {
    const { container } = render(<Flag />)
    expect(pageRect(container)).toHaveAttribute('fill', subjectOf('unfurlFlag').page)
  })

  it("gives the counting disc its own row's page, accent and ink", () => {
    const { container } = render(<Counter to={28} />)
    const circles = container.querySelectorAll('.cue-counter__disc circle')
    const { page, accent, ink } = subjectOf('countTo')
    expect(circles[0]).toHaveAttribute('fill', page)
    expect(circles[1]).toHaveAttribute('stroke', accent)
    expect(circles[2]).toHaveAttribute('stroke', ink)
  })

  it("draws the Ganga in its own row's accent", () => {
    const { container } = render(<River name="ganga" />)
    const paths = container.querySelectorAll('.cue-map path')
    expect(paths[paths.length - 1]).toHaveAttribute('stroke', subjectOf('ganga').accent)
  })

  it("draws every named sea in its own row's accent", () => {
    for (const id of ['arabian-sea', 'bay-of-bengal', 'indian-ocean']) {
      const { container, unmount } = render(<Seas named={id} />)
      const waves = container.querySelector(`[data-sea="${id}"] > g`)
      expect(waves, `${id} drew no waves`).toHaveAttribute('stroke', subjectOf(id).accent)
      unmount()
    }
  })

  it("draws the look-down ring in zoomTo's own accent", () => {
    const { container } = render(<Here at={[0, 0]} />)
    const circle = container.querySelector('.cue-map circle')
    expect(circle).toHaveAttribute('fill', subjectOf('zoomTo').accent)
  })

  it("draws the traced outline in its own row's accent", () => {
    const { container } = render(<Outline />)
    const path = container.querySelector('.cue-map path')
    expect(path).toHaveAttribute('stroke', subjectOf('outline').accent)
  })
})

/**
 * THE INDIA PASSPORT — which places a child has finished, remembered on this
 * device and nowhere else.
 *
 * It was a Milestone 1 item in the design spec (§7 "India Passport", §10) and
 * was never built; its three narration lines were written, fact-checked and
 * paid for in the render with nothing in the app to play them. A child
 * exploring 36 places over many days had no way to see how far he had come,
 * and every visit started from nothing.
 *
 * PRIVACY IS THE SPEC'S OWN RULE, NOT A NICETY. §12: "No accounts, no
 * analytics... The only stored state is the passport, in localStorage on the
 * device." So this is one key holding slugs and the time each was earned —
 * no name, no age, no identifier, nothing that leaves the iPad.
 *
 * STORAGE IS NOT GUARANTEED, and the passport must not break when it is
 * missing. iPad Safari's Private Browsing, a full disk, or a grown-up who has
 * switched off website data all make `localStorage` throw. Every access is
 * guarded, and an in-memory copy carries the stamps for the rest of the visit
 * whatever the device says — the child still hears "you have a new stamp" and
 * still sees it in the passport; it simply does not outlive the tab.
 */

export const PASSPORT_KEY = 'namaste-india:passport:v1'

type Entry = { slug: string; at: number }
type Stored = { v: 1; stamps: Entry[] }

/** The session's own copy. `null` means "not read yet", which is what lets a
 *  test (or a reload) start over by clearing it. */
let held: Entry[] | null = null

/**
 * Read back whatever is on the device, keeping only what makes sense. A
 * corrupted or hand-edited record must never take the passport down, so this
 * drops anything malformed rather than throwing, and keeps the FIRST stamp
 * for any place that somehow appears twice.
 */
function readDevice(): Entry[] {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(PASSPORT_KEY)
  } catch {
    return []
  }
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  const stamps = (parsed as Partial<Stored> | null)?.stamps
  if (!Array.isArray(stamps)) return []
  const seen = new Set<string>()
  const out: Entry[] = []
  for (const e of stamps) {
    if (!e || typeof e !== 'object') continue
    const { slug, at } = e as Partial<Entry>
    if (typeof slug !== 'string' || slug === '' || typeof at !== 'number' || seen.has(slug)) continue
    seen.add(slug)
    out.push({ slug, at })
  }
  return out
}

function entries(): Entry[] {
  if (held === null) held = readDevice()
  return held
}

function writeDevice(stamps: Entry[]): void {
  const record: Stored = { v: 1, stamps }
  try {
    localStorage.setItem(PASSPORT_KEY, JSON.stringify(record))
  } catch {
    /* The device refused. `held` still has it for this visit — see the note
       at the top of this file. */
  }
}

/**
 * The places stamped so far, in the order they were earned. Pass the set of
 * places that actually exist to drop anything left over from an older
 * version of the app that named a place this one no longer has.
 */
export function stampedSlugs(known?: ReadonlySet<string>): string[] {
  const slugs = entries().map((e) => e.slug)
  return known ? slugs.filter((s) => known.has(s)) : slugs
}

export function hasStamp(slug: string): boolean {
  return entries().some((e) => e.slug === slug)
}

/**
 * Stamp a place. Returns whether this was the FIRST time — the caller says
 * "Well done! You have a new stamp." only then, so a child finishing a place
 * for the second time is never told he earned something he already had.
 */
export function addStamp(slug: string, now: number = Date.now()): boolean {
  if (hasStamp(slug)) return false
  held = [...entries(), { slug, at: now }]
  writeDevice(held)
  return true
}

/** Forget the in-memory copy, exactly as a page reload would. Tests only. */
export function resetPassportForTests(): void {
  held = null
}

import geo from '../data/geo.json'
import { PALETTE } from '../tour/effects/art/palette'
import type { Bbox } from '../types'
import './stamp.css'

type GeoPlace = { name: string; d: string; bbox: Bbox }
const GEO = geo.places as unknown as Record<string, GeoPlace>

/**
 * The inks a stamp can be pressed in. A real passport is a jumble of colours
 * from different desks, and one colour for all 36 would read as a printed
 * grid rather than a collection a child built up himself.
 *
 * LITERAL HEX FROM `PALETTE`, never `var()`: these land in SVG presentation
 * attributes, and WebKit's legacy SVG engine does not resolve custom
 * properties there — it silently paints black on an iPad and nowhere else
 * (docs/handover.md, "the standing rules"). Every one is dark enough to read
 * against the paper the passport is printed on.
 */
const INKS = [PALETTE.peacock, PALETTE.leafDeep, PALETTE.saffron, PALETTE.peacockTeal, PALETTE.bark]

/** A small stable number from a string, so a place's ink and tilt are the
 *  same every time the passport opens — a stamp does not change colour when
 *  you look at it again. */
function seed(s: string): number {
  let h = 7
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

/**
 * One passport stamp: the place's OWN outline, inside a double ring.
 *
 * The outline comes from the same `geo.json` the map draws, so every stamp
 * is a true picture of its place rather than a stock icon — the shape of
 * Kerala, not "a state". It is scaled to its own bounding box, which is why
 * a tiny place (Delhi, Chandigarh) fills its stamp as fully as a huge one.
 * The scattered ones (Lakshadweep, the Andamans, Puducherry's four separate
 * pieces) honestly come out as scattered marks: that is what they look like.
 *
 * `vectorEffect="non-scaling-stroke"` keeps the outline the same thickness
 * on screen whatever the place's real size — without it Rajasthan's edge
 * would be a hairline and Delhi's a slab.
 *
 * Not yet stamped: a faint dashed outline in an empty dashed ring, so a
 * child can see what is still to find without it reading as done.
 */
export function Stamp({ slug, stamped, fresh = false }: { slug: string; stamped: boolean; fresh?: boolean }) {
  const place = GEO[slug]
  if (!place) return null
  const [x, y, w, h] = place.bbox
  const pad = Math.max(w, h) * 0.06
  const ink = INKS[seed(slug) % INKS.length]
  // -7..+7 degrees: pressed by hand, never twice the same.
  const tilt = (seed(`${slug}:tilt`) % 15) - 7
  const line = stamped ? ink : PALETTE.stoneDeep

  return (
    <svg
      className={`stamp${stamped ? ' stamp--stamped' : ' stamp--empty'}${fresh ? ' stamp--fresh' : ''}`}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
      style={stamped ? { ['--tilt' as string]: `${tilt}deg` } : undefined}
    >
      {stamped ? (
        <>
          <circle cx="50" cy="50" r="46" fill="none" stroke={ink} strokeWidth="4" />
          <circle cx="50" cy="50" r="39.5" fill="none" stroke={ink} strokeWidth="1.5" />
        </>
      ) : (
        <circle cx="50" cy="50" r="46" fill="none" stroke={line} strokeWidth="1.5" strokeDasharray="4 5" />
      )}
      <svg
        x="20"
        y="20"
        width="60"
        height="60"
        viewBox={`${x - pad} ${y - pad} ${w + 2 * pad} ${h + 2 * pad}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <path
          d={place.d}
          fill={stamped ? ink : 'none'}
          fillOpacity={stamped ? 0.9 : undefined}
          stroke={line}
          strokeWidth={stamped ? 1.5 : 1.25}
          // Solid even when not yet stamped (only the RING is dashed). The
          // first version dashed the outline too, and on a place made of
          // specks — Lakshadweep, Dadra/Daman/Diu — a 3px dash pattern is
          // mostly gap, so those two slots looked empty. Faint is enough to
          // say "not yet"; it must not say "nothing here".
          strokeOpacity={stamped ? undefined : 0.75}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </svg>
  )
}

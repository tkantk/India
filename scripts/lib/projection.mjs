/**
 * The ONE projection every layer of the map is drawn with.
 *
 * `build-map.mjs` (India's 36 states) and `build-world.mjs` (the neighbouring
 * land beneath them) both call `indiaProjection`, and both must call it with
 * the SAME feature collection — India's own rewound state boundaries, the
 * feature collection the depiction gate in `build-map.mjs` has already
 * verified reaches ~37.08N.
 *
 * `fitSize` is a pure function of `(W, H, fc)`: same inputs, byte-identical
 * scale and translate, whoever calls it. That is what makes importing this
 * function safe where re-deriving the same five lines in a second file is
 * not — two independent `.fitSize(...)` calls only stay in step for as long
 * as nobody edits one of them, and the day someone does, `svg.sea` quietly
 * stops sitting under `svg.base`'s coastline with nothing to say why.
 * `build-world.mjs` needs India's own feature collection anyway, to erase
 * India's depicted boundary out of its neighbours' polygons, so handing it
 * to the SAME function that fits the map costs nothing extra.
 */
import { geoConicConformal } from 'd3-geo'

/** The map's viewBox, in SVG user units. Every layer that shares this
 *  projection is drawn at this size, or `fitSize` below no longer means
 *  what its name says. */
export const W = 1000
export const H = 1100

/** Survey of India LCC standard parallels; central meridian 80E — fitted to
 *  `fc`, which must be India's own rewound state boundaries. */
export function indiaProjection(fc) {
  return geoConicConformal()
    .parallels([12.4729, 35.1728])
    .rotate([-80, 0])
    .precision(2)
    .fitSize([W, H], fc)
}

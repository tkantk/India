import geo from '../data/geo.json'
import world from '../data/world.json'
import photoCredits from '../data/photo-credits.json'
import soundCredits from '../data/sound-credits.json'
import './credits.css'

/**
 * THE CREDITS PAGE, AND WHY IT IS NOT OPTIONAL.
 *
 * The app bundles a growing set of photographs (landmarks and, since Task
 * 5a, animals — see `PHOTOS`' own note below), a few dozen sounds and one
 * set of state boundaries that other people made. Most of the photographs
 * and most of the sounds carry `attributionRequired: true`. CC BY 4.0 s3(a) and CC
 * BY-SA 4.0 s3(a) attach that duty to SHARING the material — making it
 * available — not to putting it on a screen. The repository shares every
 * one of these files and so does the deployed site, so the credit was
 * already owed before a single landmark photograph was displayed to
 * anybody. This page is how it is paid.
 *
 * Deliberately no fixed count anywhere on this page or in its own test —
 * `Credits.test.tsx` used to pin an exact number and broke the day Task 5a
 * added four photographs nobody had to touch this file for. Every count
 * below (`Object.keys(PHOTOS).length` etc.) is read off the JSON at render
 * time for exactly that reason.
 *
 * WHO IT IS FOR. Not the child. Everything else in this app is sized and
 * worded for a six-year-old; this is a page an adult reads, so it is set in
 * ordinary body type in an ordinary scrolling column, and it is reached
 * through a small link on the map's existing credit line rather than through
 * a sixth 104px button competing with the five that matter.
 *
 * THE CREDIT TEXT IS NOT WRITTEN HERE. `attributionHtml` is generated at
 * fetch time by `scripts/lib/wiki.mjs` from Wikimedia's own extmetadata, and
 * already names the author, links the licence deed and links the source page
 * — the three things the licences ask for. It is rendered verbatim, markup
 * and all, because rewriting it by hand is exactly how a credit goes wrong.
 * `dangerouslySetInnerHTML` is the honest way to say that: the HTML is
 * committed build output that a human reviewed, not anything a user typed.
 */

type Credit = {
  file: string
  fileTitle: string
  artist: string
  licence: string
  licenceShort: string
  licenceUrl: string | null
  attributionRequired: boolean
  descriptionUrl: string
  attributionHtml: string
}

/** A sound carries one field a photograph does not: what we did to it.
 *  `source` is absent on the older Commons credits, which predate it. */
type SoundCredit = Credit & { kind: string; seconds: number; modifications: string; source?: string }

/** Where a sound came from, in the words the sources use for themselves. */
const SOURCE_NAMES: Record<string, string> = {
  commons: 'Wikimedia Commons',
  xc: 'xeno-canto',
  inat: 'iNaturalist',
  freesound: 'Freesound',
}

const soundSources = (sounds: Record<string, SoundCredit>) => {
  const names = Object.keys(SOURCE_NAMES)
    .filter((k) => Object.values(sounds).some((c) => (c.source ?? 'commons') === k))
    .map((k) => SOURCE_NAMES[k])
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]
}

const PHOTOS: Record<string, Credit> = photoCredits
/** Photo credits use `source` for the Commons search tier that found a
 *  file ("override", "lead"…); only a picked photograph from outside
 *  Commons says where it came from, and today that means iNaturalist. */
const INAT_PHOTOS = Object.values(PHOTOS).filter((c) => (c as Credit & { source?: string }).source === 'inat').length
const SOUNDS: Record<string, SoundCredit> = soundCredits

/** "File:LotusDelhi.jpg" is a Commons address; "LotusDelhi.jpg" is a name. */
const nameOf = (fileTitle: string) => fileTitle.replace(/^File:/, '')

/**
 * Share-alike is the only licence family that makes our editing anybody
 * else's business: a CC BY-SA or CC BY-NC-SA adaptation must itself be
 * offered under the same licence. Keyed off the machine-readable code, which
 * is what `licencePolicy` allowlisted in the first place. (This once matched
 * `cc-by-sa` only, and would have dropped the notice from every NC-SA field
 * recording.)
 */
const isShareAlike = (licence: string) => /^cc-by(-nc)?-sa/i.test(licence)

/**
 * Non-commercial files are allowed only because this site is free and
 * carries no advertising. Each one says so, so that if that ever changes
 * every one of them can be found and replaced. Mirrors `isNonCommercial`
 * in scripts/lib/wiki.mjs.
 */
const isNonCommercial = (licence: string) => /^cc-by-nc/i.test(licence)

function Attribution({ html }: { html: string }) {
  return <p className="credit-item__by" dangerouslySetInnerHTML={{ __html: html }} />
}

function NonCommercial() {
  return (
    <p className="credit-item__edit">
      Non-commercial licence: used here because Namaste India is free and carries no
      advertising. It may not be reused for commercial purposes.
    </p>
  )
}

function PhotoItem({ id, credit }: { id: string; credit: Credit }) {
  return (
    <li className="credit-item" data-testid={`credit-photo-${id}`}>
      <h3 className="credit-item__title">{nameOf(credit.fileTitle)}</h3>
      <p className="credit-item__file">{credit.file}</p>
      <Attribution html={credit.attributionHtml} />
      {isNonCommercial(credit.licence) && <NonCommercial />}
    </li>
  )
}

function SoundItem({ id, credit }: { id: string; credit: SoundCredit }) {
  return (
    <li className="credit-item" data-testid={`credit-sound-${id}`}>
      <h3 className="credit-item__title">{nameOf(credit.fileTitle)}</h3>
      <p className="credit-item__file">{credit.file} · {credit.seconds}s</p>
      <Attribution html={credit.attributionHtml} />
      <p className="credit-item__edit">
        Modified for this app: {credit.modifications}.
        {isShareAlike(credit.licence) && (
          <> This modified recording is itself offered under {credit.licenceShort}, the
          same licence as the source.</>
        )}
      </p>
      {isNonCommercial(credit.licence) && <NonCommercial />}
    </li>
  )
}

export function Credits() {
  return (
    <main className="credits">
      <div className="credits__column">
        {/* A plain hash link, not react-router's <Link>. The map's credit
            line — the other end of this journey — is rendered by MapStage,
            which the tests and the headless probes mount with no Router
            around it; a hash link needs none and behaves identically under
            HashRouter. */}
        <a className="credits__back" href="#/">← Back to the map</a>

        <h1>Credits and licences</h1>

        <p className="credits__lede">
          Namaste India is built out of work that other people made and shared.
          Everything below is used under a licence that asks for exactly this:
          the author named, the licence linked, and the source findable. The
          application code itself is MIT-licensed; see <code>LICENSE</code> and{' '}
          <code>NOTICE</code> in the repository for the full split.
        </p>

        <section className="credits__section" aria-labelledby="credits-map">
          <h2 id="credits-map">Map</h2>
          <ul className="credits__list">
            <li className="credit-item" data-testid="credit-map-datameet">
              <h3 className="credit-item__title">India state and union territory boundaries</h3>
              <p className="credit-item__file">src/data/geo.json</p>
              {/* Word for word what `geo.attribution` says, and what the map
                  itself shows: one required credit, one wording. */}
              <p className="credit-item__by">{geo.attribution}</p>
              <p className="credit-item__source">
                <a href="https://github.com/datameet/maps">datameet/maps</a>, licensed{' '}
                <a href="https://creativecommons.org/licenses/by/4.0/" rel="license noopener">
                  CC BY 4.0
                </a>
              </p>
              <p className="credit-item__edit">
                Modified for this app: simplified to about 2% of its original
                vertices (Visvalingam, shape-preserving), reprojected conic
                conformal and rendered to SVG paths.
              </p>
            </li>
          </ul>
        </section>

        <section className="credits__section" aria-labelledby="credits-world">
          <h2 id="credits-world">Neighbouring land</h2>
          <ul className="credits__list">
            <li className="credit-item" data-testid="credit-world-naturalearth">
              <h3 className="credit-item__title">Neighbouring countries beyond India's border</h3>
              <p className="credit-item__file">src/data/world.json</p>
              <p className="credit-item__by">{world.attribution}</p>
              <p className="credit-item__source">
                <a href="https://www.naturalearthdata.com/">Natural Earth</a>, public domain —
                no permission or attribution required. Credited anyway, in keeping with every
                other source on this page.
              </p>
              <p className="credit-item__edit">
                Modified for this app: countries other than India, cropped to a box around
                India, erased against India's own depicted boundary, reprojected to match
                src/data/geo.json and rendered to SVG paths.
              </p>
            </li>
          </ul>
        </section>

        <section className="credits__section" aria-labelledby="credits-photos">
          <h2 id="credits-photos">Photographs</h2>
          <p className="credits__note">
            {Object.keys(PHOTOS).length} photographs: landmarks, and each
            state's own animal, fetched by species rather than by common name
            so the picture is the right animal.{' '}
            {INAT_PHOTOS > 0 ? (
              <>
                {Object.keys(PHOTOS).length - INAT_PHOTOS} come from Wikimedia
                Commons, as thumbnails rendered by Wikimedia's own servers;{' '}
                {INAT_PHOTOS} wild animals no Commons photograph showed honestly
                come from iNaturalist, as served.
              </>
            ) : (
              <>All come from Wikimedia Commons, as thumbnails rendered by Wikimedia's own servers.</>
            )}{' '}
            Every one is stored unaltered — a change of size and format at
            most, not of content, so none of them has been adapted. They are
            part of the deployed site.
          </p>
          <ul className="credits__list">
            {Object.entries(PHOTOS).map(([id, credit]) => (
              <PhotoItem key={id} id={id} credit={credit} />
            ))}
          </ul>
        </section>

        <section className="credits__section" aria-labelledby="credits-sounds">
          <h2 id="credits-sounds">Sounds</h2>
          <p className="credits__note">
            {Object.keys(SOUNDS).length} sound effects, animal calls and ambient
            beds from {soundSources(SOUNDS)}. The animal calls are field
            recordings of wild animals, most of them made in India. Unlike the photographs, every one of these was
            edited to fit the app — cut short, levelled, and in the case of an
            ambient bed welded into a seamless loop — and then decoded to mono
            and re-encoded as AAC. Cutting and levelling change the content, so
            each of these is Adapted Material, and where the source is
            share-alike the edited file is offered under the same licence. What
            was done to each one is spelled out below.
          </p>
          <ul className="credits__list">
            {Object.entries(SOUNDS).map(([id, credit]) => (
              <SoundItem key={id} id={id} credit={credit} />
            ))}
          </ul>
        </section>
      </div>
    </main>
  )
}

import geo from '../data/geo.json'
import photoCredits from '../data/photo-credits.json'
import soundCredits from '../data/sound-credits.json'
import './credits.css'

/**
 * THE CREDITS PAGE, AND WHY IT IS NOT OPTIONAL.
 *
 * The app bundles 20 photographs, 11 sounds and one set of state boundaries
 * that other people made. 18 of the photographs and 7 of the sounds carry
 * `attributionRequired: true`. CC BY 4.0 s3(a) and CC BY-SA 4.0 s3(a) attach
 * that duty to SHARING the material — making it available — not to putting
 * it on a screen. The repository shares all 31 files and so does the deployed
 * site, so the credit was already owed before a single landmark photograph
 * was displayed to anybody. This page is how it is paid.
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

/** A sound carries one field a photograph does not: what we did to it. */
type SoundCredit = Credit & { kind: string; seconds: number; modifications: string }

const PHOTOS: Record<string, Credit> = photoCredits
const SOUNDS: Record<string, SoundCredit> = soundCredits

/** "File:LotusDelhi.jpg" is a Commons address; "LotusDelhi.jpg" is a name. */
const nameOf = (fileTitle: string) => fileTitle.replace(/^File:/, '')

/**
 * Share-alike is the only licence family that makes our editing anybody
 * else's business: a CC BY-SA adaptation must itself be offered under the
 * same licence. Keyed off the machine-readable code, which is what
 * `licencePolicy` allowlisted in the first place.
 */
const isShareAlike = (licence: string) => /^cc-by-sa/i.test(licence)

function Attribution({ html }: { html: string }) {
  return <p className="credit-item__by" dangerouslySetInnerHTML={{ __html: html }} />
}

function PhotoItem({ id, credit }: { id: string; credit: Credit }) {
  return (
    <li className="credit-item" data-testid={`credit-photo-${id}`}>
      <h3 className="credit-item__title">{nameOf(credit.fileTitle)}</h3>
      <p className="credit-item__file">{credit.file}</p>
      <Attribution html={credit.attributionHtml} />
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

        <section className="credits__section" aria-labelledby="credits-photos">
          <h2 id="credits-photos">Photographs</h2>
          <p className="credits__note">
            {Object.keys(PHOTOS).length} landmark photographs from Wikimedia
            Commons. Each one is a thumbnail rendered by Wikimedia's own servers
            and stored unaltered — a change of size and format, not of content,
            so none of them has been adapted. They are bundled in the repository
            for a landmark feature that is not finished yet, and are not part of
            the deployed site.
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
            {Object.keys(SOUNDS).length} sound effects and ambient beds from
            Wikimedia Commons. Unlike the photographs, every one of these was
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

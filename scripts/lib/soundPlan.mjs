/**
 * What fetch-sounds.mjs does with one wanted sound. Pulled out of the
 * script so the one rule that matters can be tested:
 *
 *   NO SOUND IS EVER CHOSEN BY A SCRIPT.
 *
 * Until 2026-10-02 a sound with no credit fell through to a Commons search,
 * and the first hit that passed the licence check was cut, credited and
 * shipped, unheard and unseen. For months the searches found nothing, so it
 * never showed. Then on one run they did: the desert bed came back as a 1916
 * song with lyrics, the mountain bed as an American junco, the city bed as an
 * American police siren, and the island bed as President Clinton's remarks in
 * Palm Beach. A search engine's idea of relevance is not a choice.
 *
 * Every new sound now arrives as a pick in scripts/sound-picks.json, chosen
 * by reading its measurements, spectrogram and source page, then heard.
 *
 * @param {{ have?: object, onDisk: boolean, pick?: object }} s
 * @returns {'already-picked'|'fetch-pick'|'keep'|'refresh-commons'|'unpicked'}
 */
export function nextStep({ have, onDisk, pick }) {
  if (pick) return have && onDisk && have.descriptionUrl === pick.pageUrl ? 'already-picked' : 'fetch-pick'
  if (have && onDisk) return have.source && have.source !== 'commons' ? 'keep' : 'refresh-commons'
  return 'unpicked'
}

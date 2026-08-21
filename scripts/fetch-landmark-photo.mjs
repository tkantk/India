// Node 20+, zero deps. Usage: node fetch-landmark-photo.mjs "Taj Mahal" "Ellora Caves" ...
// Returns per landmark: {imageUrl, width, artist, licence, attributionHtml} or null

const UA = 'IndiaLandmarks/1.0 (https://github.com/YOURNAME/india-landmarks; you@example.com) node-fetch';
const EN  = 'https://en.wikipedia.org/w/api.php';
const WD  = 'https://www.wikidata.org/w/api.php';
const COM = 'https://commons.wikimedia.org/w/api.php';

const EM_FILTER = ['LicenseShortName','License','Artist','Credit','AttributionRequired',
                   'UsageTerms','LicenseUrl','Restrictions','Copyrighted','NonFree',
                   'ImageDescription','ObjectName'].join('|');

// Allowlist of machine-readable extmetadata.License codes we will ship.
// Deliberately excludes GFDL, fair use, "attribution", and custom terms.
const ALLOW = /^(cc0|pd|cc-by-\d(\.\d)?|cc-by-sa-\d(\.\d)?)$/i;
const GOOD_MIME = new Set(['image/jpeg','image/png','image/webp']);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(base, params, tries = 4) {
  const u = new URL(base);
  u.search = new URLSearchParams({ format:'json', formatversion:'2', origin:'*', maxlag:'5', ...params });
  for (let i = 0; i < tries; i++) {
    let res;
    try { res = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Encoding':'gzip' } }); }
    catch (e) { await sleep(1000 * 2 ** i); continue; }
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get('retry-after')) || 2 ** i;
      await sleep(ra * 1000); continue;
    }
    const j = await res.json();
    if (j.error?.code === 'maxlag') { await sleep((Number(j.error.lag) || 5) * 1000); continue; }
    if (j.error) throw new Error(`${j.error.code}: ${j.error.info}`);
    return j;
  }
  throw new Error('giving up after retries');
}

const clean = u => { const x = new URL(u); x.search = ''; return x.href; };          // drop ?utm_source=…
const realWidth = u => Number(clean(u).match(/\/(\d+)px-/)?.[1]) || null;             // actual delivered px
const stripTags = h => (h ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const absolutise = h => (h ?? '').replace(/href="\/\//g, 'href="https://');

/* ── Step 1: candidate file title ─────────────────────────────────────────── */

// 1a. Wikipedia lead image (PageImages). Batch up to 50 titles per call.
async function leadImages(names) {
  const out = new Map();                       // requested name -> {file} | {skip:reason}
  for (let i = 0; i < names.length; i += 50) {
    const batch = names.slice(i, i + 50);
    const j = await api(EN, {
      action:'query', redirects:'1', titles: batch.join('|'),
      prop:'pageimages|pageprops', piprop:'original|name', pilimit:'50',
      ppprop:'disambiguation',
    });
    const q = j.query ?? {};
    // rebuild requested-title -> final-title, following normalize + redirect
    const hop = new Map([...(q.normalized ?? []), ...(q.redirects ?? [])].map(r => [r.from, r.to]));
    const resolve = t => { let s = new Set(); while (hop.has(t) && !s.has(t)) { s.add(t); t = hop.get(t); } return t; };
    const byTitle = new Map((q.pages ?? []).map(p => [p.title, p]));
    for (const n of batch) {
      const p = byTitle.get(resolve(n));
      if (!p || p.missing) out.set(n, { skip:'no-article' });
      else if (p.pageprops && 'disambiguation' in p.pageprops) out.set(n, { skip:'disambiguation' });
      else if (!p.pageimage) out.set(n, { skip:'no-lead-image' });
      else out.set(n, { file:'File:' + p.pageimage, via:'pageimages', title:p.title });
    }
    await sleep(300);
  }
  return out;
}

// 1b. Wikidata P18 — curated "the image of this thing". Best fallback.
async function wikidataP18(name) {
  const j = await api(WD, {
    action:'wbgetentities', sites:'enwiki', titles:name, props:'claims', languages:'en',
  });
  for (const e of Object.values(j.entities ?? {})) {
    const f = e.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (f) return { file:'File:' + f, via:'wikidata-P18' };
  }
  return null;
}

// 1c. Commons full-text search. Last resort — noisy, see notes.
async function commonsSearch(name) {
  const j = await api(COM, {
    action:'query', generator:'search', gsrnamespace:'6', gsrlimit:'10',
    gsrsearch:`filetype:bitmap ${name}`,
    prop:'imageinfo', iiprop:'url|size|mime',
  });
  const pages = (j.query?.pages ?? []).sort((a, b) => a.index - b.index);
  for (const p of pages) {
    const ii = p.imageinfo?.[0]; if (!ii) continue;
    if (!GOOD_MIME.has(ii.mime)) continue;
    if (ii.width < 1200) continue;
    const ar = ii.width / ii.height;
    if (ar < 0.55 || ar > 2.6) continue;                    // panoramas & tall strips
    if (/\b(map|plan|diagram|logo|seal|chart|coin|stamp)\b/i.test(p.title)) continue;
    return { file:p.title, via:'commons-search' };
  }
  return null;
}

/* ── Step 2: file metadata + licence gate ─────────────────────────────────── */

async function fileInfo(fileTitles, width = 900) {
  const out = new Map();
  for (let i = 0; i < fileTitles.length; i += 50) {
    const j = await api(EN, {                    // enwiki resolves Commons files (imagerepository:"shared")
      action:'query', titles: fileTitles.slice(i, i + 50).join('|'),
      prop:'imageinfo', iiprop:'url|size|mime|extmetadata',
      iiurlwidth: String(width), iiextmetadatafilter: EM_FILTER,
    });
    for (const p of j.query?.pages ?? []) {
      // NB: enwiki reports missing:true for Commons files with no local description
      // page, yet still returns full imageinfo. Do NOT filter on p.missing here.
      if (!p.imageinfo?.[0]) continue;
      out.set(p.title, { ...p.imageinfo[0], imagerepository: p.imagerepository, fileTitle: p.title });
    }
    await sleep(300);
  }
  return out;
}

function vet(ii) {
  const em = ii.extmetadata ?? {};
  const g = k => em[k]?.value;
  if (ii.imagerepository !== 'shared') return { ok:false, why:'not-on-commons (local upload, often non-free)' };
  if (String(g('NonFree')).toLowerCase() === 'true') return { ok:false, why:'NonFree=true (fair use)' };
  const code = String(g('License') ?? '').toLowerCase();
  const short = String(g('LicenseShortName') ?? '');
  if (/fair use|non-?free/i.test(short)) return { ok:false, why:`LicenseShortName="${short}"` };
  // NB: `License` is ABSENT for some licensed files (e.g. GFDL-only -> only
  // LicenseShortName:"GFDL 1.2"). Absent code therefore must fail the allowlist.
  if (!ALLOW.test(code)) return { ok:false, why:`licence "${code || short || 'unknown'}" not allowlisted` };
  const restr = String(g('Restrictions') ?? '');
  if (/trademark|personality/i.test(restr)) return { ok:false, why:`Restrictions=${restr}` };
  // Heuristic only - title text is unreliable, a human contact-sheet pass is still required.
  if (/collage|montage|composite|diagram|satellite|\bISS\d{3}|\bmaps?\b|\bplan\b|\bsketch\b/i.test(ii.fileTitle))
    return { ok:false, why:'title looks like a non-photo/composite' };
  if (!GOOD_MIME.has(ii.mime)) return { ok:false, why:`mime ${ii.mime}` };
  if (ii.width < 800) return { ok:false, why:`too small (${ii.width}px)` };
  const ar = ii.width / ii.height;
  if (ar < 0.5 || ar > 3) return { ok:false, why:`extreme aspect ${ar.toFixed(2)}` };
  return { ok:true };
}

function attribution(ii) {
  const em = ii.extmetadata ?? {};
  const g = k => em[k]?.value;
  const code   = String(g('License') ?? '').toLowerCase();
  const short  = g('LicenseShortName') ?? g('UsageTerms') ?? code;
  const artist = stripTags(g('Artist')) || 'Unknown author';
  const url    = g('LicenseUrl');
  const page   = ii.descriptionurl;
  const isPD   = code === 'pd' || code === 'cc0';
  const artistHtml = absolutise(g('Artist')) || 'Unknown author';
  const licHtml = url ? `<a href="${url}" rel="license noopener">${short}</a>` : short;
  return {
    artist,
    licence: code || short,
    licenceShort: short,
    licenceUrl: url ?? null,
    attributionRequired: String(g('AttributionRequired') ?? (isPD ? 'false' : 'true')) === 'true',
    credit: stripTags(g('Credit')) || null,
    descriptionUrl: page,
    attributionHtml: isPD
      ? `${artistHtml}, <a href="${page}">via Wikimedia Commons</a> (${licHtml})`
      : `${artistHtml}, ${licHtml}, <a href="${page}">via Wikimedia Commons</a>`,
  };
}

/* ── Public API ───────────────────────────────────────────────────────────── */

// ~5-10% of a 180-name list needs a hand-picked file. Empirically required for e.g.
// Mysore Palace (lead image is GFDL-1.2-only, which we refuse to ship).
export const OVERRIDES = {
  'Mysore Palace': 'File:Mysore Palace WLM 2022 India 14.jpg',
};

export async function fetchLandmarkPhoto(name, { width = 900 } = {}) {
  if (OVERRIDES[name]) {
    const ii = (await fileInfo([OVERRIDES[name]], width)).get(OVERRIDES[name].replace(/_/g, ' '));
    if (ii) { const v = vet(ii); if (v.ok) return pack(name, 'override', ii); 
              console.error(`  override ${OVERRIDES[name]} rejected: ${v.why}`); }
  }
  const lead = (await leadImages([name])).get(name);
  const cands = [];
  if (lead?.file) cands.push(lead);
  const wd = await wikidataP18(name); if (wd) cands.push(wd);
  const cs = await commonsSearch(name); if (cs) cands.push(cs);

  const infos = await fileInfo([...new Set(cands.map(c => c.file))], width);
  for (const c of cands) {
    const ii = infos.get(c.file.replace(/_/g, ' '));
    if (!ii) { console.error(`  reject ${c.file} (${c.via}): file not found`); continue; }
    const v = vet(ii);
    if (!v.ok) { console.error(`  reject ${c.file} (${c.via}): ${v.why}`); continue; }
    return pack(name, c.via, ii);
  }
  return null;
}

function pack(name, via, ii) {
  const imageUrl = clean(ii.thumburl ?? ii.url);
  return {
    landmark: name,
    source: via,
    fileTitle: ii.fileTitle,
    imageUrl,
    width: realWidth(imageUrl) ?? ii.thumbwidth ?? ii.width,  // ACTUAL delivered px, not requested
    requestedWidth: ii.thumbwidth ?? null,                    // what we asked for (API echoes this back)
    originalUrl: clean(ii.url),
    originalWidth: ii.width,
    ...attribution(ii),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const names = process.argv.slice(2);
  for (const n of names) {
    const r = await fetchLandmarkPhoto(n);
    console.log(JSON.stringify(r, null, 2));
    await sleep(1000);                       // ~1 req/s overall: polite for a 180-item run
  }
}

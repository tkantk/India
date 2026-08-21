# Namaste India — Mor's Big Journey

**Design spec** · 2026-08-21

An interactive, narrated map of India for a 6–8 year old. Static site, hosted free on GitHub Pages.

---

## 1. Purpose and success criteria

A child of 6–8 opens the site on an iPad, taps a big play button, and is taken on a
guided, spoken tour of India. He can then tap any state, hear about it, and explore
five landmarks inside it. He learns the shape of his country, its states and capitals,
its animals, food, festivals and greetings — by listening and touching, not reading a wall of text.

**It has succeeded when:**

- A child who cannot yet read fluently can operate the whole site alone, with no adult help and no dead ends.
- Every screen has something to tap, and a way back.
- The narration voice is calm and slow enough to follow, and every word on screen lights up as it is spoken.
- All 28 states and 8 union territories are present and complete. No greyed-out placeholders.
- It loads and animates smoothly on an older iPad.
- Nothing on the site calls the internet at runtime, shows an advert, tracks the child, or asks for any personal information.

**Explicit non-goals for this version:** quizzes and games (Phase 2), Hindi narration
(structure prepared, audio not produced), user accounts, any server component.

---

## 2. Audience and tone

Target reader/listener: 6–8 years old, early reader, Indian family.

Writing rules for every narrated line:

- Short sentences. One idea per sentence.
- Concrete before abstract. "A desert is a place made of sand, where it almost never rains" — then name the Thar.
- Numbers a child can hold: "twenty-eight" not "28 (as of the 2019 reorganisation)".
- Second person and wonder: "Look at how big it is!"
- No dates before 1900 unless the place is famous for them. No political history. No violence.
- Every unfamiliar word gets explained in the same breath.
- 45–70 words per clip. About 25–35 seconds at narration pace.

---

## 3. Structure

Three levels. Every level is reachable from every other level in one tap.

| Level | Route | Contents |
|---|---|---|
| **India** | `#/` | Full SVG map, all states tappable, big ▶ Grand Tour button, passport button |
| **State** | `#/s/:stateId` | State fills the screen. Intro narration, State Card, five landmark cards |
| **Landmark** | `#/s/:stateId/l/:landmarkId` | Wide illustrated scene, narration, real-photo peek |

Hash routing, so GitHub Pages needs no 404 rewrite and any screen can be bookmarked.

---

## 4. The Grand Tour

A hands-free narrated sequence of about 3½ minutes on the India screen, driven entirely
by narration cues. Storyboard, one clip per beat:

1. **Welcome.** Mor the peacock glides in, tail fanning. "Namaste! I am Mor. Come, let me show you India."
2. **The shape.** India's outline draws itself with a pencil stroke, then fills with colour.
3. **The states.** "India has twenty-eight states." States light up in a wave; a counter ticks 1…28.
4. **The union territories.** Eight UTs pulse in a second colour; counter ticks 1…8.
5. **The capital.** Map dims, Delhi glows, camera pushes in, Delhi expands to fill the screen, India Gate rises, then the camera pulls back out.
6. **The flag.** Tricolour unfurls; saffron, white and green paint in; the Ashoka Chakra spins into place.
7. **The tiger.** National animal pads in → **growl** → holds a proud pose.
8. **The peacock.** Mor puffs up → **peacock call** → tail fans full width.
9. **Lotus, banyan, mango.** Lotus blooms with a water ripple; banyan grows its hanging roots; mangoes drop.
10. **The Ganga.** The river traces its path from the Himalayas to the Bay of Bengal, water sound following the line.
11. **The Himalayas.** Mountains rise along the north like a crown, with wind.
12. **The seas.** Arabian Sea, Bay of Bengal and Indian Ocean fade in with rolling waves.
13. **The people.** "Hello" pops up across the map in a dozen real scripts.
14. **Invitation.** "Now tap any state — let us go exploring!"

The tour can be paused, resumed, replayed from the start, or abandoned by tapping a state.

---

## 5. Inside a state

**Opening animation.** The tapped state peels up off the map while the rest of the country
desaturates and recedes. It flies to centre, its outline pencil-traces, then a scene paints
in behind it. The ambient bed fades up.

**Intro narration.** Where it is, how big, what it is famous for, and its capital.
Neighbouring states light up one at a time as they are named — computed from the real
geometry, not hand-typed.

**State Card.** Four tiles, tappable in any order, each with its own short narration:

- 🐅 **Animal** — the state animal, illustrated, with its real sound.
- 🍛 **Food** — one famous dish, described so a child can picture eating it.
- 🎉 **Festival** — the biggest festival and what people actually do at it.
- 👋 **Hello** — how to greet someone, shown in the real script and spoken.

**Five landmarks.** Cards along the bottom. Tapping one opens the landmark view.

**Passport stamp.** Awarded when the intro plus all five landmarks have been heard.

---

## 6. Landmark view

A wide illustrated scene with parallax layers and moving parts — a camel crossing the dunes,
waves rolling in, the Konark wheel turning. Narration plays with word-by-word highlighting.
A 📷 button flips the scene over to reveal a real photograph with its credit.

---

## 7. Cross-cutting features

### Read-along highlighting
The current sentence sits at the bottom of the screen in large type. Each word brightens
exactly as it is spoken, driven by word timings returned by the speech provider.

### India Passport
A passport page with 36 slots. Each completed state earns an illustrated stamp. Progress
reads "You have explored 12 of 36!". Stored in `localStorage` only — nothing leaves the device.

### Symbol reveal
A single reusable mechanism: a narration cue names a symbol, its illustration animates in,
and its sound plays. Used by the Grand Tour for national symbols and by every State Card
for state animals.

### Child controls
Persistent, large (minimum 60px touch targets): pause/play, 🔁 say that again, 🐢 slower,
volume, and home. Always visible, never nested in a menu.

---

## 8. Technical architecture

### Stack
React 19, Vite, TypeScript, `motion` for animation. No UI framework, no map library,
no runtime network calls. Deployed by GitHub Actions to GitHub Pages.

### Content is data, not code
Every fact, every sentence and every cue lives in JSON under `content/`. Application code
contains no facts. A validation script enforces the schema and completeness (36 places,
5 landmarks each, every line has audio and timings) and fails the build otherwise.

### The map is generated
A build script consumes official Indian state boundary data and emits `src/data/geo.json`
containing, for each state and UT: the SVG path, the label centroid, the zoom bounding box,
and the list of neighbouring states derived from shared borders.

Boundary depiction must follow the official Survey of India rendering — Jammu & Kashmir and
Ladakh as Indian union territories. The chosen source is verified visually before anything
is built on top of it. Data must be post-2019: Ladakh separate, Telangana present,
Dadra & Nagar Haveli merged with Daman & Diu.

### Zoom is a transform
One SVG. Zoom and pan are an animated `transform` on a group element, not a mapping library
and not viewBox animation. This stays GPU-composited and smooth on old hardware.

### Cues anchor to word index, not time
This is the load-bearing decision of the whole design.

A cue is written as *"at word 14, reveal the tiger and growl"* — never *"at 4.2 seconds"*.
The player resolves word index to a timestamp at runtime using the timing file that ships
alongside each audio clip.

Consequence: the entire site can be built and tested against free locally-generated draft
audio, and then re-rendered with the paid provider — every timing changes, and **nothing
breaks**. This is what makes the draft-first cost plan viable.

### Audio engine
A single module owning one `AudioContext`, deliberately outside React state:

- **Narration** — one clip at a time, drives word highlighting and fires cues.
- **Ambient bed** — a long looping track per environment, ducked while narration plays.
- **One-shots** — short effects (growls, calls, ripples) that may overlap narration.

Audio is unlocked by the first user gesture on the landing screen ("Tap to begin").
Per-state audio is fetched lazily when the state is opened.

### Artwork
A kit of about 30 reusable SVG primitives — domes, minarets, shikharas, gopurams, fort
walls, dunes, palms, waves, snow peaks, prayer flags, boats, stepwells. Most landmark
scenes are recipes composing these primitives with positions, scales and a palette.
Roughly twenty landmarks a child would actually recognise — Taj Mahal, Golden Temple,
Konark wheel, Charminar, Hawa Mahal, Gateway of India and similar — are drawn by hand.

Real photographs are sourced from Wikimedia Commons by script, filtered to
bundle-safe licences, resized to about 900px, and shipped with a generated credits page.

---

## 9. Scale and budget

| Item | Volume |
|---|---|
| Places | 28 states + 8 union territories = 36 |
| Landmarks | 5 per place = 180 |
| Narration clips | 10 per place (1 intro + 4 card tiles + 5 landmarks) = 360, plus 14 tour + ~50 interface = **~424** |
| Narration characters | **hard budget 95,000** (see below) |
| Audio on disk | ≈ 45MB, lazily loaded, ≈ 1.2MB per state |
| Photographs | 180 at ≈ 100KB = ≈ 18MB, lazily loaded |
| Total repository | ≈ 65MB |

### The character budget is a build constraint, not an estimate

Speech synthesis is billed per character, so the content is written *to a budget* and the
validation script fails the build if the total is exceeded:

| Clip type | Max characters | Count | Subtotal |
|---|---|---|---|
| State intro | 400 | 36 | 14,400 |
| State Card tile | 170 | 144 | 24,480 |
| Landmark | 300 | 180 | 54,000 |
| Grand Tour beat | 230 | 14 | 3,220 |
| Interface / Mor | 60 | ~50 | 3,000 |
| | | | **99,100 ceiling, 95,000 target** |

At the target, one full render fits inside a 100,000-character monthly allowance with
almost no margin for re-rendering. The tier decision therefore depends on how much
re-render headroom is wanted, and is settled in the implementation plan once current
provider pricing is confirmed. Two safe options: two months at the 100k tier, or one month
at the next tier up, which also leaves room for a later Hindi track.

Render once, then cancel; the audio files live in the repository permanently. The tight
margin is the reason wording must be final before any paid render.

---

## 10. Delivery milestones

**Milestone 1 — engine and proof.** Map generation, audio engine, cue system, routing,
child controls, passport, Grand Tour, and four complete states: Rajasthan, Odisha, Kerala,
Delhi. Draft audio throughout. At the end of this milestone the site genuinely works and
can be handed to a child.

**Milestone 2 — full country.** The remaining 32 states and union territories, produced in
batches against the now-proven templates. Photo sourcing and fact verification pass.

**Milestone 3 — final voice and launch.** ElevenLabs render of all clips, timing
regeneration, GitHub repository and Pages deployment, live URL.

**Phase 2 (separate spec).** Games: find-the-state, picture quizzes, animal matching.
Hindi narration track.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Map data uses the disputed Kashmir depiction | Depiction verified and shown as an image for approval before any dependent work |
| Facts wrong in material a child will learn | Dedicated verification pass over every fact; parent review before launch |
| Paid render produces unusable timings or breaks sync | Cues anchored to word index, not time; draft audio proves the pipeline first |
| 180 illustrated scenes is more art than the schedule allows | Recipe-composed scenes from a shared primitive kit; real photograph carries realism |
| Site too heavy for an old iPad | Aggressive geometry simplification; transform-only animation; lazy per-state loading |
| Sound effects or photos with unusable licences | Licence checked programmatically at fetch time; anything unclear is rejected |

---

## 12. Privacy and safety

No accounts, no analytics, no advertising, no third-party scripts, no runtime network
requests. The only stored state is the passport, in `localStorage` on the device.
The only outbound links are photograph credits, on a page a child will not encounter
during normal use.

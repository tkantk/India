# Namaste India — Phase 2: games and a Hindi track

**Status:** design, 3 October 2026. Written because the first spec (§10)
deferred both to "Phase 2 (separate spec)". Everything here follows that
spec's rules: accuracy before everything, no runtime network calls, nothing
stored but on the device, and every target sized for a six-year-old's finger.

---

## 1. What the child gets

Three short games, and the whole app in Hindi.

The games are for a child who has already explored. They ask about what he
has seen (the places he has stamped, the landmarks he has heard about, the
animals whose calls he has heard) so that playing is remembering, not being
tested on things nobody showed him. No scores to lose, no timers, no "wrong!"
buzzers. A wrong answer is answered with the truth, said kindly.

Hindi is the same app, every word of it, narrated in Hindi with the same
read-along highlighting. It is chosen once, on the start screen, and
remembered on the device.

---

## 2. Where the games live

On the **Passport page**. The control bar already carries six 104 px
buttons and phone widths only just fit them (`Controls.css`, the 601–719 px
rule); a seventh would break the one rule that bar exists for. The Passport
is already the child's own page (his stamps, "You have explored N of 36"),
so it grows a single big **Play a game** button that opens `#/games`: three
large picture tiles, one per game, each spoken aloud when tapped.

Before the child has stamped anywhere, the games still work, drawing on all
36 places; once he has stamps, at least half of each round comes from places
he has finished.

## 3. The three games

Every game is five questions long, then a short ending ("Five questions,
all done! Shall we play again?") with two buttons: again, or back to the
Passport. Each question:

- is spoken, and its words light up as in the rest of the app;
- has big targets (the 104 px rule) and accepts only one answer at a time;
- on a right answer: the stamp chime and a short spoken "Yes!" line;
- on a wrong answer: the truth about what he tapped ("That is Tamil
  Nadu."), then the question again; after the second wrong try the right
  answer gently pulses. Nobody fails.

### 3.1 Find the state

Mor asks "Can you find Kerala?". The whole map is shown (no zoom), and the
child taps a state. Uses the existing map, hit layer and glow. Island
territories (Andaman and Nicobar, Lakshadweep) and the smallest UTs
(Chandigarh, Puducherry, DNH&DD, Delhi) are asked only after a few rounds,
because their targets are small; the hit layer's existing enlargement of
small places applies.

### 3.2 Where is this? (picture quiz)

A landmark photograph fills the top of the screen. "Which state is this
in?" Three big answer buttons below, each showing the state's outline (drawn
from `geo.json`) and its name. After the answer, the landmark says its own
name: the first sentence of its existing narration clip ("This is Meenakshi
Temple.") played as a segment, using the word timings to find where that
sentence ends. Landmarks without a photograph are never asked.

### 3.3 Whose call is this? (animal sounds)

A real animal call plays (the recordings the owner approved in October
2026). Three animal photographs; the child taps the one that made it. After
the answer, the animal card's first sentence plays as a segment ("The koel
is Jharkhand's own bird."). Only animals with both a sound and a photograph
are used, and two answers in one question are never the same kind of
animal in a way a child could not tell apart (two pheasants, say).

## 4. New narration

Segments of existing clips cover the answers. New lines are needed only for
the questions and feedback:

| Lines | Count | Example |
|---|---|---|
| "Can you find {place}?" | 36 | "Can you find Kerala?" |
| "That is {place}." | 36 | "That is Tamil Nadu." |
| Game menu, questions, praise, try again, hint, ending | ~16 | "Which state is this in?" |

About 88 lines and 2,500 characters in English. They go into
`content/games.json`, validated, pronounced and rendered through exactly the
same pipeline as everything else. A segment of an existing clip costs
nothing.

### Segment playback

`Narrator` gains one capability: play a clip from word *i* to word *j*,
using the clip's own word timings for the start and end. It is how the
games reuse every landmark and animal line without new recordings, and it
gets the same tests the rest of the engine has (stop, replay, a missing
clip is silence).

## 5. Hindi

### 5.1 The words

Every line the child hears gets a Hindi version: 36 places × 10 lines, the
14 tour beats, the interface lines and the game lines, about 480 lines in
all. The Hindi is:

- **spoken Hindi for a child**: everyday Hindustani, short sentences,
  never Sanskritised officialese ("रेल" not "लौहपथगामिनी");
- **the same facts as the English, exactly**. Numbers, names and claims
  are translated, never adjusted. The fact-check rows stay attached to the
  English, and a Hindi line may not say anything its English line does not;
- **place names as Hindi speakers say them** (केरल, ओडिशा, तमिलनाडु).

The first draft is machine-written. **The owner reads every line** on a
review page (English and Hindi side by side, each line marked OK or given a
correction) before anything is rendered. That reading is the Hindi
equivalent of the fact-check, and nothing replaces it.

### 5.2 How it is stored

Each content line gains an optional `hi` object: `{ text, cues }`. Cues are
re-anchored to the Hindi word that names the same thing, because Hindi word
order differs from English (the verb comes last). Validation checks every
Hindi cue lands on a word that exists, and that every English cue has a
Hindi counterpart.

Audio goes to `public/audio/hi/`, timings to `src/data/timings.hi.json`,
the cache key hashes the Hindi text exactly as it does the English, and
per-place lazy loading splits by language too.

### 5.3 Proving it before paying

The macOS Hindi voice (Lekha) renders the whole track as a free draft
first, exactly as the English was proven with the `say` voice before the
paid render. Highlighting, cues and every screen are checked with the
draft. Only then is the paid render costed, shown to the owner, and run on
his go-ahead, with the same voice (it speaks Hindi through ElevenLabs'
multilingual model) so the narrator is the same person in both languages.

### 5.4 Choosing the language

The start screen, which already exists to unlock audio with a tap, offers
two large buttons: **English** and **हिन्दी**. The choice is remembered in
`localStorage` (the same guarded storage the Passport uses) and changeable
from the Passport page. Interface text that is not narrated (button labels,
"You have explored 12 of 36") follows the language too.

## 6. Order of work

1. Segment playback in the engine, with tests.
2. The game lines in English; render with the draft voice.
3. The games screen and the three games, with tests and a browser gate.
4. Hindi: schema, validation, the pipeline's language parameter, the start
   screen choice, the language in every screen. Proven with the draft voice.
5. The Hindi translation, and the owner's reading of it.
6. One costed paid render, on the owner's go-ahead: the English game lines
   and the whole Hindi track together.

## 7. Not in this phase

Accounts, leaderboards, timed games, other Indian languages (the structure
from §5.2 takes another language without new design, and Hindi proves it).

# Fact check

Every checkable claim in the seed content, with the source it was checked
against. The rule this file exists to enforce: **a slightly vaguer true
sentence beats a precise false one.** Where a number could not be confirmed
the line was rewritten until what it says is defensible, and the rewrite is
recorded in the Notes column.

Sources are named by publication. Government of India / state-government
sources (Incredible India, Rajasthan Tourism, Kerala Tourism, Odisha Review,
ASI, Survey of India, IMD), UNESCO and institutional science were preferred
over travel writing. Britannica returned HTTP 403 to automated fetches during
this pass, so it is cited only where a second source agrees.

Checked 2026-08-21 unless stated otherwise.

## Rajasthan

| Line id | Claim | Source | Notes |
|---|---|---|---|
| rajasthan.intro | Rajasthan is the largest state in India by area | Forest Survey of India, *India State of Forest Report 2019* Vol. II: 342,239 km², 10.40% of the country | Confirmed |
| rajasthan.intro | Much of Rajasthan is desert | ICAR-CAZRI, *Desertification in India's Arid Zone*: hot arid zone 19.6 m ha of the state's 34.2 m ha | ≈60%, so "much of it" holds. **Rewritten:** the earlier draft defined a desert as "made of sand"; large parts of the Thar are stony scrub, so the line now defines a desert by its dryness and says "most of this one is sand" |
| rajasthan.intro | Gujarat and Punjab border Rajasthan | `src/data/geo.json` neighbour list, derived from the official boundary geometry in Task 3 | Confirmed |
| rajasthan.intro | Jaipur is the capital; old Jaipur is pink | Rajasthan Tourism (official), Jaipur page | Confirmed. The line deliberately says *old* Jaipur — it is the old walled city that is painted, not the modern city |
| rajasthan.card.animal | A camel's hump stores fat, not water | San Diego Zoo Wildlife Alliance; Library of Congress *Everyday Mysteries* | **Corrected.** The task brief's own worked example said the camel "carries his own water inside the big hump". That is the classic misconception and is false; the line now says the hump is packed with fat |
| rajasthan.card.animal | A camel can cross the desert for days without drinking | San Diego Zoo Wildlife Alliance: "a week or more without water" | Confirmed, and stated conservatively |
| rajasthan.card.food | Baati is a hard baked wheat ball, cracked open and dipped in dal and ghee | Incredible India (Ministry of Tourism), Udaipur cuisine page | Confirmed |
| rajasthan.card.festival | Thousands of camels come to Pushkar; owners groom them, shave patterns into their hair, decorate them, and race them | Rajasthan Tourism (official) Pushkar Fair page; Global InCH, *Camel Hair* (Raika shearing designs); Rajasthan Animal Husbandry Dept counts (15,460 in 2001 → 2,340 in 2021) | **Rewritten.** "Thousands" is safe; tens of thousands is not, and attendance is falling. "Washed" could not be sourced and was dropped in favour of "brush" and the well-documented decorative shearing |
| rajasthan.card.hello | Khamma Ghani is a Rajasthani greeting | Abhishek Avtans (Indic languages, Leiden), *Linguistica Indica*: khamā < Sanskrit *kṣamā*, ghaṇī "very much" — an honorific greeting | **Rewritten.** The brief's example glossed it "I wish you a very long and happy life". Specialists call that derivation speculative. The line now says only that it is a warm, respectful hello, which every source supports |
| rajasthan.thar.line | Thar dunes are moved by the wind | ICAR-CAZRI (sand mobilisation, ~400,000 ha under dune stabilisation); *J. Indian Soc. Remote Sensing* 2019: 3–7 m/yr parabolic, up to ~30 m/yr barchan | **Rewritten.** "Moves a little every single day" overstated it, and many Thar dunes are now vegetated or deliberately stabilised. The line now says the wind keeps pushing at them "a little at a time" and invites the child back "in a few years" |
| rajasthan.hawa-mahal.line | Hawa Mahal has 953 windows, and they keep it cool | Incredible India (Ministry of Tourism), Hawa Mahal page: "an astonishing 953 windows or jharokhas… a honeycombed cooling system" | Confirmed against the official figure. No architectural survey behind the number was found and a few travel sources print 935, so 953 is stated as the official count, not as something anyone recounted |
| rajasthan.hawa-mahal.line | Hawa means wind, Mahal means palace | Same source; standard Hindi/Urdu | Confirmed |
| rajasthan.amber-fort.line | Amer Fort is on a hill; one hall is lined with thousands of tiny mirrors | Incredible India, Amber Fort page: "perched atop a rugged hill… thousands of tiny mirrors" | Confirmed |
| rajasthan.amber-fort.line | Light in the mirror hall reflects back from everywhere | Physical description only | **Rewritten.** The popular "one candle lights the whole room" claim is guide lore with no government, ASI or scholarly source. The line now describes only the reflection, which is simply what mirrors do |
| rajasthan.chand-baori.line | Chand Baori has about 3,500 steps down thirteen levels | Rajasthan Tourism (official) Chand Baori page: "3,500 perfectly symmetrical, narrow steps" | Confirmed against the official figure. The depth in metres is quoted between 19.5 m and 30 m by different sources with no primary survey, so **no depth is stated** |
| rajasthan.ranthambore.line | Wild tigers live in Ranthambore, and an old fort stands inside the park | WWF India: the fort "is strategically located atop a 700 feet tall hill within the park"; UNESCO WHS 247, *Hill Forts of Rajasthan* | Confirmed |

## Odisha

| Line id | Claim | Source | Notes |
|---|---|---|---|
| odisha.intro | Odisha is on India's east coast on the Bay of Bengal, with hundreds of kilometres of coast | Survey of India, *Length of Coastline of India* (2024 re-verification): Odisha 574.71 km | Confirmed. "Hundreds of kilometres" is used rather than a number, because the official figure changed from ~480 km to ~575 km in the 2024 re-measurement |
| odisha.intro | West Bengal borders Odisha | `src/data/geo.json` neighbour list | Confirmed |
| odisha.intro | Bhubaneswar is the capital and is full of old stone temples | Britannica, *Bhubaneshwar*; Government of Odisha state profile; UNESCO Tentative List, *Ekamra Kshetra* | Confirmed as stated. **No count is given:** sources range from "about 30 ancient temples" (Britannica) to "700 which once stood here" (ASI-authored UNESCO submission) to an unsourced "7,000" on tourism pages |
| odisha.card.animal | The Indian roller is Odisha's state bird; brown at rest, brilliant blue in flight | Odisha Review (Government of Odisha), *Blue Jay: The State Bird of Orissa* | Confirmed, including "the dark and pale blue colours in the wings show up as brilliant shining bands in flight" |
| odisha.card.food | Pakhala is cooked rice left in water until it is cool and slightly sour, eaten with fried fish | Odisha Review; Pakhala Dibasa observed 20 March since 2011 | Confirmed. Pakhala Dibasa is not mentioned in the line because dates are out of scope for the narration |
| odisha.card.festival | Rath Yatra: three enormous wooden chariots, built new every year, pulled with ropes by thousands | Government of Odisha official Rath Jatra portal: "newly constructed every year"; Nandighosa 45 ft, 16 wheels; pulled along the ~2-mile Bada Danda | Confirmed |
| odisha.card.hello | Namaskar, ନମସ୍କାର | Unicode decomposition verified character by character (ORIYA NA, MA, SA, VIRAMA, KA, VOWEL SIGN AA, RA); Odia phrasebook | Confirmed |
| odisha.konark.line | Konark is carved as a giant chariot with twenty-four stone wheels and stone horses | UNESCO WHS 246 Statement of OUV: "twelve pairs of wheels drawn by seven horses… 24 carved wheels, each about 3 m in diameter"; ASI Konarak page | Confirmed. UNESCO's one-line blurb says six horses; its own OUV text and the ASI both say seven, so the line does not give a horse count |
| odisha.konark.line | The shadow on a wheel tells the time | Bahinipati et al., *F1000Research* 13:1540 (2025); guide practice at the site. Neither UNESCO nor ASI states it | **Rewritten** to attribute it: "Guides here show you how the shadow creeping across a wheel tells the time." Not asserted as the builders' intent |
| odisha.jagannath.line | The tower is as tall as a twenty-floor building | Odisha Review (Govt of Odisha): vimana 214 ft 8 in ≈ 65 m, which is a twenty-storey building at 3.25 m a floor | Confirmed. **Rewritten:** the draft said sailors can see it from out at sea, which is repeated everywhere but sourced nowhere |
| odisha.jagannath.line | One of the largest kitchens in the world; clay pots piled over a wood fire; thousands fed | Odisha Review, *The Kitchen of Srimandir* (150 ft × 100 ft × 20 ft, ~600 cooks and 400 helpers) | Confirmed as "one of the largest". The traditional "biggest in the world" title is not independently verified and is not used |
| odisha.jagannath.line | (not stated) the top pot cooks first | Government of Odisha's own articles contradict each other on the number of pots (five vs nine), and the top-pot claim is devotional tradition never measured | **Removed.** It was in the first draft and is not in the line |
| odisha.chilika.line | Chilika is a huge shallow lake where river water and sea water mix; Irrawaddy dolphins; thousands of birds in winter, some pink | Chilika Development Authority (Govt of Odisha); Ramsar Site 229; 2025 census 1,127,228 birds of 196 species including 2,638 greater flamingos | Confirmed, and understated: it is over a million birds. The line says "in their thousands", which is true and easier for a child to picture |
| odisha.puri-beach.line | Golden sand on the Bay of Bengal; people build huge sand sculptures there | Odisha Tourism, *Golden Beach, Puri* (Blue Flag certified); Government of Odisha page on sand art and Sudarsan Pattnaik | Confirmed. The line does **not** mention the International Sand Art Festival, which is at Chandrabhaga Beach, Konark, not Puri |
| odisha.udayagiri.line | Rock-cut caves where monks lived; an elephant cave; carved elephants by a doorway | ASI, *Udayagiri and Khandagiri Caves*; UNESCO Tentative List, *Ekamra Kshetra*: caves "originally meant for the Jain ascetics"; Hathigumpha = elephant cave, Cave 14 Udayagiri; Ganesha Gumpha's flanking elephant sculptures | Confirmed. Note Incredible India wrongly places Hathigumpha at Khandagiri; it is on Udayagiri |

## Kerala

| Line id | Claim | Source | Notes |
|---|---|---|---|
| kerala.intro | Kerala is a long thin state on India's west coast, sea one side and hills the other | Britannica, *Kerala*; Kerala State Planning Board | Confirmed (about 580 km long, 35–120 km wide) |
| kerala.intro | It rains a great deal | India Meteorological Department: the south-west monsoon's normal onset over Kerala is 1 June, before the rest of the mainland | Confirmed |
| kerala.intro | Tamil Nadu borders Kerala | `src/data/geo.json` neighbour list | Confirmed |
| kerala.intro | Thiruvananthapuram is the capital | Britannica; Kerala State Planning Board | Confirmed |
| kerala.intro | (not stated) Kerala means "land of coconuts" | Britannica; linguists trace Keralam to Cheralam, the land of the Chera kings; kera + alam is a back-formed folk etymology | **Not used.** The line says only that coconut palms lean over every road, which is a description, not an etymology |
| kerala.card.animal | The elephant is Kerala's state animal | Government of Kerala, General Administration Dept, state emblem page | Confirmed |
| kerala.card.food | Sadya: a feast on a banana leaf, about twenty small dishes, eaten with the right hand | Kerala Tourism, *Sadya*: more than 20 dishes, a grand sadya 26 or more | Confirmed |
| kerala.card.festival | Onam: flower patterns on the ground; long boats raced by nearly a hundred rowers | Kerala Tourism, *Onam*; Nehru Trophy Boat Race official site: a chundan vallam is over 30 m and carries around 100 rowers | Confirmed |
| kerala.card.hello | Namaskaram, നമസ്കാരം | Wiktionary Malayalam entry; Shabdkosh Malayalam–English dictionary; conjuncts verified | Confirmed |
| kerala.card.hello | "Malayalam" is spelled the same backwards as forwards | Direct check of the English spelling | Confirmed, and the line says "in English" is implied by context — it is a claim about the roman spelling only |
| kerala.backwaters.line | Lakes and canals joined together for a long way; boats with woven palm roofs that people sleep on | Kerala Tourism: the backwater network runs roughly 900 km; kettuvallam built of jackwood stitched with coir rope, originally rice and cargo barges | Confirmed. No length is given in the line, because the frequently-quoted 900 km figure varies by what is counted |
| kerala.munnar.line | Tea bushes clipped flat on top; for the best tea only the bud and the two leaves below it are picked | Kerala Tourism, *Munnar*; International Specialty Tea Association plucking standard; the flat top is called the "plucking table" | **Rewritten** to say "for the best tea". Two-leaves-and-a-bud is the fine-plucking quality standard, not how every leaf in Munnar is picked — big estates also use shears |
| kerala.athirappilly.line | The water drops much further than a house is tall | Thrissur District (Govt of Kerala); Kerala Tourism: 24 m / 80 ft high, up to about 100 m wide in the monsoon | Confirmed. The line does **not** call it Kerala's tallest waterfall — it is the largest by volume and width, but Meenmutty Falls in Wayanad is far taller |
| kerala.chinese-nets.line | Shore-mounted cantilever nets; four or five men pull together; stone counterweights | Kerala Tourism, *Chinese Fishing Nets*: ~10 m structures, "operated by more than four fishermen", counterweight stones about 30 cm | Confirmed |
| kerala.chinese-nets.line | (not stated) the nets are Chinese in origin | Kerala Tourism repeats the Zheng He story; several historians argue for Portuguese introduction from Macau | **Not used.** The landmark is named "The Fishing Nets at Kochi" and the line makes no origin claim |
| kerala.periyar.line | Wild elephants come to the lake edge to drink and are seen from boats; tigers are there but rarely seen | Kerala Tourism, *Periyar Tiger Reserve*; Idukki District (Govt of Kerala). Roughly 900–1,000 elephants, around 40 tigers | Confirmed, including the honest "hardly anybody sees one" about tigers |

## Grand Tour and national symbols

| Line id | Claim | Source | Notes |
|---|---|---|---|
| tour.03 | India has twenty-eight states | Britannica, *India*; current as of this pass | Confirmed |
| tour.04 | India has eight union territories | Britannica, *India* | Confirmed |
| tour.05 | New Delhi is where the people who run the country work; India Gate is there | Britannica, *What Is the Difference Between Delhi and New Delhi?*; Britannica, *India Gate* | Confirmed |
| tour.06 | The flag is saffron on top, white, then green, with a navy-blue wheel of twenty-four spokes | Embassy of India (MEA), *National Symbols*: "a wheel in navy blue with 24 spokes"; Flag Code of India, 2002 | Confirmed. The line explains "saffron" as "a deep orange colour" rather than calling the band orange |
| tour.07 | The tiger is the national animal | Embassy of India (MEA), *National Symbols* | Confirmed. The official designation is simply "the tiger", which is what the line says |
| tour.08 | The peacock is the national bird, and he fans his tail in the rainy season | Embassy of India (MEA), *National Symbols*. Display is courtship; the breeding season coincides with the monsoon | **Rewritten.** The draft said "when the rain clouds come I open my tail", which implies the rain causes it. Rain-dancing is folklore; the seasonal coincidence is real, so the line now says "in the rainy season" |
| tour.09 | The lotus is the national flower, the banyan the national tree, the mango the national fruit | Embassy of India (MEA), *National Symbols* | Confirmed |
| tour.09 | A lotus starts in the mud at the bottom of a pond and grows up to the surface | Standard botany of *Nelumbo nucifera*: rooted in the substrate, flowers held above the water | Confirmed |
| tour.10 | The Ganga begins in the snowy mountains and runs across the country to the sea | Britannica, *Ganges River* (rises at the Gangotri glacier, drains to the Bay of Bengal); National Mission for Clean Ganga, Ministry of Jal Shakti (declared National River, 2008) | Confirmed |
| tour.11 | The Himalayas run along the top of India and are the highest mountains in the world | Britannica, *Himalayas* | Confirmed |
| tour.12 | The Arabian Sea is to the west, the Bay of Bengal to the east and the Indian Ocean to the south | Britannica, *India* | Confirmed. Both seas are arms of the Indian Ocean; the three-way description is standard geography |
| tour.13 | Namaste, Namaskar, Vanakkam and Sat Sri Akal all mean hello | Merriam-Webster on *namaste*; SikhiWiki, *Sat Sri Akal*; Department of Official Language, MHA (22 scheduled languages) | Confirmed. The line calls Sat Sri Akal one of several greetings, not "the Sikh greeting" — initiated Sikhs use a different formal greeting |

## Delhi

| Line id | Claim | Source | Notes |
|---|---|---|---|
| delhi.intro | Delhi is a union territory, not a state; New Delhi, India's capital, is inside it | Britannica, *What Is the Difference Between Delhi and New Delhi?* | Confirmed |
| delhi.intro | Haryana wraps around Delhi | `src/data/geo.json` neighbour list (Haryana and Uttar Pradesh) | Confirmed: Haryana borders it on three sides |
| delhi.intro | The Yamuna runs along one side; there are trains under the ground | Britannica, *Yamuna River*; Delhi Metro underground sections | Confirmed |
| delhi.card.animal | The house sparrow is Delhi's state bird | Delhi Parks and Gardens Society (Govt of NCT of Delhi), sparrow conservation page; declared 2012 | Confirmed |
| delhi.card.food | Chole bhature: spicy chickpeas with a fried bread that puffs up like a balloon | Standard recipe references | Confirmed |
| delhi.card.festival | A yearly parade in Delhi with bands, dancers, camels and a flypast | Press Information Bureau, Government of India, Republic Day Parade release: "The Camel contingent of Border Security Force…", 30 tableaux, ~2,500 cultural artists, 29-aircraft flypast | Confirmed. The camels are the Border Security Force contingent; the line says only "camels stride past" |
| delhi.india-gate.line | A stone arch far taller than a house, with names carved across it | Britannica, *India Gate*: about 42 m, more than 13,000 names inscribed | Confirmed. The names are of the war dead; the line says "people who are gone are still remembered", which is true and age-appropriate |
| delhi.qutub-minar.line | Red stone, five storeys each thinner than the last, a staircase of 379 steps, closed to climbers | ASI, *Qutb Minar* (72.5 m, red and buff sandstone, storeys by Aibak, Iltutmish and Firoz Shah Tughlaq); UNESCO WHS 233; interior closed since 1981 | Confirmed. **Not used:** the widely-repeated "tallest brick minaret in the world" is false twice over — it is sandstone masonry, not brick, and UNESCO calls it "the tallest masonry tower in India" |
| delhi.red-fort.line | Walls about two and a half kilometres round; a covered street of shops inside; water once ran through the rooms | Incredible India (Ministry of Tourism): "nearly 2.4-km-long ring", Chatta Chowk; UNESCO WHS 231: "a continuous water channel, known as the Nahr-i-Behisht (Stream of Paradise)" | Confirmed, with the wall length given as an approximation |
| delhi.lotus-temple.line | Twenty-seven white marble petals, nine pools, anybody may come in | Incredible India: "27 free-standing marble petals arranged into clusters of three", "nine reflecting pools", "welcomes all, regardless of religion" | Confirmed. It is a Bahá'í House of Worship; Incredible India's own page is mistitled "Hindu Temple" and that error was not inherited. The line names no religion at all |
| delhi.humayuns-tomb.line | A domed building in a garden cut into squares by water channels, and the Taj Mahal looks like it | ASI, *Humayun's Tomb*: "it is Humayun's tomb which set up a new vogue, the crowning achievement of which is the Taj at Agra"; UNESCO WHS 232: the style "reaching its zenith 80 years later at the later Taj Mahal" | Confirmed, and better supported than the usual "said to have inspired" phrasing |

## Could not be confirmed, and what was done about it

| Claim | Why it failed | Resolution |
|---|---|---|
| A camel's hump holds water | False — it stores fat | Line rewritten to say fat, and to explain what the fat is for |
| Khamma Ghani means "I wish you a very long and happy life" | The derivation behind that gloss is called speculative by a specialist in Indic languages; the solid etymology is *kṣamā* + *ghaṇī* | Line now claims only that it is a warm, respectful hello |
| One candle lights the whole of the Sheesh Mahal at Amer Fort | Guide lore. No government, ASI, UNESCO or scholarly source states it | Line describes only what mirrors do to light |
| Chand Baori is thirteen storeys / about thirty metres deep | Depth figures range from 19.5 m to 30 m with no primary survey; "storeys" is universally repeated but unmeasured | Line says "thirteen levels" of steps and gives no depth |
| Camels at Pushkar are washed | Grooming, shearing and decoration are documented; washing is not | Replaced with brushing and the documented decorative shearing |
| Jagannath Temple can be seen by sailors out at sea | Repeated everywhere, sourced nowhere | Replaced with the sourced tower height, expressed as a twenty-floor building |
| Konark's wheels are sundials the builders designed as clocks | Real practice at the site and a 2025 peer-reviewed paper, but neither UNESCO nor ASI says it | Attributed in the line to the guides who demonstrate it |
| The top pot in the Jagannath kitchen cooks first | Devotional tradition, never measured; the Odisha government's own articles disagree on how many pots are stacked | Removed from the line |
| Bhubaneswar has N old temples | Sources give 30, 700 and 7,000 | No number is given |
| Qutub Minar is the world's tallest brick minaret | False on both counts | Not used; the line makes no superlative claim |
| Athirappilly is Kerala's tallest waterfall | It is the largest by volume and width; Meenmutty Falls is far taller | No superlative used; the line describes the drop instead |
| The Chinese fishing nets are Chinese in origin | Disputed by historians | No origin claim is made |
| "Kerala" means land of coconuts | Folk etymology; the recorded trail is Cheralam | Not used |
| Odisha's coastline is N kilometres | Officially re-measured in 2024 from ~480 km to 574.71 km; both figures circulate | Line says "hundreds of kilometres" |
| Munnar tea is picked two leaves and a bud | That is the fine-plucking quality standard, not universal practice | Line says "for the best tea" |
| The peacock dances because it rains | Courtship display whose season coincides with the monsoon | Line says "in the rainy season" |

## Not fact, and deliberately so

Three lines are invitations rather than assertions and have nothing to check:
`tour.02` ("like a giant kite dipping into the sea"), `tour.14` and every line in
`content/ui.json`. Similes are marked as similes so a child can tell the
difference between what India looks like and what India is.

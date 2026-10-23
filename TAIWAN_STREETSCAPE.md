# Taiwan Streetscape + Localization Spec — Slop Taipei

Companion to `TAIPEI_PROTOTYPE.md`. This document specifies how Taipei streets
actually work and look, as implementable parameters for the runtime modules
inherited from mrdoob/slop-newyork — so the Taipei tile reads as Taipei at
street level, not as Manhattan with Chinese labels pasted on.

Number provenance tags used throughout:

- **[REG]** — from a Taiwanese regulation or government source (cited inline).
- **[OBS]** — observed typical value in Taipei (real-world practice, not a rule).
- **[SPEC]** — our engine parameter: a concrete value chosen for the sim,
  informed by the above. Tune in playtest; do not mistake it for law.

Upstream baseline we are replacing: the NYC geodata frame hardcodes one
uniform sidewalk, `frame.sidewalk = 4.6` (m) for every street, NYC street
furniture in `js/street-details.js`, English canvas sign themes in
`js/buildings.js`, and a two-phase `SIGNAL_TIMING` with a 7 s WALK window in
`js/city-config.js`. Almost every line of that is wrong for Taipei.

---

## (a) Principles — how Taipei differs from NYC in this engine

1. **Pedestrian space is a per-road property, not a constant.** Taipei uses
   four distinct pedestrian layouts — formal sidewalk, **騎樓 arcade**,
   **標線型人行道 painted walkway**, and **fully shared** street space — and
   which one applies changes block by block. The single most important data
   change in this project is replacing the uniform 4.6 m sidewalk with a
   per-road `pedestrianLayout` tag (see §b). A 弄 alley with a 4.6 m sidewalk
   on each side is wider than the alley itself.

2. **The arcade *is* the sidewalk — legally.** Taiwan's Road Traffic
   Management and Penalty Act, Art. 3 defines 人行道 (sidewalk) as
   "arcades, hallways and ground-level roadways designated for pedestrian
   use" [REG — rootlaw.com.tw, Act Art. 3]. On older commercial streets the
   pedestrian realm sits *inside the private building footprint*: ground
   floor set back, upper floors overhanging on columns. Pedestrians walk
   under buildings, shops open directly onto the walkway, and there is often
   no public sidewalk strip at all.

3. **Scooters are the majority mode and get their own space.** Motorcycles
   account for more than 50 % of traffic on most major urban arterials
   [REG/OBS — SWOV research abstract on Taiwan's segregated motorcycle-flow
   countermeasures]. Cross-sections reserve the outer lane(s) for them
   （慢車道 slow lane ≥ 2.0 m, motorcycle lane ≥ 1.5 m [REG — Urban Road
   Design Standards Art. 11]), intersections give them an advance stop box
   and a two-stage left-turn box, and the parking supply is mostly scooter
   bays, not car bays. A Taipei street rendered with only cars is wrong
   even before any signage.

4. **The address hierarchy is written in the road names.** 路/大道 (road) →
   街 (street) → 巷 (lane off a road) → 弄 (alley off a lane). The M0
   geodata already carries this: road names include e.g. `永吉路120巷`,
   `忠孝東路五段236巷`, `信義路五段150巷400弄`. The builder can classify
   lanes/alleys by parsing the name — no extra dataset needed — and the
   layout table in §b keys off it.

5. **Information is vertical and textual.** Where NYC puts text on
   horizontal fascia bands, Taipei stacks it perpendicular to the facade:
   projecting vertical signs （直式招牌） every few metres, so a shopping
   street reads as a forest of Chinese characters from any oblique angle.
   Road information likewise goes *on the road*: painted characters
   （慢， 停， 機車專用， 禁行機車…), and the curb itself is a legal sign —
   red paint = no stopping ever, yellow = no parking by day [REG — see §c.9].

6. **Signals are pedestrian theatre, and they were invented here.** The
   animated countdown pedestrian signal — the 小綠人 "little green man" —
   was the world's first of its kind, installed 1999-03-18 at
   Songzhi Rd × Songshou Rd [REG — Taipei City Government], i.e. *inside
   our prototype tile*, two blocks from Taipei 101. Its animation speeds up
   as the phase runs out. Getting this one signal right, in the place it
   was born, is the highest-value localization detail in the project.

7. **Frontage clutter is the texture.** Small two-tone ceramic tile facades,
   iron window grilles, AC condensers in cages, corrugated rooftop
   additions and black water tanks are not decoration passes — at street
   level they *are* the buildings. §c.12 specifies them as generator
   parameters for `buildings.js`.

District nuance that matters for the tile: the **Xinyi Special District**
(planned 1980s–) uses wide setback sidewalks and open plaza frontage — no
qilou. The **older Da'an / Songshan shopping streets** （忠孝東路， 永吉路，
饒河街 fringe) are qilou country. The adapter must be able to express both
(§d, `frontageClass`).

---

## (b) Road-class parameter table

Classes key off the geodata the M0 builder already emits per road:
OSM `highway`, `width` (m, inferred), `oneway`, and the Chinese `name`.

Statutory anchors [REG — Design Standards of Urban Roads and Accessory
Works, law.moj.gov.tw pcode D0070156]:
car lane ≥ 3.0 m (main/secondary), ≥ 2.8 m (service), ≥ 3.25 m
(expressway); motorcycle lane ≥ 1.5 m; bicycle lane ≥ 1.2 m; bus lane
≥ 3.0 m; slow lane ≥ 2.0 m (1.5 m if width-constrained) — Art. 11.
Sidewalk net width ≥ 1.5 m; ≥ 1.2 m where road width < 12 m; ≥ 0.9 m in
constrained sections; curb height ≤ 0.15 m; pedestrian passage head
clearance ≥ 2.1 m — Art. 16. Taipei City enforces a 1.2 m clear-width
criterion and notes most roads in dense areas are < 12 m wide
[REG — Taipei DOT sidewalk enforcement guidelines].

| Class | Detection (geodata) | Carriageway [OBS/SPEC] | pedestrianLayout | Pedestrian width | Scooter provision | Parking | Signals |
|---|---|---|---|---|---|---|---|
| **Boulevard** 林蔭大道 | `primary`/`trunk`, or width ≥ 30 （忠孝東路， 信義路， 仁愛路， 敦化南北路， 民生東路） | ROW 30–70 m; 3–5 lanes/dir at 3.0–3.5 m + median (planted, 2–6 m) + tree rows | `sidewalk` | 3.0–8.0 m, tree pits every 8–12 m [SPEC] | Outer slow/motorcycle lane 2.0–3.0 m; advance box + two-stage box at major junctions; 禁行機車 paint on inner fast lanes of some | Scooter bays cut into facility strip; car bays on side streets | Full: vehicle + ped countdown, often ped head-start |
| **Arterial** 主要/次要道路 | `primary`/`secondary`, width 15–30 (M0 width table: secondary ≈ 14) | 2–4 lanes/dir at 3.0–3.25 m | `sidewalk` or `arcade` (commercial frontage) | Sidewalk 1.5–3.0 m; arcade 3.6 m (see §c.1) | 機車優先道 (dashed) or 專用道 (solid) 1.5–2.5 m on outer edge | Scooter bays at curb; car parallel bays where width allows | Full at junctions ≥ street class |
| **Street** 街道 | `tertiary`/`residential`, width 8–15 (M0: tertiary ≈ 11, residential ≈ 8) | 1–2 lanes/dir, often undivided, centre line dashed or none | `arcade` if commercial, else `painted` or narrow `sidewalk` | Arcade 3.6 m; painted band 1.1–1.8 m; sidewalk 1.2–1.5 m | Shared slow lane; no dedicated lane | Scooters parked nose-in along edges (bay-marked or informal); cars one side | At arterial crossings only; else 停/讓 paint + signs |
| **Lane** 巷 | name contains `巷` (and no `弄`), width 4.5–10 | 1 shared lane each way or single-file; no centre line | `painted` (one side) or `shared` | Painted band 1.1–1.5 m where present | Fully mixed; scooters dominant | Scooter rows along walls both sides; occasional car | None. 紅線 at mouths/corners; 慢 paint |
| **Alley** 弄 | name contains `弄`, width 2.5–6 | Single shared surface, often effectively one-way by parked rows | `shared` | — (whole surface) | Fully mixed, walking speed | Scooters along walls; cars rare, single file | None. 消防通道 (fire lane) paint where designated |

Rules that cut across classes:

- **Never widen a road to fit a layout.** If `width < 7 m`, layout is
  `shared` regardless of class. If `width < 12 m` and layout is `sidewalk`,
  use the 1.2 m net width, not 1.5 m [REG Art. 16].
- **Scooter parking is the default curb use** on street/lane/alley classes:
  perpendicular stalls 1.0 × 2.0 m [SPEC, stall ≈ scooter length + handlebar
  width] along the edge, leaving the Art. 16 clear width. Note the current
  policy direction: Taipei no longer designates scooter parking *on*
  sidewalks/arcades and prohibits parking in arcades [REG — Taipei DOT
  enforcement guidelines] — bays belong in the facility strip / roadway
  edge, and arcade floors stay clear. (The parked-scooter-filled qilou is
  an older visual cliché; render bays, not arcade clutter, for 2026 Taipei.)
- **One-way is common** for street/lane classes (geodata `oneway`); alleys
  are de-facto one-way when parked rows leave < 3 m clear.


---

## (c) Per-feature build specs

### c.1 騎樓 Arcade (qilou) — the signature pedestrian space

Legal/historical basis: arcades have been required on commercial frontage
since the Japanese-era 1936 City Planning Decree (roads by administrative
offices) and the 1965 rule that any commercial-district building base with
> 7 m of road frontage must leave arcade space [REG — Taipei Yearbook,
"History of Arcades"]. Art. 3 of the traffic act counts them as sidewalk.

| Parameter | Value | Tag |
|---|---|---|
| Depth (building line → column line) | **3.6 m** | [SPEC — the de-facto standard qilou depth on Taipei's older commercial blocks] |
| Clear height to soffit | 3.3–4.0 m (≥ 2.1 m legal passage clearance [REG Art. 16]) | [OBS] |
| Column spacing | 4.0–6.0 m = one shopfront bay; columns 0.4–0.6 m square at the outer edge | [SPEC] |
| Structure above | Facade continues from the column line upward; ground floor recessed to building line | — |
| Floor | Tile/terrazzo, flush with sidewalk where present; **±0.05–0.15 m level jitter between shop units** (Taipei runs an arcade-levelling programme precisely because floors differ unit to unit [REG — Taipei Construction Management Office]) | [OBS] |
| Shop relationship | Shopfront (glass/roller shutter) on the building line, opens onto arcade; fascia sign under soffit at outer edge (§c.8); goods displays may encroach ~0.5 m [OBS] | |
| Where | `frontageClass=arcade`: street/arterial edges in older blocks; **not** in Xinyi Special District (setback sidewalks instead) | |

Pedestrian routing: the walk line runs at the arcade centre (≈1.8 m from
building line), continuous across lot boundaries and across lane mouths.

### c.2 Formal sidewalk

| Parameter | Value |
|---|---|
| Net width | per §b (1.2 / 1.5 / 3.0–8.0 m by class) [REG Art. 16 + SPEC] |
| Curb height | 0.10–0.15 m (≤ 0.15 [REG]) — noticeably lower than NYC |
| Surface | Grey paving slabs / exposed aggregate; tactile paving strip (yellow, 0.3 m) at crossings and along MRT-adjacent sidewalks [OBS] |
| Tree row | Boulevard/arterial: pits 1.2 × 1.2 m every 8–12 m in a facility strip at the curb edge; camphor/banyan/palm species mix [SPEC] |
| Facility strip contents | Signal poles, street-name plates (§c.7), scooter bays (§b), YouBike docks (§c.11), bus stops (§c.11), utility boxes — all in the outer 0.8–1.5 m so the clear width survives |

### c.3 標線型人行道 Painted (marking-type) walkway

Used where a street is too narrow for a raised sidewalk and has no arcade —
the standard fix on 8–12 m streets and wider lanes.

| Parameter | Value |
|---|---|
| Band | Solid green fill, **1.1–1.8 m** wide, on the carriageway surface at the edge (one side, occasionally both) [SPEC, ≥ 1.2 m clear-width principle REG] |
| Colour | Green pavement — render `#1E9E57` [SPEC; upstream `road-paint.js` GREEN is `0x2a8a4e`, close enough to retune, do not reuse its bike-lane semantics] |
| Borders | White solid lines 0.10–0.15 m on both edges of the band |
| Furniture on band | Pedestrian pictogram + `人行道` characters every ~20 m [SPEC], direction arrows at ends |
| Protection | None physical — sometimes a row of parked scooters or bollards outside the band [OBS] |
| Junction treatment | Band stops at crosswalks; corners get 紅線 (§c.9) |

### c.4 Shared alleys （弄， and narrow 巷）

No pedestrian geometry at all. The whole surface is shared: pedestrians,
scooters, the occasional car at walking pace. Rendering cues instead:
red curb paint at mouths, `慢` glyph (§c.10), `消防通道` glyph + red hatch
where the alley is a designated fire lane [OBS], parked scooter rows tight
to the walls, hanging sign clutter from the streets they branch from,
laundry/AC/pipe clutter on the walls (§c.12). Speed cap for agents: 10 km/h
[SPEC]. This is a *feature*, not missing data — do not "fix" alleys by
adding sidewalks.

### c.5 機車停等區 Scooter advance stop box

Basis: one of Taiwan's two segregated motorcycle-flow intersection
countermeasures (with §c.6), per the design guidelines reviewed in the SWOV
study [REG/OBS]. Placement: **in front of the car stop line, behind the
crosswalk**, spanning the scooter approach lanes.

| Parameter | Value |
|---|---|
| Width | Approach width of scooter lane(s) + outer car lane: 3.0–5.5 m [SPEC] |
| Depth | **5.0–6.0 m** (≈ 3 ranks of waiting scooters) [SPEC] |
| Paint | White box outline 0.10–0.15 m; scooter pictogram centred in box |
| Behaviour | On red, scooter agents filter forward alongside queued cars and stack in the box (2 abreast per lane); on green they launch first, cars follow [matches the "head start" purpose in the SWOV abstract] |

### c.6 機車待轉區 Two-stage left-turn waiting box

Basis: two-stage left turns are mandatory for scooters at signed junctions
(the round blue sign with a scooter pictogram [OBS — PTS reporting on the
two-stage system]); scooters may not turn left directly across multi-lane
roads. The waiting box sits at the **far side of the junction, on the
right-hand corner of the cross street**, oriented with the cross traffic.

| Parameter | Value |
|---|---|
| Size | 4–8 m (along cross street) × 3–5 m, sized to the turning queue [SPEC] |
| Paint | White box outline on the carriageway, outside the through lanes of the cross street |
| Sign | Round blue mandatory sign, white scooter pictogram + bent arrow, on a pole at the box's corner, ~2.5–3.0 m up [OBS/SPEC] |
| Behaviour | Scooter wanting to left-turn: proceed straight into the box on its green, stop rotated 90°, wait for the cross street's green, proceed. Traffic module needs this as an explicit state — direct left turns by scooters at ≥ 2-lane junctions are a bug, not a style choice |

### c.7 Street-name plates 路名牌

| Parameter | Value |
|---|---|
| Plate | Dark green background, white text, thin white border — the same family as upstream's blade texture (`#0d6b3f` in `createStreetSignBladeTexture`); guide signs in Taiwan are white-on-green by convention [REG — MOTC Freeway Bureau sign redesign notes, applied to guide signage generally] |
| Layout | **Two lines**: Chinese road name large (upper, ~55 % of plate height), romanization below (Hanyu Pinyin, e.g. `Zhongxiao E. Rd.`), plus section marker where the name carries 段 | 
| Size | 1.2–1.8 m × 0.35–0.45 m [SPEC]; canvas 512 × 128 (upstream blade canvas is 256 × 64 single-line — widen to two-line) |
| Mounting | On signal/light poles at each junction corner, two plates back-to-back perpendicular to each street, centre ~3.2 m above ground [SPEC] |
| Text source | **Real names from geodata** — the road names on the two roads forming the junction (`name` field); never generated. Romanization: derive the short plate form from `nameEn` where present, else leave Chinese-only (many lane/alley plates are) |
| Alleys | 巷/弄 plates are smaller (0.6–0.9 m) and often wall-mounted at the mouth [OBS] |

### c.8 Shop signs — vertical + fascia

**Vertical projecting signs 直式招牌** (the iconic layer):

| Parameter | Value |
|---|---|
| Projection from facade | 0.9–1.4 m, face perpendicular to the street [SPEC] |
| Face size | 0.6–1.0 m wide × 2.0–4.5 m tall; bottom edge ≥ 2.4 m above walkway (passage clearance ≥ 2.1 m [REG Art. 16]) [SPEC] |
| Text | Chinese characters stacked **vertically, one per line, top-to-bottom**; 2–6 characters typical (shop name). Canvas: draw per-character centred in cells (browser canvas has no reliable `vertical` text layout across platforms — stack manually) |
| Density | 0–2 per shopfront on `frontageClass=commercial/arcade` edges; random gaps (closed shops, residences) [SPEC] |
| Construction | Internally lit box at night (emissive texture swap like upstream's lit fascia), metal frame, occasional bare neon-tube outline [OBS] |

**Horizontal fascia signs** (replace upstream `signThemes` in
`buildings.js` §5; same 512 × 96-ish canvas, wider character pitch):

| Parameter | Value |
|---|---|
| Band | 0.6–1.2 m tall, spanning one shopfront 3.0–6.0 m, mounted on the facade band above the storefront or at the arcade soffit edge |
| Text | Shop name horizontal, often + a descriptor （牛肉麵， 24H, 電話 numbers as texture noise) |

**Starter shop-type list** (name templates + colour conventions; names are
generic/invented — colour bands evoke a type, do not copy chain logos or
trade dress):

| Type | Name examples | bg / text [SPEC hex] |
|---|---|---|
| 便利商店 convenience | 每日便利商店， 好鄰居便利商店 | saturated band: orange `#F58220` / green `#008C4A` / blue `#005EB8`, white text |
| 牛肉麵 beef noodles | 老張牛肉麵， 川味牛肉麵館 | deep red `#A31E22` / cream text |
| 手搖飲 bubble tea | 清心茶飲， 五十嵐茶舖 (generic: 好茶日） | bright pastel varies; white text |
| 早餐店 breakfast | 美而美早餐， 活力早餐店 | warm yellow `#F5A800` / red text |
| 豆漿店 soy milk | 永和豆漿， 四海豆漿 | red `#C0272D` / white |
| 藥局 pharmacy | 大樹藥局 (generic: 安康藥局） | white / green cross + green text `#009444` |
| 機車行 scooter shop | 光陽機車行 (generic: 阿明機車行） | dark navy / yellow text |
| 自助洗衣 laundromat | 24H自助洗衣 | blue `#1B6AC9` / white |
| 書局 bookstore | 墊腳石書店 (generic: 文星書局） | teal / white |
| 眼鏡行 optician | 寶島眼鏡 (generic: 明亮眼鏡） | white / blue text |
| 診所 clinic | 安心牙醫診所， 小兒科診所 | white / teal `#009B9B` |
| 麵包店 bakery | 幾分甜烘焙 (generic: 香香麵包店） | warm brown / cream |
| 滷肉飯/小吃 eateries | 鬍鬚張 (generic: 阿婆滷肉飯）, 小吃店 | red or hand-painted white/red |
| 理髮廳 barber | 家庭理髮， 快剪100 | white/red + barber-pole prop |
| 花店 florist | 花語花坊 | soft green / white |
| 五金行 hardware | 日用五金行 | faded blue / white |
| 彩券行 lottery | 台灣彩券 (generic: 富貴彩券行） | red `#E4002B` / yellow text |
| 銀行 bank | 合作金庫 (generic: 市民銀行） | institutional solid (dark green/blue), restrained |
| 郵局 post office | 郵局 | **green `#007A33` / white** (Chunghwa Post livery colour) |
| 加油站 petrol | 中油加油站 (generic: 太陽石油） | blue/red band, canopy sign |

### c.9 Road-surface paint: characters + curb colours

Glyph decals (white paint, characters **elongated ~1.6× vertically** so
drivers read them at a shallow angle [SPEC]):

| Glyph | Where | Size [SPEC] |
|---|---|---|
| `慢` (slow) | Lane/alley entries, school approaches, before painted-walkway crossings | 1.5–2.0 m tall |
| `停` / `讓` | Unsignalized alley/lane mouths, with stop/yield line | 1.2–1.5 m |
| `機車專用` | Exclusive scooter lanes, repeated every 30–60 m + scooter pictogram | 1.0–1.4 m per char |
| `禁行機車` (no scooters) | Inner fast lanes of boulevards/bridges | 1.0–1.4 m per char |
| `學校` + school-zone signs | Frontage of schools (data: OSM `amenity=school` in builder) | 1.5 m |
| `消防通道` (fire lane) | Designated alleys, with red hatching | 1.0 m |
| Speed numerals `30`/`40`/`50` | Lane centres on street/arterial classes | 1.8–2.4 m |

Implementation: a decal quad per glyph run laid on the road via the
`road-paint.js` strip system (it already does coloured strips + crosswalks;
add a canvas-texture decal path). Orientation: readable by approaching
traffic (bottom of glyph toward the driver).

Curb/edge paint [REG — Installation Regulations Arts. 168–169, per Taipei
DOT FAQ]:

| Colour | Meaning | Sim rule |
|---|---|---|
| **Red line** | No parking *and* no temporary stopping, all day (Art. 169) | Junction corners ±10–15 m, crosswalk approaches, fire lanes, bus stops; parked-agent spawn = never |
| **Yellow line** | No parking 07:00–20:00; temporary stop (< 3 min, driver ready — the statutory definition of 臨時停車， Penalty Act Art. 3) allowed | Arterial/street edges by day; parking allowed 20:00–07:00 |
| **White line / bay marks** | Parking permitted | Stall ticks for car bays (5.0–6.0 × 2.0–2.5 m [SPEC]) and scooter bays (§b) |

### c.10 Signals — vehicle heads, pedestrian heads, countdowns

> **Scope decision (user, 2026-10-23): the animated 小綠人 is SKIPPED** —
> too much work for its visual payoff at prototype stage. Pedestrian heads
> ship as static lit figures (green walking figure / red standing figure,
> no frame animation, no countdown digits). The animation research below
> is kept for the record only; do not implement it unless the user
> re-opens it. Countdown digits move to P2 with the vehicle timers.

Vehicle heads: vertical 3-section (red/amber/green) like upstream's
(y = 5.42 m head centre is fine), frequently with an added arrow section
（左轉箭頭） making 4–5-section heads on boulevards; mast-arm or span-wire
mounting at corners, plus a near-side repeater head on wide junctions
[SPEC]. Signal phasing must add two Taiwan behaviours to `SIGNAL_TIMING`:

- **Pedestrian head start 行人早開**: at designated junctions the pedestrian
  green (and parallel direction) starts **3–5 s** before the vehicle green
  [OBS/SPEC param `pedHeadStartSec ∈ {0, 3, 5}`].
- **Scooter two-stage interplay**: §c.6 boxes keyed to the cross phase.

Pedestrian head （行人專用號誌） — one housing per crossing end, two
sections side by side or stacked, at ~2.6–3.0 m [SPEC]:

- **Upper/left: red standing figure** （小紅人） — static when lit.
- **Lower/right: green walking figure + two-digit countdown display**
  integrated in the same face.
- **小綠人 animation** [REG — Taipei City Government, on the original
  design]: **7 distinct walking frames**; frame rate is a function of
  remaining green time — slow walk while time is ample, accelerating to a
  run as the countdown expires; then red standing figure. Engine spec:
  7-frame sprite sheet on a canvas texture; frame interval
  `lerp(0.45 s → 0.13 s)` across the walk phase; final ~5 s the green
  figure flashes while continuing to animate; countdown digits decrement
  every 1.0 s in sync with `walkSignal()`'s phase clock. The sim's
  existing hook is `createWalkSignalMaterial()` + `walkSignal(time)` in
  `street-details.js`/`city-config.js` — replace the WALK/hand swap with
  the frame+digits texture.
- Pedestrian phase length: upstream WALK window is 7 s of a 60 s cycle;
  Taipei phases are demand/length-scaled — spec: walk phase
  `max(10 s, crossingWidth / 1.0 m·s⁻¹ )` [SPEC; design walking speed
  1.0–1.2 m/s is the usual planning value], flashing-don't-start interval
  covers the remainder of the parallel green.

Vehicle countdown timers (numeric red/green second displays beside
vehicle heads) exist at some Taipei junctions but are not universal —
**P2**, off by default [OBS].

### c.11 Transit furniture

- **MRT entrances** (in-tile stations: 台北101/世貿， 象山， 市政府，
  國父紀念館， 永春， 忠孝敦化， 忠孝復興… on the Tamsui-Xinyi and Bannan
  lines): street-level pavilion — stair + escalator box with glass/steel
  cladding, a line-colour band (Tamsui-Xinyi **red**, Bannan **blue**) and a
  white station-name plate (Chinese + English) with the 捷運 roundel.
  Reuse the footprint logic of upstream's subway stair entrances in
  `street-details.js` with new geometry/textures. Data: OSM
  `railway=subway_entrance`/`station` — the M0 landmarks fetch already
  surfaced e.g. "Taipei 101 / World Trade Center MRT Exit 5", so the data
  path exists; the builder should emit station entrances as point features.
- **YouBike 2.0 stations**: a row of dock posts (spacing ~1.1 m [SPEC]),
  white bikes with yellow accents, one kiosk totem with a green/white
  panel; 10–30 docks; sited on wide sidewalks, plaza edges, MRT exits,
  park gates. Data: OSM `amenity=bicycle_rental` (YouBike is mapped) —
  builder point feature.
- **Bus stops**: pole sign (white/blue, route numbers as texture noise),
  a shelter on wide sidewalks only, road-side 公車停靠區 bay paint
  (white box + characters) on arterials; red line through the stop [OBS].

### c.12 Building frontage + roofscape (for the buildings increment)

Generator parameters for `buildings.js` facade/roof passes:

| Feature | Spec [OBS/SPEC] |
|---|---|
| Facade tile | Small-format ceramic tile （小口磚）, two-tone per building: beige/white, pale pink-brown, grey-blue, red-brown palettes; tile grid texture scale ~0.05–0.1 m modules on a canvas/TSL pattern; 1970s–90s walk-ups dominate street/arterial frontage |
| Window grilles 鐵窗 | Dark metal (near-black/grey-green) frame protruding 0.15–0.30 m over windows/balconies, vertical bars every ~0.12 m; probability ~50–70 % of residential windows on non-Xinyi frontage; many enclose balconies entirely （鐵窗屋） |
| AC | Split-system condensers on facade cages/wall brackets, 1–3 per unit; window units in older walk-ups; drip stains below (skip stains v1) |
| Awnings 雨遮 | Fixed metal/canvas strip above windows, 0.4–0.6 m projection; shop awnings larger, colored canvas (reuse upstream awning instancing, new palette) |
| Rooftop water tanks | Cylindrical tanks: black PE (Ø 0.8–1.2 m × 1.0–1.5 m) and white/stainless, 1–4 clustered near the stair bulkhead on nearly every low/mid-rise roof [OBS] |
| Rooftop additions 頂樓加蓋 | One extra partial floor on ~30–50 % of older walk-ups: corrugated metal walls (pale green/grey/white), set back 0–1.0 m from the parapet, shed/pent roof — the single most recognizable roofscape signal in Taipei |
| Stair bulkhead + parapet | Small bulkhead box + 0.9–1.1 m parapet standard; laundry poles/TV antennas as P2 clutter |
| Ground floor | Arcade (§c.1) or storefront with roller shutters (closed state = corrugated grey) mixed with open shops ~70/30 |


---

## (d) Mapping to upstream modules + data requirements

Geodata/adapter additions (builder: `tools/taipei/build-taipei-geodata.mjs`;
adapter: the M1 GEO adapter). Everything below is derivable from data the
spike already fetches (OSM roads with `name/highway/width/oneway`, schools,
stations) plus code-side heuristics — no new external dataset is required.

| Feature | Module(s) | Data / change needed |
|---|---|---|
| Per-road pedestrian layout | `city-grid.js` (sidewalk geometry), `pedestrians.js`, `pedestrian-routes.js` (walk lines) | roads[] gains `pedLayout: sidewalk\|arcade\|painted\|shared`, `pedWidth`, `pedSide` (one/both). Builder rule from §b: parse `巷/弄` from `name`; combine with `highway` + `width` thresholds; frontage override list for Xinyi (sidewalk) vs older commercial streets (arcade) |
| Arcade geometry | `buildings.js` (frontage pass), `city-grid.js` | Per-block-edge `frontageClass: arcade\|setback\|flush` from the adapter (heuristic: edges on `pedLayout=arcade` roads get arcade frontage; Xinyi district polygon → setback). Buildings recess ground floor 3.6 m, columns at bay rhythm |
| Painted walkway | `road-paint.js` (new green-band strip + glyph decals), `pedestrians.js` | `pedLayout=painted` + side; walk line offset = band centre |
| Shared alleys | `road-paint.js`, `traffic.js` (speed caps) | `pedLayout=shared`; agent speed cap 10 km/h; no sidewalk meshes spawned |
| Scooter lanes | `road-paint.js`, `road-network.js`, `traffic.js` | Per-edge `scooterLane: exclusive\|priority\|none` (default: boulevard/arterial → present, street → none/shared). Lane offset geometry from edge width |
| Advance stop box + two-stage box | `road-paint.js` (paint), `traffic.js` (scooter agent states), `street-details.js` (blue sign) | Node attrs on the road graph: `advanceBox`, `twoStageBox` per approach — set when the junction is signalized and any approach is boulevard/arterial/street class. Boxes painted from node+approach geometry, no per-box data |
| Signals + 小綠人 | `street-details.js` (heads, ped sprite), `city-config.js` (`SIGNAL_TIMING` → per-city table: cycle, walk phase formula, `pedHeadStartSec`, countdown), `traffic.js` (`signalPhase`/`walkSignal` already consume the table) | Junction signalization flag on graph nodes (exists upstream as node.signal concept); ped phase params are code-side |
| Street-name plates | `street-details.js` (`createStreetSignBladeTexture` → two-line 512×128 variant) | Junction road names from graph edge `name`/`nameEn` at each node — real data, zero new fetch. Cache one canvas texture per unique name (~hundreds in tile) in an atlas like `city-grid.js`'s sign atlas |
| Shop signs (vertical + fascia) | `buildings.js` §5 (existing instanced fascia system + new vertical-sign instanced mesh) | Code-side shop-type table (§c.8); density by `frontageClass`; CJK font stack in canvas (§e note) |
| Road glyphs + curb colours | `road-paint.js` | Per-edge `curb: red\|yellow\|white` (default rules §c.9, red forced near nodes/schools); glyph set per edge class + `school` flag from builder (OSM `amenity=school` proximity ≤ 25 m) |
| MRT entrances / YouBike / bus stops | `street-details.js` (replaces MTA stairs / NYC furniture on Taipei tiles) | Builder emits point features: `stations[]` (entrance coords + line colour), `bikeDocks[]`, bus stops P2 (OSM `highway=bus_stop`) |
| Frontage/roofscape | `buildings.js` (facade texture set, grille/AC instancing, roof pass: tanks + 頂加） | Code-side parameter tables (§c.12) + per-building random seed; Xinyi frontage suppresses grilles/additions |

**CJK text rendering note (applies to all canvas signs):** upstream ships no
webfont; canvas `fillText` resolves CJK through the viewer's system fonts.
Use the stack
`'PingFang TC','PingFang SC','Microsoft JhengHei','Noto Sans TC','Noto Sans CJK TC',sans-serif`
(macOS/iOS → PingFang TC, Windows → JhengHei, Linux → Noto). Characters will
render everywhere modern, but weight/feel varies by platform — acceptable;
do not embed a multi-MB CJK webfont for signs. Vertical sign text: stack
characters manually per-cell (measure each glyph), never rely on CSS
`writing-mode` inside canvas. Keep per-name texture caching: street plates
are few hundred unique strings; shop signs come from a fixed theme table
like upstream's.

---

## (e) Priority tiers

**P0 — without these it is not Taipei** (first streetscape increment)
1. Per-road `pedestrianLayout` replacing the uniform 4.6 m sidewalk:
   arcade on commercial streets, painted bands on narrow streets, shared
   alleys, real sidewalks (correct widths) elsewhere.
2. Chinese street-name plates with **real geodata names** (two-line
   green plate) at junctions.
3. Pedestrian signals, static: upstream-style walk / don't-walk figures
   driven by the signal clock; ped head-start parameter. (The animated
   小綠人 + countdown digits are **deferred — out of scope per the user,
   2026-10-23**; see §c.10 note.)
4. Scooter intersection paint: advance stop boxes + two-stage waiting
   boxes at signalized junctions (visual layer first).
5. Vertical Chinese shop signs + Chinese fascia theme table (§c.8).
6. Road glyphs （慢， 機車專用， 禁行機車） + red/yellow/white curb paint.

**P1 — behaviour + depth**
7. Scooter traffic behaviour: filtering to the advance box, two-stage
   left-turn state machine, scooter lanes in the road network.
8. Arcade geometry in buildings (recessed ground floor, columns, soffit,
   level jitter) + pedestrian routing under arcades.
9. Parked scooter bay rows (instanced scooter props in bays) — the curb
   layer of every street/arterial scene.
10. MRT entrances (line-colour pavilions), YouBike docks, bus-stop poles
    + bay paint.
11. Frontage/roofscape pass: tile facades, 鐵窗 grilles, AC clusters,
    water tanks, 頂樓加蓋 additions.
12. Painted-walkway furniture: pictograms, `人行道` glyphs, bollard rows.

**P2 — polish**
13. Vehicle countdown displays at selected junctions.
14. Night pass: illuminated sign boxes, neon outlines, arcade soffit
    lighting.
15. School-zone full treatment (green crosswalk borders, 當心兒童 signs),
    arcade weather variation, rooftop clutter (antennas, laundry, solar
    heaters), Beitou-tile deltas (hot-spring signage, sulphur-valley
    steam) when that tile is un-parked.

---

## (f) Sources

Regulations & government (primary):

1. *Design Standards of Urban Roads and Accessory Works* （市區道路及附屬
   工程設計標準）, Arts. 11 (lane widths), 12 (curb parking), 16 (walkways)
   — Laws & Regulations Database, MOJ:
   https://law.moj.gov.tw/ENG/LawClass/LawAll.aspx?media=print&pcode=D0070156
2. Taipei City DOT, *Sidewalk Enforcement Guidelines* (1.2 m clear-width
   criterion; "most roads in high density areas are less than 12 m wide";
   no scooter parking on sidewalks/arcades):
   https://english.dot.gov.taipei/News_Content.aspx?n=3C4F5FC3FD2929A0&s=A14BD9A348DF805B
3. Taipei City Government, *Debut of "The little green man's birthplace"
   explanatory board* (first animated countdown ped signal, 1999-03-18,
   Songzhi × Songshou; 7 patterns; walk→run→red standing figure):
   https://english.gov.taipei/News_Content.aspx?n=A11F01CFC9F58C83&sms=DFFA119D1FD5602C&s=016B684103676EA1
4. Taipei City DOT FAQ, *What are the "No Parking" hours on roadside red
   and yellow lines?* (Arts. 168–169: yellow 07:00–20:00 no parking;
   red no parking all day):
   https://english.dot.gov.taipei/News_Content.aspx?n=A6C170F4FDC6DC5C&sms=5B794C46F3CDE718&s=E48C7D67A993224A
5. *Road Traffic Management and Penalty Act*, Art. 3 definitions
   (sidewalk includes arcades; temporary parking = < 3 min, ready to
   depart) — RootLaw English text:
   https://www.rootlaw.com.tw/en/LawArticle.aspx?LawID=A040110050001700-1070613
6. Taipei Yearbook 2012, *History of Arcades* (1802 Dalungtung arcade;
   1936 decree; 1965 > 7 m commercial frontage rule; levelling programme)
   — Taipei City Government PDF:
   https://www-ws.gov.taipei/001/Upload/297/attachment/5e6ae638-d498-4948-818b-9c402be69ed0.pdf
7. Taipei Construction Management Office FAQ on arcade levelling
   (block-unit levelling, per-owner floor differences):
   https://english.tfam.gov.taipei/News_Content.aspx?n=0BA802DAC63CB62B&sms=5B794C46F3CDE718&s=2F6328367D0C9D2A
8. MOTC Freeway Bureau, *Redesign of Freeway Exit Signs* (guide signs:
   white characters/arrows/borders on green):
   https://www.freeway.gov.tw/English/Print.aspx?cnid=1104&p=760

Research & journalism (secondary):

9. Yen, J.-R. et al., *Segregated motorcycle traffic flow countermeasures
   at intersections* (two-stage left turn + head-start holding zone design
   guidelines; motorcycles > 50 % of traffic on most major arterials) —
   SWOV publication record (abstract):
   https://swov.nl/nl/publicatie/segregated-motorcycle-traffic-flow-countermeasures-intersections
10. Metropolis Magazine, *Crossing Guard* (Taipei's running-man countdown
    signals; 7-position LED animation):
    https://metropolismag.com/programs/crossing-guard/
11. PTS 公視 獨立特派員， *機車兩段式左轉制度，待轉區爭議不斷* (blue round
    two-stage sign; current policy debate):
    https://www.youtube.com/watch?v=-aXSVPfK880
12. Taiwan News via Free Library, *Taipei road upgrade aims to be model
    for pedestrian safety* (Shida Rd: sub-two-person sidewalks, scooter
    parking on sidewalks, lane-narrowing retrofit practice):
    https://www.thefreelibrary.com/Taipei+road+upgrade+aims+to+be+model+for+pedestrian+safety.-a0791474282

Upstream code references (this repo): `js/nyc-geodata.js` frame
(`sidewalk: 4.6`), `js/city-config.js` (`SIGNAL_TIMING`, `signalPhase`,
`walkSignal`), `js/street-details.js` (`createStreetSignBladeTexture`,
signal heads, `createWalkSignalMaterial`, subway entrances),
`js/road-paint.js` (strip system, GREEN `0x2a8a4e`), `js/buildings.js`
§5 (awning + fascia sign instancing), `js/taipei-geodata.js` (road
`name`/`nameEn`/`highway`/`width`/`oneway`), `tools/taipei/GEO_CONTRACT.md`.

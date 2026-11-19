# Competitor Review Report — Hand-off

This folder lets a new Claude session produce a competitor review report in exactly the same format, style and tone as the **VegasNova Competitor Review**. It contains:

| Path | What it is |
|---|---|
| `HANDOFF.md` | This document: the rules, the report structure, the data format and the workflow. **Read it fully before starting.** |
| `template/` | `build.py`, `style.css` and `app.js`. These build the page from data files. Do not hand-write the HTML. |
| `tools/` | `prep_images.py` converts screenshots; `grid_overlay.py` helps place highlight boxes. |
| `example/` | The complete VegasNova report as data and screenshots. This is the reference for what good output looks like. |

To check everything works, rebuild the example:

```bash
python3 template/build.py example example_report.html
```

This needs Python 3 with Pillow (`pip install pillow`).

---

## 1. Instructions for the new session

You are preparing a competitor review report of online casinos for a reviewer. One casino is the **subject**: the casino being reviewed, VegasNova in the example. The others are its **competitors**. The reviewer gives you screenshots. You sort them into sections, write short findings and build visual comparisons with highlighted screenshots. The reviewer then gives notes section by section and you apply them.

Your job is to fill in the data files described in part 5 and run `template/build.py`. The layout, colours and behaviour come from the template; don't change them unless the reviewer asks.

Follow every rule in part 2. The reviewer gave these rules as corrections in the original session, and breaking them was the most common reason for rework.

---

## 2. Rules

### 2.1 What the report compares

- **Compare structure and setup, not offers.** That means how pages are laid out, how navigation works, how flows are built, how features are presented and where they live.
- **Don't compare numbers or types of things.** That includes the number of missions, promotions or store items, prize sizes, bonus amounts and which promotion types a casino runs. The screenshots never capture everything, so counts are not reliable, and they're not the point.
- Offer figures may appear on the screenshots themselves. Don't use them as a point of comparison.

### 2.2 Tone and wording

- **No scores, ranks or averages anywhere.**
- **No superlatives about competitors.** Don't use "best", "clearest", "strongest", "best-in-class" or "the best competitors". Write **"some competitors"**, or name the casinos. For example: "Sir Betalot has a clean layout", not "one of the clearest layouts".
- Competitor features are **examples, not recommendations.** When two approaches both work, say so. For example: "VegasNova and Sir Betalot give the store its own page; SlotMonster and Oliver show it as a tab inside their rewards hub. Both approaches work."
- The three cards are named **Works**, **Potential gaps** and **Ideas to consider**. Never use "Gaps", "Do next" or "Recommendations".
- **Ideas are suggestions, worded as options:** "could", "consider", "is worth testing", "is another option". For example: "Store and Bonus Store could be merged into one".
- **Keep text minimal.** Card bullets are short phrases. Each comparison has a title plus one or two plain sentences.

### 2.3 What is not a gap

Don't list these as potential gaps. Each was rejected by the reviewer:

- **Design choices that are valid.** Having missions and the store on separate pages from each other keeps each purpose clear. Show a combined hub as an alternative example, not as a fix.
- **One filter when there is only one type of promotion.** At most: "Single filter won't scale if more promotion types are added."
- **Mission rewards that differ in size.** They're proportional to the wagering each mission requires.
- **Not showing what a reward is worth.** Players can see what points buy in the store.
- **Missing starter or streak missions, repeated store artwork, or "no next reward you can afford" hint.**
- **A second gap that is only a consequence of the first.** If there are no tournaments, don't also list "nothing in the menu".
- **The reviewer's personal preferences.** For example, a large banner that uses its space well is a strength. Only a banner with a lot of empty space is a fair negative.

### 2.4 Facts that need checking

- **Don't state something as a gap if it might depend on the account or the day.** For example, the cashier shows no bonus: is that because the account had already deposited? Or a button didn't work: does it work on another day? Mark it as "to check" and ask the reviewer.
- **Record what the reviewer confirms.** In the example, the reviewer checked with a new player account that VegasNova's cashier shows no bonus, so it became a real potential gap.
- **Ask before treating an unusual screenshot as a finding.** A form or pop-up may have been taken by mistake. In the example, a Golden Panda personal-details form was a wrong screenshot and was removed. SlotMonster's ID-verification pop-up was real: it appears when the player taps Deposit.

### 2.5 Screenshots

- **Each section shows only screenshots of that actual page or feature.** Promotions only shows the promotions page, not homepage banners or cashier bonus cards. Tournaments only shows tournament, race or leaderboard pages, not promo cards about a race. Missions only shows the missions pages.
- A screenshot can belong to more than one section (`"sections": ["missions", "store"]`), but only if it genuinely shows both pages.
- **Remove duplicates.** Uploads often contain the same screenshot as both PNG and JPEG, or Mac copies named "… 2" and "… 3".
- **Blur personal data** in the image itself before using it: names, usernames, email addresses and cardholder names. Never write account names or emails into the report text.
- **Ask the reviewer which casino each upload belongs to.** Sort screenshots into sections yourself.
- Don't add descriptions to the enlarged screenshot view. It only shows the image, its highlights, the casino name and a short title.

### 2.6 Comparisons

- **Each comparison point covers one idea.** Give it a short title, then one or two sentences that say what the subject does and what competitors do. Then show 2–4 screenshots.
- **Show the subject casino's screenshot first** whenever it's relevant.
- **Use numbered highlight boxes** on the exact elements being discussed, each with a short label. Prefer one to three boxes per screenshot.
- **Tags on each screenshot** come from its `kind`:
  - **Subject casino:** `works` (green), `gap` (red, shown as "potential gap"), `check` (amber, "to check"), `mixed` (amber, "mixed").
  - **Competitors:** `good` ("Example"), `mixed` ("Mixed"), `avoid` (red, "Avoid"), `note` (amber, "For reference"). Use `note` for a neutral fact you don't want to judge.
- **Promo cards that send players to other features** (missions, rewards hub) are `mixed`. They can help discovery, but they blur promotions and other features. The reviewer prefers missions in their own, clearly visible section.

---

## 3. Report structure (final, agreed with the reviewer)

**Header**
- A purple banner with an icon and the report title only. No subtitle, dates or counters.
- If there is more than one version, a **Desktop / Mobile** switch on the right of the banner.

**Tabs**
- One tab per section, with an icon and the name only. No status dots.
- The sections are Homepage, Promotions, Deposit, Loyalty / VIP, Tournaments, Missions and Store.

**Each section tab, in order**
1. Three cards side by side: **Works** (green), **Potential gaps** (red) and **Ideas to consider** (purple, numbered). An empty card shows "Not offered".
2. **"How it compares"**: numbered comparison points, each with screenshots, highlight boxes and a numbered legend under each screenshot.
3. **"All screenshots for this section"**: folded by default, with filter buttons per casino. Clicking any screenshot enlarges it, with highlights; arrow keys move between screenshots and Esc closes.

**Footer**
- One line per version, for example "Mobile: based on a review of each website on 17 November 2026."

**Mobile version**
- The same tabs and format, with narrow screenshots.
- Card headers stack the casino name above its tag, so every screenshot in a row starts at the same height.

**Deliberately removed. Don't add these back unless the reviewer asks:**
- an overview tab, a casino profiles tab, or a verdict banner per section
- scores, ranks or an Ahead / On par / Behind label
- side-by-side comparison tables
- a "Steal this" card, or a feature checklist grid
- descriptions under enlarged screenshots

**Design**
- Purple header (`#6C5CE7`) on a lavender background (`#F4F3FB`), with white rounded cards.
- The Nunito font, with green / coral / yellow / purple accents.
- Each casino has a fixed colour dot, set in `config.json`. All of this is already in `template/style.css`.

---

## 4. Workflow

1. **Collect screenshots.** Ask the reviewer to send one zip per casino, saying which casino it is.
   - Convert to JPEG and keep each zip under about 25 MB.
   - Images pasted while you're busy may not be saved as files. Ask for them again in a new message.
   - Ask the reviewer to say when the last upload has arrived.
2. **Convert** each casino's screenshots:
   ```bash
   python3 tools/prep_images.py 1600 project/desktop/screenshots/<CasinoId> <files…>
   ```
   Use 720 instead of 1600 for mobile. Remove duplicates and blur personal data in the converted files.
3. **Look at every screenshot.** Put them side by side to save time. Sort them into sections and give each a short title in `screenshots.json`.
4. **Draft the content.** Write `cards.json` and `comparisons.json` following part 2. Write about the subject casino; competitors appear as examples.
5. **Place highlight boxes:**
   ```bash
   python3 tools/grid_overlay.py grid.png <screenshot paths…>
   ```
   Read pixel coordinates from the grid. If you're capturing sites with a browser yourself, take element positions from the page instead.
6. **Build:**
   ```bash
   python3 template/build.py project report.html
   ```
   Then check the result in a real browser at desktop width and at 390 px:
   - every box sits on the right element
   - no horizontal scrolling
   - mobile screenshots line up
7. **Review loop.** Send the report. The reviewer gives notes per section; apply them exactly, and carry each correction forward to the other version (desktop / mobile) and to later sections.

---

## 5. Data format

```
project/
  config.json
  desktop/                    (one folder per version, named in config.json)
    screenshots.json
    cards.json
    comparisons.json
    screenshots/<CasinoId>/01.jpg, 02.jpg, …
  mobile/
    … same files …
```

**config.json**

```json
{
  "title": "VegasNova Competitor Review",
  "subject": "VegasNova",
  "casinos": [ { "id": "VegasNova", "name": "VegasNova", "color": "#6C5CE7" },
               { "id": "Goldenpanda", "name": "Golden Panda", "color": "#E9A92C" } ],
  "sections": [ { "id": "homepage", "name": "Homepage" }, { "id": "promotions", "name": "Promotions" } ],
  "versions": [ { "id": "desktop", "label": "Desktop", "device": "desktop", "folder": "desktop",
                  "footer": "Desktop: based on a review of each website on 10 November 2026." },
                { "id": "mobile",  "label": "Mobile",  "device": "mobile",  "folder": "mobile",
                  "footer": "Mobile: based on a review of each website on 17 November 2026." } ]
}
```

- The subject casino should be listed first in `casinos`.
- Section ids with a built-in icon are `homepage`, `promotions`, `deposit`, `loyalty`, `tournaments`, `missions` and `store`. Other ids get a plain dot.
- A single-version report has one entry in `versions`, and then no switch is shown.

**screenshots.json**: every screenshot per casino, with its section(s) and a short title.

```json
{ "VegasNova": [ { "file": "01.jpg", "sections": ["homepage"], "title": "Lobby with welcome-offer banner" } ] }
```

**cards.json**: the three cards per section.

```json
{ "store": { "works": ["Organised by reward type", "Points balance visible"],
             "gaps":  ["'Store' and 'Bonus Store' duplicate each other"],
             "ideas": ["Store and Bonus Store could be merged into one"] } }
```

**comparisons.json**: the "How it compares" points per section.

```json
{ "store": [ {
    "title": "How the store is presented",
    "text": "VegasNova and Sir Betalot give the store its own page; SlotMonster and Oliver show it as a tab inside their rewards hub. Both approaches work.",
    "shots": [
      { "casino": "VegasNova",  "file": "10.jpg", "kind": "mixed",
        "boxes": [[444, 255, 1008, 85, "Store on its own page"], [36, 330, 225, 110, "'Store' plus a separate 'Bonus Store'"]] },
      { "casino": "Sirbetalot", "file": "05.jpg", "kind": "good",
        "boxes": [[295, 110, 1035, 310, "Store on its own themed page"]] } ] } ] }
```

- Each box is `[x, y, width, height, "label"]`, in pixels of the converted screenshot file.
- `kind` values are listed in part 2.6.

---

## 6. Final check before sending

- [ ] No scores, ranks, counts or superlatives about competitors.
- [ ] Cards are named Works / Potential gaps / Ideas to consider, and the ideas are worded as options.
- [ ] Nothing from part 2.3 is listed as a gap.
- [ ] Each section only uses screenshots of its own page.
- [ ] Personal data is blurred and duplicates are removed.
- [ ] Unverified points are marked "to check" or raised with the reviewer.
- [ ] Every highlight box is on the right element, checked in a browser.
- [ ] The page has no horizontal scrolling at 390 px, and mobile screenshots line up.

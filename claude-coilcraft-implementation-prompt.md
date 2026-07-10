# Claude Implementation Prompt: Coilcraft Inductor Catalog

Implement a Coilcraft inductor catalog and dropdown selector for the existing Buck Converter Loss Tool in this repository.

## Repository context

- Static Jekyll/GitHub Pages site.
- Power-loss page: `tools/buck-losses.html`
- UI logic: `js/tools/buck-loss-ui.js`
- Loss model: `js/tools/buck-loss-model.js`
- URL state: `js/tools/buck-loss-url.js`
- Tests: `tests/`
- Existing manual inputs include inductance, inductor DCR, and inductor Isat.
- Preserve the current framework-free ES-module architecture and existing manual workflow.

## Data-acquisition requirements

1. Create an offline Coilcraft data-acquisition pipeline for:

   - XEL4030
   - XGL6060

2. Use the official datasheets as the canonical electrical source:

   - [XEL4030 series page](https://www.coilcraft.com/en-us/products/power/shielded-inductors/molded-inductor/xel/xel4030/)
   - [XEL4030 PDF](https://www.coilcraft.com/getmedia/8245f050-f190-4295-8c41-7c03d662ee3d/xel4030.pdf)
   - [XGL6060 series page](https://www.coilcraft.com/en-us/products/power/shielded-inductors/molded-inductor/xgl/xgl6060/)
   - [XGL6060 PDF](https://www.coilcraft.com/getmedia/329fe97c-7311-4726-9bf3-37718f42b168/xgl6060.pdf)

3. Parse and retain:

   - Manufacturer
   - Series
   - Base part number
   - Default orderable part number
   - Inductance in µH
   - Tolerance percentage
   - Typical and maximum DCR in mΩ
   - Typical SRF in MHz
   - Isat at 10%, 20%, and 30% inductance drop when published
   - Irms for 20°C and 40°C temperature rise
   - Specification temperature
   - Inductance test frequency, voltage, and DC bias
   - Series-page URL
   - Datasheet URL
   - Datasheet document number
   - Revision date
   - SHA-256 checksum

4. Do not infer missing ratings.

   - XEL4030 publishes only 30%-drop Isat. Leave its 10% and 20% fields null.
   - XGL6060 publishes 10%, 20%, and 30% values.
   - Datasheet values must override rounded HTML values.

5. Generate:

   - Canonical CSV: `data/inductors/coilcraft-parts.csv`
   - Browser JSON: `assets/data/coilcraft-inductors.v1.json`
   - Acquisition script: `scripts/coilcraft/acquire.mjs`

6. The JSON should contain:

   - `schema_version`
   - `catalog_id`
   - Deterministic `catalog_version`
   - Source metadata
   - Disclaimer
   - Sorted `parts` array

   Do not include a generation timestamp because output should be deterministic.

7. Add npm commands:

   - `data:coilcraft:check`
     - Download and parse current PDFs.
     - Validate the candidate.
     - Write candidates under `.cache/coilcraft/`.
     - Report whether tracked CSV/JSON would change.
     - Do not overwrite tracked files.
   - `data:coilcraft:accept`
     - Perform validation and promote the reviewed candidate.

   Add `.cache/` to `.gitignore`.

8. Optionally support a live Coilcraft roster cross-check using:

   ```text
   POST https://www.coilcraft.com/api/partssearch/partsFromSeries
   ```

   Payload:

   ```json
   {
     "IsPow": true,
     "SeriesName": "XEL4030"
   }
   ```

   Make this opt-in with `RUN_COILCRAFT_LIVE=1`, because Coilcraft/Cloudflare may block automated browser sessions. Never call this endpoint from the public webpage.

Expected counts:

- XEL4030: 13 parts
- XGL6060: 20 parts
- Total: 33 parts

## UI requirements

1. Add a native, accessible Coilcraft part dropdown to the **Inductor & capacitors** section of the loss tool.

2. Structure:

   - First option: **Custom / manual**
   - Group parts by XEL4030 and XGL6060.
   - Display part number and inductance in each option.
   - Add a second selector for:
     - Typical DCR
     - Maximum DCR

3. Selecting a part must populate:

   - Main inductance input
   - Inductor DCR input
   - Inductor Isat input

4. Isat selection policy:

   - Prefer the published 20%-drop rating.
   - If unavailable, use the published 30%-drop rating.
   - If that is unavailable, use 10%.
   - Clearly display which inductance-drop criterion is active.
   - Never manufacture or interpolate a missing value.

5. Show a concise metadata line containing:

   - Selected part
   - Inductance
   - DCR assumption
   - Isat threshold
   - Datasheet link

6. If the user manually changes inductance, DCR, or Isat after selecting a part, automatically return the dropdown to **Custom / manual**.

7. If the catalog fails to load, retain all manual inputs and show a quiet explanatory message.

8. State explicitly in the UI:

   - DCR represents modeled copper loss.
   - AC/core loss is not modeled.
   - Users should verify the current manufacturer datasheet before design release.
   - The project is unaffiliated with Coilcraft.

9. Preserve all current presets, equations, URL behavior, responsive layout, and accessibility behavior.

## Validation

Add automated tests covering:

- Exactly 13 XEL4030 and 20 XGL6060 parts.
- Unique part numbers.
- Positive finite electrical values.
- Maximum DCR ≥ typical DCR.
- Irms at 40°C rise ≥ Irms at 20°C rise.
- XGL6060 Isat values are monotonic: `Isat10 ≤ Isat20 ≤ Isat30`.
- Deterministic CSV/JSON output.
- PDF parsing for both table shapes.
- Dropdown loading all 33 parts.
- XGL6060-222 populates:
  - L = 2.2 µH
  - Typical DCR = 4.3 mΩ
  - Maximum DCR = 4.8 mΩ
  - Selected Isat = 12.1 A at 20% drop
- XEL4030-201 populates:
  - L = 0.20 µH
  - Typical DCR = 2.15 mΩ
  - Maximum DCR = 2.40 mΩ
  - Selected Isat = 22.0 A at 30% drop
- Changing DCR mode updates the DCR input.
- A manual input edit returns the selector to Custom.
- Catalog failure preserves manual operation.
- No serious accessibility regressions.
- No horizontal overflow at desktop or 390 px mobile width.
- No browser console errors.

## Implementation constraints

- Inspect the existing code before changing it.
- Preserve unrelated user changes.
- Use `apply_patch` for source edits.
- Do not add a frontend framework.
- Do not scrape or digitize AC/core-loss curves in this iteration.
- Do not include dimensions, pricing, inventory, or packaging variants beyond the default MEC orderable number.
- Keep code modular and data refreshes reviewable.
- Run unit tests, data validation, Jekyll build, focused browser tests, accessibility tests, and desktop/mobile browser QA.
- Report changed files, test results, and any remaining limitations when finished.

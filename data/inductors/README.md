# Coilcraft inductor catalog

`coilcraft-parts.csv` is the reviewed canonical table used by the buck-converter loss tool. The browser-facing file is generated at `assets/data/coilcraft-inductors.v1.json`.

## Refresh workflow

1. Run `npm run data:coilcraft:check` to download the current XEL4030 and XGL6060 datasheets, parse their electrical tables, validate all rows, and write candidates under `.cache/coilcraft/`.
2. Review the candidate diff, source revision, and datasheet checksums.
3. Run `npm run data:coilcraft:accept` to promote the reviewed CSV and JSON.

Set `RUN_COILCRAFT_LIVE=1` during the check to also compare the PDF part set with Coilcraft's part-finder roster endpoint. Coilcraft may challenge automated browser sessions, so the PDF remains the canonical source and roster checking is intentionally opt-in.

## Scope and assumptions

- Included: inductance, tolerance, typical/maximum DCR, typical SRF, published Isat thresholds, and 20 °C/40 °C temperature-rise Irms.
- Excluded: dimensions, packaging variants beyond the default `MEC` orderable number, price/availability, and digitized curves.
- The browser always uses full inductor RMS current for the selected typical or maximum DCR. Characterized parts add a Coilcraft-derived residual equal to vendor `ACLoss` minus the ripple-current DCR already included in the RMS calculation.
- This project is unaffiliated with Coilcraft. Specifications may change; verify the current manufacturer datasheet before design release.

## AC-loss models

The public loss dataset keeps the original schema-v1 surface for `XEL4030-201` and publishes schema-v2 compressed models for `XEL4030-471`, `XEL4030-102`, `XEL4030-222`, `XGL6060-102`, `XGL6060-222`, and `XGL6060-472`. All models apply only at 25 °C with triangular ripple. Each v2 model fits Coilcraft's vendor AC loss as `A(f) × Ipp^B(f)`, interpolating `log(A)` and `B` in log-frequency.

The browser calculator always evaluates conduction as `I_L,RMS² × DCR`. It adds only `max(0, vendor AC loss − Ipp²/12 × DCRtyp)`, so ripple copper is not counted twice. A manual additional AC/core-loss value remains additive. Schema-v2 models expose verified and guarded domains; guarded estimates receive an explicit warning, while estimates outside the guarded frequency/ripple range, above the selected saturation current, at another temperature, or with another waveform are rejected and the result is labeled as a subtotal.

### Legacy schema-v1 acquisition

The original two-part surface workflow stores raw and normalized runs only under `.cache/coilcraft-loss/`.

1. Run `npm run data:coilcraft:loss:plan` to review the exact grid and request count.
2. Run `npm run data:coilcraft:loss:collect` to open a normal browser session, preflight the live loss schema, and collect at a single-request rate. Use `-- --resume <run-id>` to resume.
3. Run `npm run data:coilcraft:loss:validate -- --run <run-id>` to require a complete, unique, accounting-compatible dataset and holdout thresholds.
4. Only after written approval is represented by an untracked/reviewed `data/inductors/coilcraft-loss-approval.json`, run `npm run data:coilcraft:loss:promote -- --run <run-id>`.

The collector verifies that Coilcraft's `DCLoss` is IDC-only, then derives an additional AC/core term as `ACLoss − (ΔIpp²/12) × DCRtyp`. This preserves the calculator's full-RMS DCR convention while reproducing the vendor's typical total-loss accounting without double counting ripple copper.

### Schema-v2 pilot acquisition

The v2 workflow is deliberately split into reviewable stages. Coilcraft may challenge a standalone automated browser; collection can instead use the normal in-app browser session to issue the same-origin tool requests described by each generated plan. Raw responses, discovery coefficients, fitted coefficients, refinement history, validation reports, and provenance remain under `.cache/coilcraft-loss-v2/` and are never published.

1. Run `npm run data:coilcraft:loss:v2:discovery` and collect one discovery response per pilot part.
2. Run `npm run data:coilcraft:loss:v2:plan -- --discoveries <path>` to generate the two-ripple-anchor training plan, IDC canaries, deterministic hidden checks, and guarded anchor checks.
3. Collect the plan, normalize it, and run `npm run data:coilcraft:loss:v2:refine -- --run <run-id> --round 1`. Merge requested points with `npm run data:coilcraft:loss:v2:merge-refinement -- --run <run-id>`, then repeat once for round 2 if requested.
4. Run `npm run data:coilcraft:loss:v2:validate -- --run <run-id>`. Each part must independently pass the hidden, guarded, IDC-invariance, zero-ripple, nonnegative-residual, adaptive, and practical-anchor gates.
5. After review is recorded in the untracked `data/inductors/coilcraft-loss-approval.json`, run `npm run data:coilcraft:loss:v2:promote -- --run <run-id>`.

Promotion requires all six pilot parts to pass. If a future `XGL6060-222` migration fails, the builder retains its valid schema-v1 model. The same pipeline can be reused for more catalog parts without changing the validation thresholds.

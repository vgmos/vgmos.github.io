---
sitemap: false
---

# Buck-loss model v2.1 release notes

Model revision 2.1 is a trust and validation update to the existing `m=2` analytical explorer. Existing versioned URLs remain parse-compatible; the frozen v1 implementation is unchanged.

## What changed

- Infeasible dropout, duty-window, dead-time, and volt-second states now stop before sweep evaluation, clear stale results, and show the failed arithmetic with recovery guidance.
- Diode-emulation DCM no longer treats switch-node energy or continuous-triangle catalog magnetics characterization as known. A separately entered manual residual remains included and disclosed.
- The DCM scheduler now reserves both dead-time windows before assigning the low-side interval. This corrects the long-dead-time handoff and means DCM values and the displayed CCM/DCM boundary can differ from earlier v2 results.
- Subtotals are labeled as a known-loss efficiency ceiling and known-input floor. Held-reference efficiency deltas are suppressed unless both sides have total coverage.
- Transition equations now disclose the formula that actually ran. Effective overlap is marked as an adaptation; Equation 4.39 is shown only for the derived phase model. QRR and switch-node energy adaptations are also explicit.
- Across-load charts share an accessible, three-significant-digit cursor with hover preview, pointer scrubbing, keyboard control, committed URL state, cached sweeps, linear 1-2-5 loss ticks, and a causal loss-character band.
- Pointer and keyboard chart input use explicit modality arbitration, so a stationary WebKit hover cannot overwrite a committed keyboard position after a chart redraw.
- Ranked loss rows retain their expanded/focused state while reordering with a restrained 220 ms FLIP transition; reduced-motion preferences disable movement.

## Manufacturer example

The new manufacturer-sourced silicon example is an Infineon BSC010N04LS6 symmetric pair. Analytical inputs come from its disclosed datasheet conditions; unsupported total gate-path timing and energy-equivalent COSS remain unset rather than inferred.

The official OptiMOS6 40 V PSpice library (version `280225`) is acquired locally and hash-checked, not redistributed. Native LTspice runs require `.options Thev_Induc=1` to avoid its implicit package-inductor resistance artifact. This scoped model check supports reproducibility; it is not part-level design signoff or a claim that the example is optimal for every operating point.

The final native reports compare published conditions without changing the analytical template to force agreement. Infineon RDS(on), VSD, total QG, and QOSS comparisons pass their disclosed policies; its project-defined QGS/QGD proxy and bounded QRR extraction are retained as non-equivalent evidence. EPC RDS(on), total QG, QOSS, and COSS(ER)-derived EOSS compare successfully, while its VSD comparison and total-QG timestep convergence do not. Those results deliberately keep the cross-check badge and release gate off.

## Validation policy

- Formula-generated PWL integrations are classified as analytical identity checks, not independent topology evidence.
- Switched-topology fixtures separately cover CCM/DCM boundary behavior, dead time, dropout, 48 V operation, and forced negative current.
- Vendor-model reports record hashes, simulator/version, per-lane timestep and repeatability checks, steady-state drift, exact-condition comparisons, and scoped characterization deltas.
- Bounded full-buck checks pass their repeatability, timestep, steady-state, KCL, and energy-residual gates for the EPC primary model and the official Infineon L0 fallback. The more detailed Infineon L1 half-bridge attempt remains explicitly non-convergent and is not silently replaced.
- Ordinary reproducibility checks accept honest unsupported or failed comparison evidence. `test:spice:release` additionally runs the simulators and fails closed unless every required vendor comparison is complete, stable, and badge-eligible.
- A “Report a mismatch” link sends only the canonical state, model revision, device, operating point, modes, coverage, and omissions. There is no passive telemetry.

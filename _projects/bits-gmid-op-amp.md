---
title: gm/ID Op-Amp Sizing
display_title: "<var>g</var><sub>m</sub>/<var>I</var><sub>D</sub> Op-Amp Sizing"
institution: BITS Pilani
period: 2017
role: Undergraduate course project (EEE F366)
kind: project
featured: false
topics:
  - analog design
  - gm/ID
  - Cadence Virtuoso
  - CMOS
status: Course project, 2017
date: 2017-08-27
summary: Replacing broken square-law hand formulas with transconductance efficiency to size a 45 nm CMOS OTA directly from simulated device curves.
description: A BITS Pilani study of gm/ID transistor sizing in Cadence Virtuoso, explaining why square-law sizing breaks in 45 nm CMOS and how transconductance efficiency governs OTA tradeoffs.
---

Textbook analog sizing begins with the long-channel square-law equation — pick an overdrive voltage, solve for <span class="math-inline"><var>W</var>/<var>L</var></span>, and iterate in SPICE. In a 45 nm CMOS process, that recipe breaks down immediately: velocity saturation, mobility degradation, and drain-induced barrier lowering warp the quadratic <span class="math-inline"><var>I</var><sub>D</sub>–<var>V</var><sub>OV</sub></span> curve, and power-constrained analog stages routinely sit in **moderate inversion**, right between the weak- and strong-inversion textbook asymptotes.

In 2017, for EEE F366 with Dr. Pravin Mane at BITS Pilani, I studied the <span class="math-inline"><var>g</var><sub>m</sub>/<var>I</var><sub>D</sub></span> methodology in Cadence Virtuoso using the 45 nm GPDK. I sized a single-stage OTA (operational transconductance amplifier) from pre-characterized device sweeps; extending the stage into a compensated two-stage unbuffered op-amp remained the follow-on design goal.

## Why <span class="math-inline"><var>g</var><sub>m</sub>/<var>I</var><sub>D</sub></span> replaces overdrive voltage

A transistor's small-signal transconductance, <span class="math-inline"><var>g</var><sub>m</sub> = ∂<var>I</var><sub>D</sub>/∂<var>V</var><sub>GS</sub></span> at fixed <var>V</var><sub>DS</sub> and <var>V</var><sub>BS</sub>, measures how strongly drain current responds to a gate-source perturbation — governing amplifier gain, gain-bandwidth product, and input-referred thermal noise. Dividing by bias current yields **transconductance efficiency**, <span class="math-inline"><var>g</var><sub>m</sub>/<var>I</var><sub>D</sub></span>: the transconductance bought per microamp of bias current ([Silveira, Flandre, and Jespers, 1996](https://doi.org/10.1109/4.535416)).

Because <span class="math-inline"><var>g</var><sub>m</sub>/<var>I</var><sub>D</sub></span> tracks channel inversion smoothly from weak through strong inversion — independent of device width, with <span class="math-inline"><var>V</var><sup>*</sup> = 2/(<var>g</var><sub>m</sub>/<var>I</var><sub>D</sub>)</span> serving as a model-independent proxy for overdrive voltage — it lays the core analog tradeoff bare:

- **Higher <span class="math-inline"><var>g</var><sub>m</sub>/<var>I</var><sub>D</sub></span> (weak to moderate inversion)** maximizes current efficiency and lowers the drain-source saturation voltage (preserving output swing headroom), **at the cost of** wide transistors, large parasitic gate capacitance <var>C</var><sub>gg</sub>, and lower transit frequency <span class="math-inline"><var>f</var><sub>T</sub> ≈ <var>g</var><sub>m</sub>/(2π<var>C</var><sub>gg</sub>)</span>.
- **Lower <span class="math-inline"><var>g</var><sub>m</sub>/<var>I</var><sub>D</sub></span> (strong inversion)** buys compact devices and higher <var>f</var><sub>T</sub> for speed, **at the cost of** higher bias current and tighter voltage headroom.

## Turning sizing into a lookup flow

Pre-characterizing NMOS and PMOS devices in Cadence across channel length <var>L</var> and inversion level turns OTA sizing from trial and error into a repeatable three-step sequence:

1. Choose each transistor's channel length <var>L</var> to balance intrinsic gain (<span class="math-inline"><var>g</var><sub>m</sub><var>r</var><sub>o</sub></span>) and matching area against speed (<var>f</var><sub>T</sub>).
2. Choose <span class="math-inline"><var>g</var><sub>m</sub>/<var>I</var><sub>D</sub></span> by circuit role — higher for an input differential pair where current efficiency and low input-referred thermal noise (<span class="math-inline">∝ 1/<var>g</var><sub>m</sub></span>) dominate; lower for current mirrors and active loads to curb output noise current (<span class="math-inline">∝ <var>g</var><sub>m</sub></span>) and fractional threshold-mismatch sensitivity (<span class="math-inline">Δ<var>I</var><sub>D</sub>/<var>I</var><sub>D</sub></span> ≈ <span class="math-inline">(<var>g</var><sub>m</sub>/<var>I</var><sub>D</sub>)&thinsp;Δ<var>V</var><sub>TH</sub></span>), as well as on high-speed nodes where parasitic capacitance dominates.
3. Combine the required <var>g</var><sub>m</sub> (set by gain-bandwidth and load capacitance) with <span class="math-inline"><var>g</var><sub>m</sub>/<var>I</var><sub>D</sub></span> to fix bias current <var>I</var><sub>D</sub>, read normalized current density <span class="math-inline"><var>I</var><sub>D</sub>/<var>W</var></span> from the simulated curves, and obtain device width directly as <span class="math-inline"><var>W</var> = <var>I</var><sub>D</sub>/(<var>I</var><sub>D</sub>/<var>W</var>)</span>.

Even with exact device lookup tables, <span class="math-inline"><var>g</var><sub>m</sub>/<var>I</var><sub>D</sub></span> is a sizing discipline rather than a bypass around circuit physics: gain, gain-bandwidth product, slew rate, self-loading capacitance, and swing still push directly against one another — the method simply makes each tradeoff visible on the first pass instead of buried inside iterative SPICE tweaks.

## Further reading

- F. Silveira, D. Flandre, and P. G. A. Jespers, ["A <var>g</var><sub>m</sub>/<var>I</var><sub>D</sub> based methodology for the design of CMOS analog circuits and its application to the synthesis of a silicon-on-insulator micropower OTA,"](https://doi.org/10.1109/4.535416) IEEE Journal of Solid-State Circuits, vol. 31, no. 9, pp. 1314–1319, 1996.

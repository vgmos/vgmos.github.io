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
summary: Relating transistor response to bias current through a 45 nm OTA sizing study.
description: A BITS Pilani study of gm/ID transistor sizing in Cadence Virtuoso, explaining transconductance efficiency and the scope of a single-stage OTA design.
---

In 2017, for EEE F366 with Dr. Pravin Mane at BITS Pilani, I studied <span class="math-inline"><var>g</var><sub>m</sub>/<var>I</var><sub>D</sub></span> sizing in Cadence Virtuoso using the 45 nm GPDK. I sized a single-stage OTA (operational transconductance amplifier); extending it to a two-stage unbuffered op-amp remained a design objective.

Intrinsic transistor transconductance, <var>g</var><sub>m</sub>, measures how much drain current changes for a small change in gate-to-source voltage, with the other terminal voltages held fixed relative to the source. The ratio <span class="math-inline"><var>g</var><sub>m</sub>/<var>I</var><sub>D</sub></span> expresses that response per unit bias current: the transistor's transconductance efficiency.

For a required <var>g</var><sub>m</sub>, a higher <span class="math-inline"><var>g</var><sub>m</sub>/<var>I</var><sub>D</sub></span> means less bias current. Device capacitance, output resistance, and available voltage swing still constrain the design; <span class="math-inline"><var>g</var><sub>m</sub>/<var>I</var><sub>D</sub></span> alone does not determine amplifier performance.

The motivation was to ground transistor sizing in short-channel device behavior instead of relying on long-channel equations. The work plan combined hand calculations and Cadence simulation, with gain, gain-bandwidth product, and slew rate as design tradeoffs.

## Further reading

- F. Silveira, D. Flandre, and P. G. A. Jespers, ["A <var>g</var><sub>m</sub>/<var>I</var><sub>D</sub> based methodology for the design of CMOS analog circuits and its application to the synthesis of a silicon-on-insulator micropower OTA,"](https://doi.org/10.1109/4.535416) IEEE Journal of Solid-State Circuits, vol. 31, no. 9, pp. 1314–1319, 1996.

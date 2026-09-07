---
title: gm/ID Op-Amp Sizing
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

In 2017, for EEE F366 with Dr. Pravin Mane at BITS Pilani, I studied gm/ID sizing in Cadence Virtuoso using the 45 nm GPDK. I sized a single-stage OTA (operational transconductance amplifier); extending it to a two-stage unbuffered op-amp remained a design objective.

Intrinsic transistor transconductance, gm, measures how much drain current changes for a small change in gate-to-source voltage, with the other terminal voltages held fixed relative to the source. The ratio gm/ID expresses that response per unit bias current: the transistor's transconductance efficiency.

For a required gm, a higher gm/ID means less bias current. Device capacitance, output resistance, and available voltage swing still constrain the design; gm/ID alone does not determine amplifier performance.

The motivation was to ground transistor sizing in short-channel device behavior instead of relying on long-channel equations. The work plan combined hand calculations and Cadence simulation, with gain, gain-bandwidth product, and slew rate as design tradeoffs.

## Further reading

- F. Silveira, D. Flandre, and P. G. A. Jespers, ["A gm/ID based methodology for the design of CMOS analog circuits and its application to the synthesis of a silicon-on-insulator micropower OTA,"](https://doi.org/10.1109/4.535416) IEEE Journal of Solid-State Circuits, vol. 31, no. 9, pp. 1314–1319, 1996.

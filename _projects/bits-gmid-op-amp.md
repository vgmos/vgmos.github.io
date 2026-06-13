---
title: Two-Stage Unbuffered Op-Amp Design Using gm/ID
institution: BITS Pilani
period: 2017
role: Lab-oriented project student
kind: project
featured: false
topics:
  - analog design
  - gm/ID
  - Cadence Virtuoso
  - CMOS
status: Lab-oriented analog design project
date: 2017-08-27
updated: 2026-06-12
summary: An early analog-design project using gm/ID methodology and Cadence simulations to design a two-stage unbuffered operational amplifier.
description: BITS Pilani lab-oriented project on designing a two-stage unbuffered op-amp with gm/ID methodology, Cadence Virtuoso, and 45 nm GPDK.
---

This is the first clear analog-design thread in the project record: a serious move from textbook circuit familiarity into sizing, tradeoffs, and simulation closure.

The work was part of EEE F366, a Lab Oriented Project at BITS Pilani. The objective was direct: design a two-stage unbuffered operational amplifier using semi-empirical and analytic gm/ID methods, then implement and simulate it in Cadence Virtuoso using the 45 nm GPDK process.

## Design Question

A two-stage op-amp is a useful learning vehicle because it forces multiple analog tradeoffs into the same room: gain, bandwidth, output swing, slew rate, compensation, device overdrive, and layout-aware feasibility.

The gm/ID framing mattered because it replaces blind transistor sizing with a controlled tradeoff language. Instead of treating width and current as knobs to turn until the simulator stops complaining, gm/ID asks what inversion level and efficiency make sense for each device's job.

## Source Trail

- Lab-oriented project work plan for EEE F366.
- Short note titled "Design of two-staged unbuffered Operational Amplifier."
- Cadence-oriented note documenting operational-amplifier design constraints for the available technology and supply/swing assumptions.
- Older BITS research CV listing undergraduate research with Dr. Pravin Mane on a two-stage unbuffered op-amp in GPDK45.

## What I Learned

The useful lesson was not a final performance number. It was the first encounter with analog design as tradeoff navigation:

- A schematic target is only the start.
- gm/ID gives a designer a map between current, transconductance, speed, and intrinsic gain.
- Cadence simulation turns theory into closure only when the assumptions are explicit.
- Compensation and swing constraints are not finishing touches; they shape the architecture from the beginning.

Its value is best presented as a design-process milestone: the point where analog IC design stopped being a set of elegant textbook figures and became a practice of sizing, simulating, and defending tradeoffs.

---
title: gm/ID Two-Stage Op-Amp
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
summary: A first full analog design in 45 nm, sized with the gm/ID method.
description: A two-stage unbuffered op-amp designed with the gm/ID methodology in Cadence Virtuoso on the 45 nm GPDK, as a lab-oriented project at BITS Pilani.
---

In 2017, for a lab-oriented project course at BITS Pilani (EEE F366, with Dr. Pravin Mane), I designed a two-stage unbuffered op-amp in Cadence Virtuoso on the 45 nm GPDK. It was my first analog design that went past reproducing a textbook figure.

The method was the real content. gm/ID sizing gives you a map between current, transconductance, speed, and intrinsic gain, so instead of nudging widths until the simulator stops complaining, you pick an inversion level for each transistor based on the job it has to do. Input pair, load, second stage — each lands in a different region, for a reason you can say out loud.

A two-stage op-amp is a good first vehicle because nothing in it is separable. Gain, bandwidth, output swing, slew rate, and compensation all pull on the same handful of devices. Compensation surprised me the most: I had it filed under "add a Miller cap at the end," and it turned out to constrain the sizing of both stages from the start.

{% comment %}TODO(Vasu): if you still have the spec targets, a schematic, or a Bode plot from this project, one concrete artifact would do a lot here.{% endcomment %}

This page doesn't reconstruct the final numbers. What the project left behind is a habit — sizing with a stated reason — and most designs I've done since have started the same way.

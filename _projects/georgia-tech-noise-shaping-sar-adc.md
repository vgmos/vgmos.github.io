---
title: Third-Order Noise-Shaping SAR ADC
institution: Georgia Tech
period: 2019-2021
role: Research collaborator; behavioral modeling and architecture exploration
kind: project
featured: true
topics:
  - analog design
  - data converters
  - noise shaping
  - SAR ADC
status: Graduate research thread and ISSCC/JSSC collaboration
date: 2021-09-09
updated: 2026-06-12
summary: A Georgia Tech collaboration connecting NS-SAR behavioral modeling with a 13.8-ENOB third-order noise-shaping SAR ADC published at ISSCC and in IEEE JSSC.
description: Georgia Tech research collaboration on high-resolution noise-shaping SAR ADC architecture, grounded in behavioral modeling work and the later ISSCC/JSSC publication.
links:
  - label: IEEE JSSC paper DOI
    url: https://doi.org/10.1109/JSSC.2021.3108620
---

This project sits at the boundary between converter architecture and circuit implementation: how far can a mostly dynamic SAR ADC be pushed toward high resolution before noise, loop-filter overhead, and capacitor size erase the efficiency advantage?

The source trail begins with a special-problem report on noise-shaping SAR ADCs. That work focused on behavioral models: second- and third-order error-feedback structures, EF/CIFF variants, NTF tuning, Delta-Sigma toolbox experiments, MATLAB scripts, and Simulink models. The later public anchor is the Georgia Tech team publication on a fully dynamic third-order NS-SAR ADC.

## Design Question

SAR ADCs are attractive because much of the conversion work is dynamic and digital-like. That makes them power efficient and friendly to CMOS scaling. The problem is that high resolution usually asks for either larger sampling capacitance, more analog residue processing, or heavier calibration.

Noise shaping changes the bargain. Instead of treating quantization noise as something spread uniformly through the Nyquist band, the converter shapes that noise away from the signal band. The architectural question becomes how to get that benefit without paying for a bulky loop filter.

## Contribution Shape

The modeling work explored NTF behavior, SQNR, OSR, zero placement, and out-of-band gain for error-feedback and CIFF-style structures. That modeling formed the architecture-level context for the later collaboration.

The published chip used a single-amplifier EF-CIFF structure, hardware-reusing kT/C noise cancellation, and fully dynamic operation. The reported prototype achieved 13.8 ENOB, 84.8 dB SNDR over 625 kHz bandwidth, and 119 uW power in 65 nm CMOS.

## Sources

- ISSCC 2021 paper: "A 13.8-ENOB 0.4pF-CIN 3rd-Order Noise-Shaping SAR in a Single-Amplifier EF-CIFF Structure with Fully Dynamic Hardware-Reusing kT/C Noise Cancelation."
- IEEE JSSC 2021 article: "A 13.8-ENOB Fully Dynamic Third-Order Noise-Shaping SAR ADC in a Single-Amplifier EF-CIFF Structure With Hardware-Reusing kT/C Noise Cancellation."
- Georgia Tech special-problem report titled "Noise Shaping SAR ADC."
- NS-SAR project folders with MATLAB scripts, Simulink models, EF-CIFF notes, and SAR digital-circuit sketches.

## What I Learned

This project sharpened a pattern that shows up across analog design: the architecture is doing more than arranging blocks. It is allocating imperfection. In a noise-shaping ADC, every choice about loop structure, capacitor size, quantizer behavior, and dynamic reuse is also a choice about where error is allowed to live.

It also reinforced how to frame collaborative research with precision: describe the technical thread, name the evidence, and keep the team result distinct from the individual contribution.

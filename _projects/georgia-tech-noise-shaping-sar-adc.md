---
title: Third-Order Noise-Shaping SAR ADC
institution: Georgia Tech
period: 2019-2021
role: Research collaborator
kind: project
featured: true
topics:
  - analog design
  - data converters
  - noise shaping
  - SAR ADC
status: Scaffolded from JSSC, ISSCC, and modeling artifacts
date: 2021-09-09
updated: 2026-06-12
summary: A Georgia Tech collaboration on a 13.8-ENOB fully dynamic third-order noise-shaping SAR ADC with EF-CIFF structure and kT/C noise cancellation.
description: Georgia Tech research collaboration on high-resolution noise-shaping SAR ADC architecture, published at ISSCC and in IEEE JSSC.
links:
  - label: IEEE JSSC paper DOI
    url: https://doi.org/10.1109/JSSC.2021.3108620
---

## Why It Belongs

This is the other headline Georgia Tech page. It has strong external validation through ISSCC and JSSC, and it sits close to the analog-design identity of the site.

The public page should be written with care because the project was collaborative. The best framing is not "my ADC"; it is a research contribution inside a Georgia Tech team effort, with emphasis on the architectural ideas that are useful to explain publicly.

## Source Trail

- ISSCC 2021 paper: "A 13.8-ENOB 0.4pF-CIN 3rd-Order Noise-Shaping SAR in a Single-Amplifier EF-CIFF Structure with Fully Dynamic Hardware-Reusing kT/C Noise Cancelation."
- IEEE JSSC 2021 article: "A 13.8-ENOB Fully Dynamic Third-Order Noise-Shaping SAR ADC in a Single-Amplifier EF-CIFF Structure With Hardware-Reusing kT/C Noise Cancellation."
- Archived NS-SAR folder with MATLAB scripts, Simulink models, EF-CIFF notes, and SAR digital-circuit sketches.
- Archived CV listing high-order NS-SAR behavioral modeling and NTF-optimized second- and third-order EFB/CIFF modulator exploration.

## Technical Shape

The work addresses two bottlenecks in high-resolution noise-shaping SAR ADCs:

- Realizing high-order noise shaping without large loop-filter overhead.
- Reducing kT/C noise without simply increasing capacitance.

The publication reports a single-amplifier EF-CIFF architecture, hardware-reusing sampling kT/C noise cancellation, and a fully dynamic implementation. The measured prototype achieved 84.8 dB SNDR over 625 kHz bandwidth at 119 uW in 65 nm CMOS.

## Presentation Plan

The page should eventually become an architecture explainer:

- Start with why SAR ADCs lose efficiency at high resolution.
- Explain noise shaping in one paragraph and one simple signal-flow sketch.
- Show what EF-CIFF changes compared with pure EF or pure CIFF paths.
- Keep measured chip results in a small table sourced to the publication.
- Separate personal reconstruction from collaborator-owned implementation details.

The right voice here is humble and precise: enough depth to show taste, not so much that it reads like a copied paper.

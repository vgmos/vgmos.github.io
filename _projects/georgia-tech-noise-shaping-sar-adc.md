---
title: High-Order Noise-Shaping SAR ADC
institution: Georgia Tech
period: Fall 2019; ISSCC/JSSC 2021
role: Research project with Prof. Shaolan Li's GAMMA group; behavioral modeling and architecture exploration
kind: project
featured: true
topics:
  - analog design
  - data converters
  - noise shaping
  - SAR ADC
status: Fall 2019 research project and ISSCC/JSSC collaboration
date: 2021-09-09
updated: 2026-06-21
summary: A Georgia Tech research project on high-order noise-shaping SAR ADC architecture, later connected to a published 13.8-ENOB third-order EF-CIFF NS-SAR ADC.
description: Georgia Tech work on high-order noise-shaping SAR ADC architecture, using behavioral models, NTF optimization, OSR sweeps, and coefficient-sensitivity studies before the later ISSCC/JSSC team publication.
links:
  - label: IEEE JSSC paper DOI
    url: https://doi.org/10.1109/JSSC.2021.3108620
  - label: ISSCC 2021 digest DOI
    url: https://doi.org/10.1109/ISSCC42613.2021.9365990
---

This project has two layers that are easy to blur if I am not careful.

The first is the Fall 2019 research work I actually carried through: behavioral modeling for high-order noise-shaping SAR ADCs. That work lived in MATLAB scripts, Simulink models, coefficient sweeps, pole-zero plots, and short design notes. The second is the later public result: a Georgia Tech team chip published at ISSCC and in IEEE JSSC, where the architecture matured into a fully dynamic third-order NS-SAR ADC.

The useful story is the connection between those layers, not pretending they are the same thing.

## Design Question

SAR ADCs are efficient because much of the conversion work is dynamic and digital-like. That is also why they are attractive in scaled CMOS. The harder question is how to push them toward high resolution without paying the usual cost in large sampling capacitance, static residue amplifiers, or heavy calibration.

Noise shaping changes the bargain. Instead of leaving quantization noise spread across the Nyquist band, the converter shapes it away from the signal band. Once that becomes the goal, the architecture is no longer just a SAR loop with a clever residue path. It becomes a question of where the error goes, how aggressively the NTF can be shaped, and how sensitive the result is to the coefficients that implement it.

## Fall 2019 Work

The project brief in my October 2019 notes was direct: compare error-feedback NTF implementations by optimization strength and by sensitivity to coefficient variation. In practice, that meant building the same comparison loop around several candidate structures:

- choose a second-, third-, or fourth-order NTF form;
- optimize coefficients using MATLAB search scripts;
- sweep the coefficients around the chosen value;
- plot zero movement, SQNR at OSR 4, and SQNR at OSR 8;
- compare whether the improvement was robust or just a narrow optimum.

The model set started from a second-order EF baseline and expanded into single-loop third-order EF, cascaded EF-EF, CIFF-EF, and fourth-order nested variants. The spreadsheet and deck from the project use a 9-bit behavioral quantizer assumption and compare simulated SQNR across OSR 4 and OSR 8. Those numbers were not product specifications. They were a way to ask a more architectural question: which loop structure buys useful in-band noise suppression without becoming too fragile?

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/noise-shaping-sar-adc/mod3-ef-architecture.png' | relative_url }}" alt="Simulink-style third-order error-feedback noise-shaping SAR ADC behavioral model with delayed feedback paths and coefficients k1, k2, k3, and Kef.">
  </div>
  <figcaption><strong>Third-order EF behavioral model.</strong> One of the project models used to connect NTF choice, coefficient values, and simulated SQNR.</figcaption>
</figure>

The most useful plots were not the tallest peaks. They were the sensitivity plots. If a coefficient value gives high SQNR only at a knife-edge setting, the circuit implementation has to pay for that precision somewhere. If the curve is flatter, the architecture is more forgiving. That is the kind of result that belongs at the architecture level before a transistor-level implementation starts consuming weeks.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/noise-shaping-sar-adc/mod3-ciff-ef-osr8-sensitivity.png' | relative_url }}" alt="Simulated SQNR versus K_EF for a third-order CIFF-EF noise-shaping SAR candidate at OSR 8. The plot marks about 100 dB peak SQNR and a 96 dB reference line.">
  </div>
  <figcaption><strong>Coefficient sensitivity at OSR 8.</strong> A CIFF-EF candidate showing the gap between a nominal setting and an optimized behavioral-model setting.</figcaption>
</figure>

In the summary spreadsheet, the second-order baseline was around 75 dB at OSR 4 and 90 dB at OSR 8. The best single-loop third-order EF variants moved that to roughly 83.5 dB and 104 dB under the same behavioral assumptions. The cascaded and nested structures were not automatically better; their value depended on whether the extra order translated into a usable NTF and tolerable coefficient sensitivity.

That was the real lesson of the modeling work. Higher order is not a virtue by itself. It is useful only when the implementation can hold the zeros, gains, sampling sequence, and residue processing close enough to the model for the shaped-noise benefit to survive.

## Later Public Result

The later published chip took the architectural thread into silicon. The ISSCC digest and JSSC article reported a fully dynamic third-order noise-shaping SAR ADC in 65 nm CMOS using a single-amplifier EF-CIFF structure with hardware-reusing kT/C noise cancellation. The reported prototype achieved 13.8 ENOB and 84.8 dB SNDR over 625 kHz bandwidth while consuming 119 uW.

That result is the public anchor for this project page, but I want to keep the boundary clean. My Fall 2019 contribution was not "I built the whole ADC." It was architecture-level modeling and exploration: NTF behavior, SQNR estimation, OSR sweeps, zero placement, EF/CIFF variants, and coefficient sensitivity. The published chip is the team result that shows why the line of work mattered.

## What I Learned

This project sharpened a way of thinking that still feels right to me in analog design: architecture is not a block diagram. It is the first place where imperfection gets assigned.

In a noise-shaping ADC, every choice about feedback path, residue storage, capacitor ratio, amplifier reuse, and timing also decides where error is allowed to live. A behavioral model is useful only if it exposes that allocation. Otherwise it becomes a clean plot that the circuit cannot afford.

It also taught me how to write about collaborative technical work with more discipline. Name the contribution. Name the evidence. Keep the team result separate from the individual thread. That is not modesty theater; it is how the technical record stays honest.

## Source Trail

- Fall 2019 NS-SAR project folder with MATLAB scripts for MOD2, MOD3, and MOD4 NTF exploration.
- October 16, 2019 action-item note on EF NTF optimization strength and coefficient-variation sensitivity.
- MOD2-3 EFB presentation deck with pole-zero plots, SQNR sweeps, and EF/CIFF architecture comparisons.
- `Comp_MOD2-3-4.xlsx` summary table comparing simulated SQNR across OSR 4 and OSR 8.
- Simulink models for error-feedback NS-SAR variants with redundancy and dither.
- January 2021 EF-CIFF equations note connecting the architecture exploration back toward circuit-level capacitor relationships.
- ISSCC 2021 paper: "A 13.8-ENOB 0.4pF-CIN 3rd-Order Noise-Shaping SAR in a Single-Amplifier EF-CIFF Structure with Fully Dynamic Hardware-Reusing kT/C Noise Cancelation."
- IEEE JSSC 2021 article: "A 13.8-ENOB Fully Dynamic Third-Order Noise-Shaping SAR ADC in a Single-Amplifier EF-CIFF Structure With Hardware-Reusing kT/C Noise Cancellation."

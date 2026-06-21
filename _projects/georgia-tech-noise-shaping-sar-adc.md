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

This page is a reviewed project record assembled from local project notes, MATLAB/Simulink artifacts, simulation plots, spreadsheets, and the public ISSCC/JSSC paper trail. It separates the Fall 2019 behavioral-modeling work from the later published silicon result.

The behavioral work described here should not be read as a claim of individual ownership of the full published ADC chip. The connection is architectural and historical: the local modeling explored the noise-shaping SAR design space that later appears in the public third-order EF-CIFF result.

<p class="project-note"><strong>Author contribution:</strong> behavioral modeling, MATLAB/Simulink exploration, NTF/SQNR sweeps, coefficient-sensitivity analysis, and project documentation based on available local artifacts.</p>

## At a Glance

<div class="project-table">
  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th>Summary</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Project phase</td>
        <td>Fall 2019 behavioral modeling and architecture exploration, with later 2020-2021 follow-through artifacts.</td>
      </tr>
      <tr>
        <td>Technical focus</td>
        <td>Noise-shaping SAR ADC loop behavior, NTF design, OSR tradeoffs, and coefficient sensitivity.</td>
      </tr>
      <tr>
        <td>Local artifacts</td>
        <td>MATLAB scripts, Simulink models, coefficient sweeps, extracted plots, a comparison spreadsheet, handwritten action notes, and SAR circuit sketches.</td>
      </tr>
      <tr>
        <td>Contribution represented</td>
        <td>Behavioral modeling, NTF/SQNR exploration, EF/CIFF comparison, coefficient-sensitivity analysis, and documentation supported by the local project folder.</td>
      </tr>
      <tr>
        <td>Public anchor</td>
        <td>Later ISSCC/JSSC third-order EF-CIFF NS-SAR ADC result from the Georgia Tech project.</td>
      </tr>
      <tr>
        <td>Main design lesson</td>
        <td>Peak SQNR is not enough; coefficient tolerance and implementation robustness matter.</td>
      </tr>
    </tbody>
  </table>
</div>

## Glossary

<div class="project-table project-table--compact">
  <table>
    <tbody>
      <tr><th>NS-SAR</th><td>Noise-shaping successive-approximation-register ADC; a SAR ADC with feedback or integration that shapes quantization noise away from the signal band.</td></tr>
      <tr><th>OSR</th><td>Oversampling ratio; the sampling-rate margin used to reduce in-band noise after filtering.</td></tr>
      <tr><th>NTF</th><td>Noise transfer function; the transfer function that describes how quantization noise is shaped across frequency.</td></tr>
      <tr><th>SQNR</th><td>Signal-to-quantization-noise ratio; a behavioral-model metric focused on quantization noise.</td></tr>
      <tr><th>SNDR</th><td>Signal-to-noise-and-distortion ratio; a measured or simulated circuit/system metric that includes noise and distortion.</td></tr>
      <tr><th>ENOB</th><td>Effective number of bits; a resolution figure derived from converter dynamic performance.</td></tr>
      <tr><th>EF</th><td>Error feedback; a loop style that feeds conversion error through a shaping path.</td></tr>
      <tr><th>CIFF</th><td>Cascaded-integrator feed-forward; a noise-shaping loop structure often used in delta-sigma and NS-SAR contexts.</td></tr>
      <tr><th>kT/C noise</th><td>Sampling thermal noise set by temperature, Boltzmann's constant, and sampling capacitance.</td></tr>
    </tbody>
  </table>
</div>

## Design Question

SAR ADCs are efficient because much of the conversion work is dynamic and digital-like. That is also why they are attractive in scaled CMOS. The harder question is how to push them toward high resolution without paying the usual cost in large sampling capacitance, static residue amplifiers, or heavy calibration.

Noise shaping changes the bargain. Instead of leaving quantization noise spread across the Nyquist band, the converter shapes it away from the signal band. Once that becomes the goal, the architecture is no longer just a SAR loop with a clever residue path. It becomes a question of where the error goes, how aggressively the NTF can be shaped, and how sensitive the result is to the coefficients that implement it.

## Behavioral Modeling Record

The October 16, 2019 action note sets the local scope clearly: compare different error-feedback NTF implementations by optimization strength, SQNR improvement, and sensitivity to coefficient variation. The modeling loop around that note was:

- choose a second-, third-, or fourth-order NTF form;
- optimize coefficients using MATLAB search scripts;
- sweep the coefficients around the chosen value;
- plot zero movement, SQNR at OSR 4, and SQNR at OSR 8;
- compare whether the improvement was robust or just a narrow optimum.

The model set started from a second-order EF baseline and expanded into single-loop third-order EF, cascaded EF-EF, CIFF-EF, and fourth-order nested variants. The spreadsheet and deck from the project use a 9-bit behavioral quantizer assumption and compare simulated SQNR across OSR 4 and OSR 8. Those numbers were not product specifications. They were a way to ask a more architectural question: which loop structure buys useful in-band noise suppression without becoming too fragile?

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/noise-shaping-sar-adc/mod3-ef-architecture.png' | relative_url }}" alt="Behavioral third-order error-feedback noise-shaping SAR ADC loop model with delayed feedback paths and coefficients k1, k2, k3, and Kef.">
  </div>
  <figcaption><strong>Behavioral third-order EF loop model.</strong> The important point is not the exact Simulink wiring, but how the feedback coefficients control NTF-zero placement and coefficient sensitivity.</figcaption>
</figure>

In behavioral modeling, it is easy to optimize coefficients until the NTF looks excellent. In silicon, those coefficients are paid for with capacitor ratios, amplifier gain accuracy, timing margin, calibration burden, and yield. A loop that reaches high SQNR only at a narrow coefficient setting is less compelling than a slightly lower-performing loop with a wider tolerance window. The coefficient-sensitivity sweeps were useful because they turned NTF design into an implementation question.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/noise-shaping-sar-adc/mod3-ciff-ef-osr8-sensitivity.png' | relative_url }}" alt="Sensitivity sweep showing simulated SQNR versus K_EF for a third-order CIFF-EF noise-shaping SAR candidate at OSR 8, with a narrow peak near 100 dB and a 96 dB reference line.">
  </div>
  <figcaption><strong>Coefficient sensitivity at OSR 8.</strong> The peak SQNR value is less important than the width of the high-SQNR region, because a narrow optimum is harder to realize robustly in circuit implementation.</figcaption>
</figure>

## Behavioral Results

The table below uses the comparison spreadsheet as the primary numeric source. The values are behavioral SQNR sweep results, not measured ADC performance.

<!-- Evidence: Comp_MOD2-3-4.xlsx, MOD2-3 EFB.pptx slides 21-23, MATLAB Codes/MOD2_3_4 scripts/*.m -->

<div class="project-table">
  <table>
    <thead>
      <tr>
        <th>Model / architecture</th>
        <th>Loop order</th>
        <th>OSR</th>
        <th>SQNR</th>
        <th>Sensitivity / robustness note</th>
        <th>Local evidence</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Second-order EF baseline</td>
        <td>2</td>
        <td>4 / 8</td>
        <td>75.08 dB / 89.86 dB</td>
        <td>Baseline EF case used as the comparison point for higher-order variants.</td>
        <td>Coefficient-sensitivity spreadsheet; MATLAB NTF sweep</td>
      </tr>
      <tr>
        <td>Single-loop third-order EF</td>
        <td>3</td>
        <td>4 / 8</td>
        <td>77.56 dB / 96.47 dB</td>
        <td>Higher order improves the OSR 8 result, but coefficient placement remains central.</td>
        <td>Coefficient-sensitivity spreadsheet; MOD3 EF scripts</td>
      </tr>
      <tr>
        <td>Single-loop third-order EF with optimized b/c coefficients</td>
        <td>3</td>
        <td>4 / 8</td>
        <td>83.53 dB / 104.02 dB</td>
        <td>Best-supported third-order peak in the local spreadsheet; still a behavioral optimum.</td>
        <td>Coefficient-sensitivity spreadsheet; MOD2-3 EFB deck</td>
      </tr>
      <tr>
        <td>Cascaded third-order EF-EF</td>
        <td>3</td>
        <td>4 / 8</td>
        <td>81.10 dB / 102.82 dB</td>
        <td>Cascading helps in the behavioral sweep, but does not automatically dominate optimized single-loop EF.</td>
        <td>Coefficient-sensitivity spreadsheet; nested EF scripts</td>
      </tr>
      <tr>
        <td>Cascaded third-order CIFF-EF</td>
        <td>3</td>
        <td>4 / 8</td>
        <td>80.92 dB / 100.17 dB</td>
        <td>Useful for comparing feed-forward plus EF behavior, especially coefficient tolerance.</td>
        <td>Coefficient-sensitivity spreadsheet; CIFF-EF sweep plot</td>
      </tr>
      <tr>
        <td>Fourth-order cascaded 2EF-2EF</td>
        <td>4</td>
        <td>4 / 8</td>
        <td>87.70 dB / 115.23 dB</td>
        <td>Strong behavioral SQNR peak, but implementation cost and tolerance need separate circuit-level evaluation.</td>
        <td>Coefficient-sensitivity spreadsheet; MOD4 scripts</td>
      </tr>
      <tr>
        <td>Fourth-order cascaded 2CIFF-2EF</td>
        <td>4</td>
        <td>4 / 8</td>
        <td>85.66 dB / 113.58 dB</td>
        <td>High-order behavioral candidate; included as design-space exploration rather than a final implementation claim.</td>
        <td>Coefficient-sensitivity spreadsheet; MOD4 scripts</td>
      </tr>
    </tbody>
  </table>
</div>

The SQNR values in the behavioral section are architecture-comparison results focused on quantization noise. They do not include the full set of circuit-level effects that appear in measured SNDR, such as sampling thermal noise, comparator noise, capacitor mismatch, finite amplifier gain, settling error, distortion, clocking effects, or implementation leakage. They should not be compared one-to-one with the measured SNDR of the later chip.

## Later Public Result

The later public ISSCC/JSSC result reported a third-order EF-CIFF NS-SAR ADC with fully dynamic operation and hardware-reusing kT/C noise cancellation. This page uses that result as the public anchor for the project, while keeping the Fall 2019 behavioral-modeling work separate from the full silicon implementation.

The JSSC article reports a 65 nm prototype with 13.8 ENOB, 84.8 dB SNDR over 625 kHz bandwidth at OSR 8, 119 uW power, and a 182 dB Schreier FoM. The ISSCC digest title uses `0.4pF-CIN`; the later JSSC abstract and public metadata use `0.8-pF input capacitance`. This page preserves each source's wording rather than forcing a single convention.

The technical connection is the EF-CIFF/high-order NS-SAR design space, not individual ownership of every circuit, layout, measurement, or publication claim in the final chip.

## Related Work

<div class="project-table">
  <table>
    <thead>
      <tr>
        <th>Work</th>
        <th>Why it matters here</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Shaolan Li, Bo Qiao, Miguel Gandara, David Z. Pan, and Nan Sun, <a href="https://doi.org/10.1109/JSSC.2018.2871081">"A 13-ENOB Second-Order Noise-Shaping SAR ADC Realizing Optimized NTF Zeros Using the Error-Feedback Structure,"</a> IEEE JSSC, 2018.</td>
        <td>Context for EF structures and optimized NTF-zero placement; also cited directly in the local MOD2-3 EFB deck.</td>
      </tr>
      <tr>
        <td>Lu Jie, Boyi Zheng, Hsiang-Wen Chen, and Michael P. Flynn, <a href="https://doi.org/10.1109/JSSC.2020.3019487">"A Cascaded Noise-Shaping SAR Architecture for Robust Order Extension,"</a> IEEE JSSC, 2020.</td>
        <td>Context for robust higher-order noise shaping and cascaded-order extension.</td>
      </tr>
      <tr>
        <td>Tzu-Han Wang, Ruowei Wu, Vasu Gupta, Xiyuan Tang, and Shaolan Li, <a href="https://doi.org/10.1109/JSSC.2021.3108620">"A 13.8-ENOB Fully Dynamic Third-Order Noise-Shaping SAR ADC in a Single-Amplifier EF-CIFF Structure With Hardware-Reusing kT/C Noise Cancellation,"</a> IEEE JSSC, 2021.</td>
        <td>Public silicon result connected to the Georgia Tech project record.</td>
      </tr>
      <tr>
        <td>Lu Jie, Xiyuan Tang, Jiaxin Liu, Linxiao Shen, Shaolan Li, Nan Sun, and Michael P. Flynn, <a href="https://doi.org/10.1109/OJSSCS.2021.3119910">"An Overview of Noise-Shaping SAR ADC: From Fundamentals to the Frontier,"</a> IEEE OJ-SSCS, 2021.</td>
        <td>Survey context for NS-SAR fundamentals, design variations, and frontier issues.</td>
      </tr>
    </tbody>
  </table>
</div>

## Public Record

- Tzu-Han Wang, Ruowei Wu, Vasu Gupta, and Shaolan Li, <a href="https://doi.org/10.1109/ISSCC42613.2021.9365990">"27.3 A 13.8-ENOB 0.4pF-CIN 3rd-Order Noise-Shaping SAR in a Single-Amplifier EF-CIFF Structure with Fully Dynamic Hardware-Reusing kT/C Noise Cancelation,"</a> ISSCC Digest of Technical Papers, 2021.
- Tzu-Han Wang, Ruowei Wu, Vasu Gupta, Xiyuan Tang, and Shaolan Li, <a href="https://doi.org/10.1109/JSSC.2021.3108620">"A 13.8-ENOB Fully Dynamic Third-Order Noise-Shaping SAR ADC in a Single-Amplifier EF-CIFF Structure With Hardware-Reusing kT/C Noise Cancellation,"</a> IEEE Journal of Solid-State Circuits, vol. 56, no. 12, pp. 3668-3680, Dec. 2021.

## Local Project Artifacts

- Fall 2019 project folder titled `NS SAR F19`, including a dated project zip snapshot.
- October 16, 2019 action note on EF NTF optimization strength, SQNR improvement, and coefficient-variation sensitivity.
- MATLAB scripts for MOD2, MOD3, and MOD4 NTF/SQNR sweeps.
- Simulink models for EF, EF-CIFF, and digital error-feedback NS-SAR variants.
- `Comp_MOD2-3-4.xlsx` comparison spreadsheet for OSR 4 and OSR 8 behavioral SQNR results.
- MOD2-3 EFB presentation deck with pole-zero maps, coefficient-sensitivity plots, and EF/CIFF comparisons.
- SAR digital-circuit sketches for clock generation, SAR logic, CDAC switching, and related blocks.
- January 2021 EF-CIFF equations note connecting the architecture exploration back toward circuit-level capacitor relationships.

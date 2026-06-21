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
summary: A behavioral study of high-order EF/CIFF noise-shaping SAR loops, later connected to a published 13.8-ENOB third-order EF-CIFF NS-SAR ADC.
description: Georgia Tech work on high-order noise-shaping SAR ADC loops, using behavioral models, NTF-zero placement, OSR sweeps, integrated in-band quantization noise, and coefficient-sensitivity studies before the later ISSCC/JSSC team publication.
links:
  - label: IEEE JSSC paper DOI
    url: https://doi.org/10.1109/JSSC.2021.3108620
  - label: ISSCC 2021 digest DOI
    url: https://doi.org/10.1109/ISSCC42613.2021.9365990
---

The Fall 2019 NS-SAR work studied how error-feedback and CIFF-style loops shape SAR quantization error. The local models stayed at the behavioral level: choose a loop filter, place NTF zeros, integrate in-band `|NTF|^2`, and perturb the coefficients to see whether the SQNR peak survives coefficient error.

This page is assembled from local project notes, MATLAB/Simulink artifacts, plots, spreadsheets, and the public ISSCC/JSSC paper trail. It separates the Fall 2019 behavioral work from the later published silicon result. The behavioral work should not be read as a claim of individual ownership of the full ADC chip; the connection is architectural and historical.

<p class="project-note"><strong>Author contribution:</strong> behavioral modeling, MATLAB/Simulink exploration, NTF/SQNR sweeps, coefficient-sensitivity analysis, and project documentation based on available local artifacts.</p>

## Design Space Studied

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
        <td>Phase</td>
        <td>Fall 2019 behavioral modeling and architecture exploration, with later 2020-2021 follow-through artifacts.</td>
      </tr>
      <tr>
        <td>Loop problem</td>
        <td>EF and CIFF realizations of higher-order NS-SAR loops; NTF-zero placement, OSR scaling, and coefficient sensitivity.</td>
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
        <td>Later silicon result</td>
        <td>Published ISSCC/JSSC third-order EF-CIFF NS-SAR ADC from the Georgia Tech project.</td>
      </tr>
      <tr>
        <td>Design takeaway</td>
        <td>Peak SQNR alone is a weak screen; coefficient sensitivity decides whether an NTF is likely to survive implementation error.</td>
      </tr>
    </tbody>
  </table>
</div>

## Glossary

<div class="project-table project-table--compact">
  <table>
    <tbody>
      <tr><th>NS-SAR</th><td>Noise-shaping successive-approximation-register ADC; a SAR ADC that filters and reuses conversion error or residue so quantization noise is shaped out of band.</td></tr>
      <tr><th>OSR</th><td>Oversampling ratio, usually <code>fs/(2BW)</code> for a low-pass ADC.</td></tr>
      <tr><th>STF</th><td>Signal transfer function; ideally close to unity through the signal band.</td></tr>
      <tr><th>NTF</th><td>Noise transfer function; the transfer from quantization error to the ADC output.</td></tr>
      <tr><th>SQNR</th><td>Signal-to-quantization-noise ratio; a behavioral-model metric focused on quantization noise.</td></tr>
      <tr><th>SNDR</th><td>Signal-to-noise-and-distortion ratio; a measured or simulated circuit/system metric that includes noise and distortion.</td></tr>
      <tr><th>ENOB</th><td>Effective number of bits; a resolution figure derived from converter dynamic performance.</td></tr>
      <tr><th>EF</th><td>Error feedback; a loop style that filters prior quantization error and feeds it back into later conversions.</td></tr>
      <tr><th>CIFF</th><td>Cascaded-integrator feed-forward; a loop-filter topology inherited from delta-sigma modulator design.</td></tr>
      <tr><th>OBG</th><td>Out-of-band gain of the NTF; useful because aggressive in-band noise suppression usually raises out-of-band noise.</td></tr>
      <tr><th>kT/C noise</th><td>Sampling thermal noise set by temperature, Boltzmann's constant, and sampling capacitance.</td></tr>
    </tbody>
  </table>
</div>

## Loop Problem

SAR ADCs are attractive in scaled CMOS because the CDAC switching, comparison, and SAR logic are mostly dynamic. High resolution usually pushes in the other direction: larger input capacitance, lower-noise comparators, residue amplification, or calibration.

An NS-SAR tries to keep the SAR efficiency while borrowing the useful part of delta-sigma thinking. After a conversion, the residue or quantization error is not simply discarded. It is filtered through a loop filter `H(z)` and re-injected into later conversions. In the ideal EF picture, the signal sees an STF close to one, while the quantization error sees `NTF = 1 - H(z)`.

From there the design questions get concrete: where the NTF zeros sit, how much in-band quantization noise is left once you integrate the NTF over the signal band, how much out-of-band gain that costs, and how far `K_EF`, `k1`, `k2`, or `k3` can drift before the SQNR falls apart.

## Behavioral Modeling Record

The October 16, 2019 action note sets the local scope clearly: compare error-feedback NTF implementations by optimization strength, SQNR improvement, and sensitivity to coefficient variation. The MATLAB scripts and Simulink models used a 9-bit behavioral quantizer assumption and swept OSR 4 and OSR 8. The loop was:

- choose a second-, third-, or fourth-order NTF realization;
- sweep `K_EF` and, in some cases, `k1`, `k2`, and `k3`;
- compute the NTF using discrete-time transfer functions and `freqz`;
- integrate `|NTF|^2` over the in-band bins to estimate SQNR;
- plot zero movement and SQNR at OSR 4 and OSR 8;
- check whether the peak comes from a broad coefficient region or a knife-edge setting.

The model set started from a second-order EF baseline and grew into single-loop third-order EF, cascaded EF-EF, CIFF-EF, and fourth-order nested variants. None of these numbers were product specifications; they were just a way to ask whether a given loop structure buys useful in-band noise suppression without leaning on an unrealistically exact coefficient ratio.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/noise-shaping-sar-adc/mod3-ef-architecture.png' | relative_url }}" alt="Behavioral third-order error-feedback noise-shaping SAR ADC loop model with delayed feedback paths and coefficients k1, k2, k3, and Kef.">
  </div>
  <figcaption><strong>Behavioral third-order EF loop model.</strong> The Simulink model keeps the SAR/CDAC and residue path at loop level. The useful information is how <code>K_EF</code> and the numerator coefficients set the NTF zeros.</figcaption>
</figure>

On paper it is easy to keep tuning coefficients until the NTF looks excellent, but silicon is less forgiving, since those coefficients have to come out of capacitor ratios, dynamic-amplifier gain, switch timing, DAC settling, and calibration. A loop that only reaches high SQNR at one narrow coefficient setting makes a poor circuit target, so a slightly lower peak with a wider high-SQNR region is usually the better choice.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/noise-shaping-sar-adc/mod3-ciff-ef-osr8-sensitivity.png' | relative_url }}" alt="Sensitivity sweep showing simulated SQNR versus K_EF for a third-order CIFF-EF noise-shaping SAR candidate at OSR 8, with a narrow peak near 100 dB and a 96 dB reference line.">
  </div>
  <figcaption><strong>Coefficient sensitivity at OSR 8.</strong> The peak matters less than the width of the high-SQNR region. Finite coefficient error moves the NTF zeros; the sweep shows how much margin the loop has before in-band quantization noise rises.</figcaption>
</figure>

## Behavioral Results

The numbers in the table come straight from the comparison spreadsheet. They are behavioral SQNR sweep results rather than measured ADC performance, and the coefficient column lists the setting at each SQNR peak.

<!-- Evidence: Comp_MOD2-3-4.xlsx, MOD2-3 EFB.pptx slides 21-23, MATLAB Codes/MOD2_3_4 scripts/*.m -->

<div class="project-table">
  <table>
    <thead>
      <tr>
        <th>NTF realization</th>
        <th>Order</th>
        <th>OSR</th>
        <th>Peak SQNR</th>
        <th>Coefficient setting at peak</th>
        <th>Coefficient-sensitivity note</th>
        <th>Local evidence</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Second-order EF baseline</td>
        <td>2</td>
        <td>4 / 8</td>
        <td>75.08 dB / 89.86 dB</td>
        <td><code>K_EF = 1.6647 / 1.9034</code></td>
        <td><code>K_EF</code> sets the second-order NTF zero pair; this row is the EF reference case.</td>
        <td>Coefficient-sensitivity spreadsheet; MATLAB NTF sweep</td>
      </tr>
      <tr>
        <td>Single-loop third-order EF</td>
        <td>3</td>
        <td>4 / 8</td>
        <td>77.56 dB / 96.47 dB</td>
        <td><code>K_EF = 2.7012 / 2.9786</code></td>
        <td>The third-order numerator is tied mainly to <code>K_EF</code>; the OSR 8 peak rises, but zero placement remains sensitive.</td>
        <td>Coefficient-sensitivity spreadsheet; MOD3 EF scripts</td>
      </tr>
      <tr>
        <td>Single-loop third-order EF with optimized b/c coefficients</td>
        <td>3</td>
        <td>4 / 8</td>
        <td>83.53 dB / 104.02 dB</td>
        <td><code>K_EF = 2.5736 / 2.8893</code>; <code>(k2,k3) = (0.9754,0.3581) / (0.9935,0.3393)</code></td>
        <td>Best-supported third-order peak in the spreadsheet; useful because it separates NTF-zero optimization from coefficient tolerance.</td>
        <td>Coefficient-sensitivity spreadsheet; MOD2-3 EFB deck</td>
      </tr>
      <tr>
        <td>Cascaded third-order EF-EF</td>
        <td>3</td>
        <td>4 / 8</td>
        <td>81.10 dB / 102.82 dB</td>
        <td><code>(K1,K2) = (0.8974,1.5057) / (0.9838,1.8373)</code></td>
        <td>Splits the NTF into first- and second-order EF sections; order extension helps but does not automatically beat the optimized single-loop EF case.</td>
        <td>Coefficient-sensitivity spreadsheet; nested EF scripts</td>
      </tr>
      <tr>
        <td>Cascaded third-order CIFF-EF</td>
        <td>3</td>
        <td>4 / 8</td>
        <td>80.92 dB / 100.17 dB</td>
        <td><code>p = 0.8</code>; <code>K2 = 1.5265 / 1.8688</code></td>
        <td>Compares a feed-forward front section with an EF back section; the local sweep holds <code>p</code> fixed and moves the EF coefficient.</td>
        <td>Coefficient-sensitivity spreadsheet; CIFF-EF sweep plot</td>
      </tr>
      <tr>
        <td>Fourth-order cascaded 2EF-2EF</td>
        <td>4</td>
        <td>4 / 8</td>
        <td>87.70 dB / 115.23 dB</td>
        <td><code>(K1,K2) = (1.58,1.58) / (1.81,1.95)</code></td>
        <td>Strong behavioral SQNR peak; out-of-band gain, internal swing, and coefficient realization need separate circuit-level checks.</td>
        <td>Coefficient-sensitivity spreadsheet; MOD4 scripts</td>
      </tr>
      <tr>
        <td>Fourth-order cascaded 2CIFF-2EF</td>
        <td>4</td>
        <td>4 / 8</td>
        <td>85.66 dB / 113.58 dB</td>
        <td>OSR4: <code>K1 = 1.45</code>, <code>p = 0.82</code>; OSR8: <code>(K1,K2) = (1.81,1.95)</code></td>
        <td>High-order feed-forward/EF candidate; treated as design-space exploration, not as a final circuit claim.</td>
        <td>Coefficient-sensitivity spreadsheet; MOD4 scripts</td>
      </tr>
    </tbody>
  </table>
</div>

The SQNR values above are loop-level quantization-noise numbers. Measured SNDR also includes sampling thermal noise, comparator noise, capacitor mismatch, amplifier noise and nonlinearity, settling error, distortion, clock jitter, and calibration residue. The behavioral SQNR table should therefore not be compared one-to-one with the measured SNDR of the later chip.

## Published Chip

The later ISSCC/JSSC chip used a third-order single-amplifier EF-CIFF NS-SAR loop with fully dynamic operation and hardware-reused kT/C-noise cancellation. The architectural link to the Fall 2019 work is the high-order EF/CIFF NS-SAR design space; the chip result also includes circuit design, layout, calibration, measurement, and paper-writing work beyond the behavioral models summarized here.

The JSSC article reports a 65 nm prototype with 13.8 ENOB, 84.8 dB SNDR over 625 kHz bandwidth at OSR 8, 119 uW power, and a 182 dB Schreier FoM. The ISSCC digest title uses `0.4pF-CIN`; the later JSSC abstract and public metadata use `0.8-pF input capacitance`. This page preserves each source's wording rather than forcing a single convention.

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
        <td>Pradeep Shettigar and Shanthi Pavan, <a href="https://doi.org/10.1109/JSSC.2012.2217871">"Design Techniques for Wideband Single-Bit Continuous-Time Delta Sigma Modulators With FIR Feedback DACs,"</a> IEEE JSSC, 2012.</td>
        <td>Useful language for loop filters, FIR feedback, DAC timing, and the way coefficient and waveform choices show up as circuit limits.</td>
      </tr>
      <tr>
        <td>Lu Jie, Boyi Zheng, Hsiang-Wen Chen, and Michael P. Flynn, <a href="https://doi.org/10.1109/JSSC.2020.3019487">"A Cascaded Noise-Shaping SAR Architecture for Robust Order Extension,"</a> IEEE JSSC, 2020.</td>
        <td>Context for robust higher-order noise shaping and cascaded-order extension.</td>
      </tr>
      <tr>
        <td>Tzu-Han Wang, Ruowei Wu, Vasu Gupta, Xiyuan Tang, and Shaolan Li, <a href="https://doi.org/10.1109/JSSC.2021.3108620">"A 13.8-ENOB Fully Dynamic Third-Order Noise-Shaping SAR ADC in a Single-Amplifier EF-CIFF Structure With Hardware-Reusing kT/C Noise Cancellation,"</a> IEEE JSSC, 2021.</td>
        <td>Public silicon result from the same Georgia Tech NS-SAR line of work.</td>
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
- MATLAB scripts for MOD2, MOD3, and MOD4 NTF/SQNR sweeps using `freqz` and integrated in-band `|NTF|^2`.
- Simulink models for EF, EF-CIFF, and digital error-feedback NS-SAR variants.
- `Comp_MOD2-3-4.xlsx` comparison spreadsheet for OSR 4 and OSR 8 behavioral SQNR results.
- MOD2-3 EFB presentation deck with pole-zero maps, coefficient-sensitivity plots, and EF/CIFF comparisons.
- SAR digital-circuit sketches for clock generation, SAR logic, CDAC switching, and related blocks.
- January 2021 EF-CIFF equations note connecting the architecture exploration back toward circuit-level capacitor relationships.

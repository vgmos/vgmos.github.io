---
title: High-Order Noise-Shaping SAR ADC
institution: Georgia Tech
period: Fall 2019; ISSCC/JSSC 2021
role: Behavioral modeling and architecture exploration, GAMMA group (Prof. Shaolan Li)
kind: project
featured: true
topics:
  - analog design
  - data converters
  - noise shaping
  - SAR ADC
status: Study preceded the group's ISSCC/JSSC 2021 chip
date: 2021-09-09
summary: Behavioral models of high-order noise-shaping SAR ADC loops.
description: Behavioral modeling of EF and CIFF noise-shaping SAR ADC loops at Georgia Tech, covering NTF zeros, OSR sweeps, coefficient sensitivity, and the ISSCC/JSSC chip that followed.
links:
  - label: IEEE JSSC paper DOI
    url: https://doi.org/10.1109/JSSC.2021.3108620
  - label: ISSCC 2021 digest DOI
    url: https://doi.org/10.1109/ISSCC42613.2021.9365990
---

In fall 2019 I spent a semester with Prof. Shaolan Li's group at Georgia Tech modeling high-order noise-shaping SAR ADC loops. The group's NS-SAR line eventually produced a third-order EF-CIFF chip, published at ISSCC 2021 and in JSSC. The silicon was Tzu-Han Wang's and Ruowei Wu's design; my part was this earlier architecture study, so that's what this page covers. (There's a glossary at the bottom if the acronyms pile up.)

## Why noise-shape a SAR

SAR ADCs age well in scaled CMOS because almost everything in them is dynamic: CDAC switching, a comparator, some logic. The trouble starts when you want high resolution, which normally costs input capacitance, comparator noise, residue amplification, or calibration. Noise shaping borrows the delta-sigma trick instead. Rather than discarding the conversion residue, you filter it through a loop filter `H(z)` and feed it back into later conversions. The signal passes through roughly unchanged while the quantization error sees `NTF = 1 - H(z)` and gets pushed out of band.

The design questions that follow are concrete. Where should the NTF zeros sit? How much in-band noise remains once you integrate `|NTF|^2` over the signal band, and how much out-of-band gain does that cost? And the one I ended up caring about most: how far can the loop coefficients drift before the answer falls apart?

## What I modeled

I worked in MATLAB and Simulink with a 9-bit quantizer assumption, sweeping OSR 4 and OSR 8. For each candidate loop the procedure was the same:

- pick an NTF realization — second-, third-, or fourth-order, EF or CIFF style;
- sweep `K_EF` (and `k1`, `k2`, `k3` where the structure had them);
- compute the NTF with `freqz` and integrate `|NTF|^2` over the in-band bins to get SQNR;
- plot the zero movement and the SQNR curve;
- check whether the peak sits on a plateau or a knife edge.

I started from a second-order error-feedback baseline and worked upward: single-loop third-order EF, a version with optimized feed coefficients, cascaded EF-EF, CIFF-EF, and two fourth-order nested variants.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/noise-shaping-sar-adc/mod3-ef-architecture.png' | relative_url }}" alt="Behavioral third-order error-feedback noise-shaping SAR ADC loop model with delayed feedback paths and coefficients k1, k2, k3, and Kef." width="911" height="501" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>Third-order EF loop model in Simulink.</strong> The SAR/CDAC and residue path stay at loop level; what matters here is how <code>K_EF</code> and the numerator coefficients place the NTF zeros.</figcaption>
</figure>

## Sensitivity beats peak SQNR

You can tune coefficients until any NTF looks spectacular on paper. In silicon those coefficients come out of capacitor ratios, dynamic-amplifier gain, switch timing, and DAC settling, all of which move. A loop that only reaches high SQNR at one exact coefficient value makes a poor circuit target however tall its peak, and a slightly lower peak on a wide plateau is usually the better buy. That tradeoff became the main filter I applied to every candidate in the table below.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/noise-shaping-sar-adc/mod3-ciff-ef-osr8-sensitivity.png' | relative_url }}" alt="Sensitivity sweep showing simulated SQNR versus K_EF for a third-order CIFF-EF noise-shaping SAR candidate at OSR 8, with a narrow peak near 100 dB and a 96 dB reference line." width="751" height="669" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>SQNR vs. <code>K_EF</code> for a third-order CIFF-EF candidate at OSR 8.</strong> The width of the high-SQNR region matters more than the height of the peak. Coefficient error moves the NTF zeros, and the sweep shows how much margin the loop really has.</figcaption>
</figure>

## Results

Peak behavioral SQNR for each candidate, at OSR 4 / OSR 8, with the coefficient setting that produced it:

<div class="project-table">
  <table>
    <thead>
      <tr>
        <th>NTF realization</th>
        <th>Order</th>
        <th>Peak SQNR (OSR 4 / 8)</th>
        <th>Coefficients at peak</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Second-order EF baseline</td>
        <td>2</td>
        <td>75.08 dB / 89.86 dB</td>
        <td><code>K_EF = 1.6647 / 1.9034</code></td>
        <td>Reference case; <code>K_EF</code> alone sets the zero pair.</td>
      </tr>
      <tr>
        <td>Single-loop third-order EF</td>
        <td>3</td>
        <td>77.56 dB / 96.47 dB</td>
        <td><code>K_EF = 2.7012 / 2.9786</code></td>
        <td>The peak rises at OSR 8, but zero placement stays touchy.</td>
      </tr>
      <tr>
        <td>Third-order EF, optimized b/c coefficients</td>
        <td>3</td>
        <td>83.53 dB / 104.02 dB</td>
        <td><code>K_EF = 2.5736 / 2.8893</code>; <code>(k2,k3) = (0.9754,0.3581) / (0.9935,0.3393)</code></td>
        <td>Best third-order numbers; separates zero optimization from coefficient tolerance.</td>
      </tr>
      <tr>
        <td>Cascaded third-order EF-EF</td>
        <td>3</td>
        <td>81.10 dB / 102.82 dB</td>
        <td><code>(K1,K2) = (0.8974,1.5057) / (0.9838,1.8373)</code></td>
        <td>First- and second-order EF sections in cascade. Order extension alone doesn't beat the optimized single loop.</td>
      </tr>
      <tr>
        <td>Cascaded third-order CIFF-EF</td>
        <td>3</td>
        <td>80.92 dB / 100.17 dB</td>
        <td><code>p = 0.8</code>; <code>K2 = 1.5265 / 1.8688</code></td>
        <td>Feed-forward front section, EF back section; the sweep holds <code>p</code> fixed.</td>
      </tr>
      <tr>
        <td>Fourth-order cascaded 2EF-2EF</td>
        <td>4</td>
        <td>87.70 dB / 115.23 dB</td>
        <td><code>(K1,K2) = (1.58,1.58) / (1.81,1.95)</code></td>
        <td>Tallest peak, but out-of-band gain, internal swing, and coefficient realization are all still due at circuit level.</td>
      </tr>
      <tr>
        <td>Fourth-order cascaded 2CIFF-2EF</td>
        <td>4</td>
        <td>85.66 dB / 113.58 dB</td>
        <td>OSR 4: <code>K1 = 1.45</code>, <code>p = 0.82</code>; OSR 8: <code>(K1,K2) = (1.81,1.95)</code></td>
        <td>Same caveats as the row above.</td>
      </tr>
    </tbody>
  </table>
</div>

These are loop-level quantization-noise numbers. Measured SNDR carries everything else too — kT/C sampling noise, comparator noise, capacitor mismatch, settling error, jitter, calibration residue — so this table shouldn't be read against the chip's measured performance below.

## The chip

In 2021 the group published a third-order single-amplifier EF-CIFF NS-SAR, designed and measured by Tzu-Han Wang and Ruowei Wu with Xiyuan Tang and Prof. Li; I'm a co-author on the architecture side. The 65 nm prototype reached 13.8 ENOB and 84.8 dB SNDR over 625 kHz bandwidth at OSR 8 on 119 µW of power, a 182 dB Schreier figure of merit, with fully dynamic operation and a kT/C noise-cancellation scheme that reuses the loop hardware.

What the behavioral study and the silicon share is the design space. Everything that made the chip real — circuit design, layout, calibration, measurement — was work beyond these models.

- Tzu-Han Wang, Ruowei Wu, Vasu Gupta, and Shaolan Li, <a href="https://doi.org/10.1109/ISSCC42613.2021.9365990">"27.3 A 13.8-ENOB 0.4pF-C<sub>IN</sub> 3rd-Order Noise-Shaping SAR in a Single-Amplifier EF-CIFF Structure with Fully Dynamic Hardware-Reusing kT/C Noise Cancelation,"</a> ISSCC Digest of Technical Papers, 2021.
- Tzu-Han Wang, Ruowei Wu, Vasu Gupta, Xiyuan Tang, and Shaolan Li, <a href="https://doi.org/10.1109/JSSC.2021.3108620">"A 13.8-ENOB Fully Dynamic Third-Order Noise-Shaping SAR ADC in a Single-Amplifier EF-CIFF Structure With Hardware-Reusing kT/C Noise Cancellation,"</a> IEEE Journal of Solid-State Circuits, vol. 56, no. 12, pp. 3668–3680, Dec. 2021.

## Further reading

- Li, Qiao, Gandara, Pan, and Sun, <a href="https://doi.org/10.1109/JSSC.2018.2871081">"A 13-ENOB Second-Order Noise-Shaping SAR ADC Realizing Optimized NTF Zeros Using the Error-Feedback Structure,"</a> IEEE JSSC, 2018 — the EF starting point for this study.
- Jie, Zheng, Chen, and Flynn, <a href="https://doi.org/10.1109/JSSC.2020.3019487">"A Cascaded Noise-Shaping SAR Architecture for Robust Order Extension,"</a> IEEE JSSC, 2020 — cascading as a route to robust higher order.
- Shettigar and Pavan, <a href="https://doi.org/10.1109/JSSC.2012.2217871">"Design Techniques for Wideband Single-Bit Continuous-Time Delta Sigma Modulators With FIR Feedback DACs,"</a> IEEE JSSC, 2012 — loop-filter design language from the continuous-time delta-sigma world.
- Jie, Tang, Liu, Shen, Li, Sun, and Flynn, <a href="https://doi.org/10.1109/OJSSCS.2021.3119910">"An Overview of Noise-Shaping SAR ADC: From Fundamentals to the Frontier,"</a> IEEE OJ-SSCS, 2021 — the survey, if you want the full landscape.

## Glossary

<div class="project-table project-table--compact">
  <table>
    <tbody>
      <tr><th>NS-SAR</th><td>Noise-shaping successive-approximation-register ADC; a SAR ADC that filters and reuses conversion error or residue so quantization noise is shaped out of band.</td></tr>
      <tr><th>OSR</th><td>Oversampling ratio, usually <code>fs/(2BW)</code> for a low-pass ADC.</td></tr>
      <tr><th>STF</th><td>Signal transfer function; ideally close to unity through the signal band.</td></tr>
      <tr><th>NTF</th><td>Noise transfer function; the transfer from quantization error to the ADC output.</td></tr>
      <tr><th>SQNR</th><td>Signal-to-quantization-noise ratio; a behavioral-model metric that counts only quantization noise.</td></tr>
      <tr><th>SNDR</th><td>Signal-to-noise-and-distortion ratio; a measured metric that includes noise and distortion.</td></tr>
      <tr><th>ENOB</th><td>Effective number of bits, derived from converter dynamic performance.</td></tr>
      <tr><th>EF</th><td>Error feedback; a loop style that filters prior quantization error and feeds it back into later conversions.</td></tr>
      <tr><th>CIFF</th><td>Cascaded-integrator feed-forward; a loop-filter topology inherited from delta-sigma design.</td></tr>
      <tr><th>OBG</th><td>Out-of-band gain of the NTF. Aggressive in-band suppression usually raises it.</td></tr>
      <tr><th>kT/C noise</th><td>Sampling thermal noise set by temperature, Boltzmann's constant, and sampling capacitance.</td></tr>
    </tbody>
  </table>
</div>

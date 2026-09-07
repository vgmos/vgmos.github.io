---
title: High-Order Noise-Shaping SAR ADC
institution: Georgia Tech
period: Fall 2019
publication: ISSCC/JSSC 2021
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
summary: Reusing conversion residue to improve resolution, and testing how sensitive the loop is to coefficient error.
description: Behavioral modeling of EF and CIFF noise-shaping SAR ADC loops at Georgia Tech, covering NTF zeros, OSR sweeps, coefficient sensitivity, and the ISSCC/JSSC chip that followed.
---

In fall 2019, I modeled noise-shaping SAR ADC loops with Prof. Shaolan Li's group at Georgia Tech. My work was an architecture study; the later chip was designed and measured by Tzu-Han Wang and Ruowei Wu.

## Why noise-shape a SAR

At the end of a SAR conversion, the capacitive DAC (CDAC) holds a small voltage difference between the sampled input and the final DAC level. This is the conversion residue. A conventional SAR discards it when the next sample arrives. A noise-shaping SAR stores and filters it, then uses it to influence later conversions. The existing CDAC makes that error available without a separate precision subtractor. [Jie et al., 2021](https://doi.org/10.1109/OJSSCS.2021.3119910)

An ideal first-order example makes the benefit visible: the output error becomes <code class="equation-inline">e[n] − e[n−1]</code>, where `e[n]` is the quantizer error on sample `n`. Averaging successive outputs cancels the intermediate error terms. In frequency terms, the error is suppressed near DC and increased at high frequencies. A digital low-pass filter removes the out-of-band noise before the sample rate is reduced.

For the error-feedback (EF) convention used here, the noise transfer function is <code class="equation-inline">NTF(z) = 1 − H(z)</code>, with the sample delays included in `H(z)`. Setting `H(z) = z⁻¹` gives the first-order example above. Higher-order filters offer more freedom to place NTF zeros. Zeros on the unit circle create notches in the modeled quantization-noise spectrum. The signal transfer remains ideally unity.

My study asked how to use that freedom: reduce the total in-band quantization noise while keeping out-of-band gain and coefficient sensitivity manageable. Higher order helps only if the required gains, timing, and internal signal swings can be realized.

## What I modeled

I worked in MATLAB and Simulink with a 9-bit quantizer assumption, sweeping oversampling ratios (OSRs) of 4 and 8. For a low-pass converter, `OSR = fs/(2BW)`: increasing OSR gives more samples per unit signal bandwidth, at the cost of a faster sample rate or narrower bandwidth. For each candidate loop the procedure was the same:

- pick an NTF realization — second-, third-, or fourth-order, EF or CIFF style;
- sweep `K_EF` (and `k1`, `k2`, `k3` where the structure had them);
- compute the NTF with `freqz`, integrate the shaped quantization-noise power over the signal band, and compare it with signal power to estimate SQNR;
- plot the zero movement and the SQNR curve;
- check whether high SQNR persists across a useful range of coefficients.

This frequency-domain estimate uses the additive quantization-noise model: the NTF weights the assumed noise spectrum by `|NTF|^2`. It does not by itself test overload or nonlinear loop behavior.

I started from a second-order error-feedback baseline and worked upward: single-loop third-order EF, a version with optimized feed coefficients, cascaded EF-EF, CIFF-EF, and two fourth-order nested variants.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/noise-shaping-sar-adc/mod3-ef-architecture.png' | relative_url }}" alt="Behavioral third-order error-feedback noise-shaping SAR ADC loop model with delayed feedback paths and coefficients k1, k2, k3, and Kef." width="911" height="501" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>Third-order EF loop model in Simulink.</strong> The SAR/CDAC and residue path stay at loop level; what matters here is how <code>K_EF</code> and the numerator coefficients place the NTF zeros.</figcaption>
</figure>

## Sensitivity beats peak SQNR

Peak SQNR alone was not enough to choose a loop. In silicon, the coefficients depend on capacitor ratios, dynamic-amplifier gain, switch timing, and DAC settling. Each varies. I preferred a loop that maintained high SQNR across a range of coefficients to one with a higher but narrow peak.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/noise-shaping-sar-adc/mod3-ciff-ef-osr8-sensitivity.png' | relative_url }}" alt="Sensitivity sweep showing simulated SQNR versus K_EF for a third-order CIFF-EF noise-shaping SAR candidate at OSR 8, with a narrow peak near 100 dB and a 96 dB reference line." width="751" height="669" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>SQNR vs. <code>K_EF</code> for a third-order CIFF-EF candidate at OSR 8.</strong> The width of the high-SQNR region matters more than the height of the peak. Coefficient error moves the NTF zeros, and the sweep shows how much margin the loop really has.</figcaption>
</figure>

## Results

Peak behavioral SQNR for each candidate, at OSR 4 / OSR 8, with the coefficient setting that produced it:

<p class="project-table__hint" id="results-table-hint">Scroll horizontally to compare every column →</p>
<div class="project-table" role="region" tabindex="0" aria-label="Noise-shaping candidate results" aria-describedby="results-table-hint">
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
        <td>The peak rises at OSR 8, but zero placement remains sensitive to coefficient error.</td>
      </tr>
      <tr>
        <td>Third-order EF, optimized b/c coefficients</td>
        <td>3</td>
        <td>83.53 dB / 104.02 dB</td>
        <td><code>K_EF = 2.5736 / 2.8893</code>; <code>(k2,k3) = (0.9754,0.3581) / (0.9935,0.3393)</code></td>
        <td>Highest third-order SQNR; separates zero optimization from coefficient tolerance.</td>
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
        <td>Highest peak SQNR; out-of-band gain, internal swing, and coefficient realization still require circuit-level evaluation.</td>
      </tr>
      <tr>
        <td>Fourth-order cascaded 2CIFF-2EF</td>
        <td>4</td>
        <td>85.66 dB / 113.58 dB</td>
        <td>OSR 4: <code>K1 = 1.45</code>, <code>p = 0.82</code>; OSR 8: <code>K1 = 1.8117, p = 0.9618</code></td>
        <td>Same caveats as the row above.</td>
      </tr>
    </tbody>
  </table>
</div>

These are loop-level quantization-noise results. A chip's signal-to-noise-and-distortion ratio (SNDR) also reflects sampling and circuit noise, capacitor mismatch, settling error, jitter, and residual calibration error. Each error enters the loop at a different point and need not see the quantization-noise NTF. The table is therefore not directly comparable with the measured chip performance below.

## The chip

In 2021 the group published a third-order single-amplifier EF-CIFF NS-SAR, designed and measured by Tzu-Han Wang and Ruowei Wu with Xiyuan Tang and Prof. Li; I'm a co-author on the architecture side. The 65 nm prototype reached 13.8 ENOB and 84.8 dB SNDR over 625 kHz bandwidth at OSR 8 on 119 µW of power, a 182 dB Schreier figure of merit, with fully dynamic operation and a kT/C noise-cancellation scheme that reuses the loop hardware.

- Tzu-Han Wang, Ruowei Wu, Vasu Gupta, and Shaolan Li, <a href="https://doi.org/10.1109/ISSCC42613.2021.9365990">"27.3 A 13.8-ENOB 0.4pF-C<sub>IN</sub> 3rd-Order Noise-Shaping SAR in a Single-Amplifier EF-CIFF Structure with Fully Dynamic Hardware-Reusing kT/C Noise Cancelation,"</a> ISSCC Digest of Technical Papers, 2021.
- Tzu-Han Wang, Ruowei Wu, Vasu Gupta, Xiyuan Tang, and Shaolan Li, <a href="https://doi.org/10.1109/JSSC.2021.3108620">"A 13.8-ENOB Fully Dynamic Third-Order Noise-Shaping SAR ADC in a Single-Amplifier EF-CIFF Structure With Hardware-Reusing kT/C Noise Cancellation,"</a> IEEE Journal of Solid-State Circuits, vol. 56, no. 12, pp. 3668–3680, Dec. 2021.

## Further reading

- Li, Qiao, Gandara, Pan, and Sun, <a href="https://doi.org/10.1109/JSSC.2018.2871081">"A 13-ENOB Second-Order Noise-Shaping SAR ADC Realizing Optimized NTF Zeros Using the Error-Feedback Structure,"</a> IEEE JSSC, 2018 — the EF starting point for this study.
- Jie, Zheng, Chen, and Flynn, <a href="https://doi.org/10.1109/JSSC.2020.3019487">"A Cascaded Noise-Shaping SAR Architecture for Robust Order Extension,"</a> IEEE JSSC, 2020 — cascading as a route to robust higher order.
- Shettigar and Pavan, <a href="https://doi.org/10.1109/JSSC.2012.2217871">"Design Techniques for Wideband Single-Bit Continuous-Time Delta Sigma Modulators With FIR Feedback DACs,"</a> IEEE JSSC, 2012 — loop-filter design language from the continuous-time delta-sigma world.
- Jie, Tang, Liu, Shen, Li, Sun, and Flynn, <a href="https://doi.org/10.1109/OJSSCS.2021.3119910">"An Overview of Noise-Shaping SAR ADC: From Fundamentals to the Frontier,"</a> IEEE OJ-SSCS, 2021 — a survey of the architecture and its development.

## Glossary

<p class="project-table__hint" id="glossary-table-hint">Scroll horizontally to read each definition →</p>
<div class="project-table project-table--compact" role="region" tabindex="0" aria-label="Noise-shaping glossary" aria-describedby="glossary-table-hint">
  <table>
    <tbody>
      <tr><th>NS-SAR</th><td>Noise-shaping successive-approximation-register ADC; a SAR ADC that filters and reuses conversion error or residue so quantization noise is shaped out of band.</td></tr>
      <tr><th>OSR</th><td>Oversampling ratio, usually <code>fs/(2BW)</code> for a low-pass ADC.</td></tr>
      <tr><th>STF</th><td>Signal transfer function; ideally close to unity through the signal band.</td></tr>
      <tr><th>NTF</th><td>Noise transfer function; the transfer from quantization error to the ADC output.</td></tr>
      <tr><th>SQNR</th><td>Signal-to-quantization-noise ratio; a behavioral-model metric that counts only quantization noise.</td></tr>
      <tr><th>SNDR</th><td>Signal-to-noise-and-distortion ratio; includes noise and distortion, whether evaluated in simulation or measurement.</td></tr>
      <tr><th>ENOB</th><td>Effective number of bits, derived from converter dynamic performance.</td></tr>
      <tr><th>EF</th><td>Error feedback; a loop style that filters prior quantization error and feeds it back into later conversions.</td></tr>
      <tr><th>CIFF</th><td>Cascaded-integrator feed-forward; a loop-filter topology inherited from delta-sigma design.</td></tr>
      <tr><th>OBG</th><td>Out-of-band gain of the NTF. Aggressive in-band suppression usually raises it.</td></tr>
      <tr><th>kT/C noise</th><td>Sampling thermal noise set by temperature, Boltzmann's constant, and sampling capacitance.</td></tr>
    </tbody>
  </table>
</div>

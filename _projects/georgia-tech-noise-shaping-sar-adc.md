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
summary: Reusing a SAR ADC's leftover conversion residue to push quantization noise out of band — and why coefficient margin beats peak SQNR.
description: Behavioral modeling of EF and CIFF noise-shaping SAR ADC loops at Georgia Tech, covering residue reuse, NTF zero placement, OBG sensitivity tradeoffs, and the ISSCC/JSSC chip that followed.
---

In fall 2019, I worked with Prof. Shaolan Li's GAMMA group at Georgia Tech to explore high-order noise-shaping SAR ADC loop architectures. My role was the behavioral architecture study; the 65 nm silicon prototype that followed was designed and measured by Tzu-Han Wang and Ruowei Wu.

## Why noise-shape a SAR

A conventional successive-approximation-register (SAR) ADC earns its power efficiency by avoiding static operational amplifiers — its core consists of a capacitive DAC (CDAC), switches, digital logic, and a dynamic comparator. Push a plain SAR past roughly 10–12 bits, however, and two physical walls close in together: each extra bit doubles a binary-weighted CDAC's complexity, and once thermal noise dominates, halving both <span class="math-inline"><var>kT</var>/<var>C</var></span> sampling noise and comparator input-referred noise demands roughly 4× the sampling capacitance and 4× the comparator power for every 6 dB of resolution.

A noise-shaping SAR (NS-SAR) sidesteps that scaling wall by keeping what the CDAC already computes. Once the binary search finishes, the voltage still sitting on the CDAC top plate is the exact **conversion residue** — the difference between the sampled input and the final DAC code. A conventional SAR resets the array and discards that charge. An NS-SAR instead extracts, filters, and injects that residue into subsequent conversions, reusing the CDAC itself as the error subtractor without a separate precision summing stage ([Jie et al., 2021](https://doi.org/10.1109/OJSSCS.2021.3119910)).

A first-order example reveals the mechanism immediately. Suppose sample <span class="math-inline"><var>n</var> − 1</span> rounds *up* by a quantization error <span class="math-inline"><var>e</var>[<var>n</var> − 1]</span>. The leftover CDAC residue (<span class="math-inline">−<var>e</var>[<var>n</var> − 1]</span>) carries that exact shortfall; adding it into the next conversion nudges sample <var>n</var> *down* by the same amount, turning the output quantization error into <span class="math-inline"><var>e</var>[<var>n</var>] − <var>e</var>[<var>n</var> − 1]</span>. Across slow, in-band signals, successive errors largely cancel, pushing quantization-noise power toward high frequencies where a digital low-pass filter strips it away before decimation.

In the z-domain, an error-feedback (EF) loop shapes quantization error by <span class="math-inline">NTF(<var>z</var>) = 1 − <var>H</var>(<var>z</var>)</span> (with unit delays inside <span class="math-inline"><var>H</var>(<var>z</var>)</span>, so <span class="math-inline"><var>H</var>(<var>z</var>) = <var>z</var><sup>−1</sup></span> reproduces the first-order difference above) while keeping the signal transfer function ideally unity. Higher-order filters introduce additional NTF zeros: rather than stacking every zero at DC (<span class="math-inline"><var>z</var> = 1</span>), spreading a complex-conjugate pair slightly off DC along the unit circle carves a mid-band notch and lowers integrated in-band noise further.

## What I modeled

The architectural question was how far to push loop order before analog imperfections erase the gain. Aggressive in-band suppression is never free: by the Bode sensitivity integral (the waterbed effect), digging a deeper in-band notch lifts the NTF's **out-of-band gain (OBG)** at high frequencies. Higher OBG enlarges internal residue swings, eats into quantizer headroom, and makes zero locations far more sensitive to coefficient drift.

To map that tradeoff systematically, I modeled a 9-bit SAR quantizer in MATLAB and Simulink at oversampling ratios of 4 and 8 (<span class="math-inline">OSR = <var>f</var><sub>s</sub>/(2&thinsp;BW)</span> — higher OSR gives the filter more spectral room to push noise into, at the expense of faster clocking or narrower bandwidth). For each candidate topology, I ran the same evaluation:

- form the NTF realization — second-, third-, or fourth-order, using error-feedback (EF) loops, cascaded-integrator feed-forward (CIFF) stages, or hybrid cascades of both;
- sweep the error-feedback gain <var>K</var><sub>EF</sub> (and tap weights <var>k</var><sub>1</sub>, <var>k</var><sub>2</sub>, <var>k</var><sub>3</sub> where present);
- evaluate the NTF with `freqz`, integrate the <span class="math-inline">|NTF|<sup>2</sup></span>-weighted quantization noise across the signal band, and compute SQNR;
- track how NTF zeros migrate under coefficient perturbations to measure the width of the high-SQNR plateau.

This frequency-domain model isolates quantization-noise shaping and coefficient sensitivity before committing to time-domain overload and circuit-noise simulations. Starting from a second-order EF baseline, I swept upward through single-loop third-order EF, an optimized-zero third-order EF, cascaded EF–EF and CIFF–EF loops (pairing a feed-forward integrator front end with an EF back end), and two fourth-order nested cascades.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/noise-shaping-sar-adc/mod3-ef-architecture.png' | relative_url }}" alt="Behavioral third-order error-feedback noise-shaping SAR ADC loop model with delayed feedback paths and coefficients k1, k2, k3, and Kef." width="911" height="501" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>Third-order EF loop model in Simulink.</strong> The SAR quantizer and residue extraction remain abstracted at loop level so the analysis stays focused on how <var>K</var><sub>EF</sub> and the delayed feedback taps (<var>k</var><sub>1</sub>, <var>k</var><sub>2</sub>, <var>k</var><sub>3</sub>) place the NTF zeros.</figcaption>
</figure>

## Why sensitivity beats peak SQNR

In MATLAB, a sharp SQNR spike looks inviting. In silicon, however, those loop coefficients are realized by capacitor ratios, open-loop dynamic-amplifier gain, switch timing, and incomplete settling — none of which hold constant across process, voltage, and temperature. If a few-percent drift in <var>K</var><sub>EF</sub> pulls an NTF zero off the unit circle or shifts the notch out of band, a narrow peak collapses before it reaches the bench. I therefore favored topologies that sustained high SQNR across a wide <var>K</var><sub>EF</sub> window over brittle designs that won at a single point.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/noise-shaping-sar-adc/mod3-ciff-ef-osr8-sensitivity.png' | relative_url }}" alt="Sensitivity sweep showing simulated SQNR versus K_EF for a third-order CIFF-EF noise-shaping SAR candidate at OSR 8, with a narrow peak near 100 dB and a 96 dB reference line." width="751" height="669" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>SQNR vs. <var>K</var><sub>EF</sub> for a third-order CIFF–EF candidate at OSR 8.</strong> Peak SQNR reaches ~100.2 dB at <span class="math-inline"><var>K</var><sub>EF</sub> = 1.87</span> (4 dB above the 96 dB target), yet drops below 96 dB once <var>K</var><sub>EF</sub> nears 1.99 — illustrating why plateau width matters more than peak height.</figcaption>
</figure>

## Results

Peak behavioral SQNR for each candidate at OSR 4 / OSR 8, along with the coefficient settings at peak:

<p class="project-table__hint" id="results-table-hint">Scroll horizontally to compare every column →</p>
<div class="project-table project-table--results" role="region" tabindex="0" aria-label="Noise-shaping candidate results" aria-describedby="results-table-hint">
  <table>
    <thead>
      <tr>
        <th scope="col">NTF realization</th>
        <th scope="col">Order</th>
        <th scope="col">Peak SQNR (OSR 4 / 8)</th>
        <th scope="col">Coefficients at peak</th>
        <th scope="col">Notes</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Second-order EF baseline</td>
        <td>2</td>
        <td>75.08 / 89.86 dB</td>
        <td><var>K</var><sub>EF</sub> = 1.6647 / 1.9034</td>
        <td>Reference case; <var>K</var><sub>EF</sub> alone sets the zero pair.</td>
      </tr>
      <tr>
        <td>Single-loop third-order EF</td>
        <td>3</td>
        <td>77.56 / 96.47 dB</td>
        <td><var>K</var><sub>EF</sub> = 2.7012 / 2.9786</td>
        <td>Peak SQNR rises at OSR 8, but zero placement stays sensitive to gain error.</td>
      </tr>
      <tr>
        <td>Third-order EF, optimized <var>k</var><sub>2</sub>/<var>k</var><sub>3</sub> weights</td>
        <td>3</td>
        <td>83.53 / 104.02 dB</td>
        <td><var>K</var><sub>EF</sub> = 2.5736 / 2.8893; (<var>k</var><sub>2</sub>, <var>k</var><sub>3</sub>) = (0.9754, 0.3581) / (0.9935, 0.3393)</td>
        <td>Highest third-order SQNR; separates optimal zero placement from coefficient tolerance.</td>
      </tr>
      <tr>
        <td>Cascaded third-order EF–EF</td>
        <td>3</td>
        <td>81.10 / 102.82 dB</td>
        <td>(<var>K</var><sub>1</sub>, <var>K</var><sub>2</sub>) = (0.8974, 1.5057) / (0.9838, 1.8373)</td>
        <td>First- and second-order EF sections in cascade; order extension alone does not beat the optimized single loop.</td>
      </tr>
      <tr>
        <td>Cascaded third-order CIFF–EF</td>
        <td>3</td>
        <td>80.92 / 100.17 dB</td>
        <td><var>p</var> = 0.8; <var>K</var><sub>2</sub> = 1.5265 / 1.8688</td>
        <td>Feed-forward front section (fixed integrator pole <var>p</var> = 0.8) feeding an EF back section.</td>
      </tr>
      <tr>
        <td>Fourth-order cascaded 2EF–2EF</td>
        <td>4</td>
        <td>87.70 / 115.23 dB</td>
        <td>(<var>K</var><sub>1</sub>, <var>K</var><sub>2</sub>) = (1.58, 1.58) / (1.81, 1.95)</td>
        <td>Highest peak SQNR; OBG, internal swing, and coefficient realization still demand circuit-level verification.</td>
      </tr>
      <tr>
        <td>Fourth-order cascaded 2CIFF–2EF</td>
        <td>4</td>
        <td>85.66 / 113.58 dB</td>
        <td>OSR 4: <var>K</var><sub>1</sub> = 1.45, <var>p</var> = 0.82; OSR 8: <var>K</var><sub>1</sub> = 1.8117, <var>p</var> = 0.9618</td>
        <td>Highest-order hybrid cascade; subject to the same OBG, swing, and circuit-realization caveats.</td>
      </tr>
    </tbody>
  </table>
</div>

Because these numbers count quantization noise alone, they mark an architectural ceiling rather than measured chip SNDR. In silicon, sampling <span class="math-inline"><var>kT</var>/<var>C</var></span> noise, comparator and amplifier thermal noise, capacitor mismatch, clock jitter, and settling error enter at distinct nodes — and input-referred sampling noise passes through the unity signal transfer function rather than the quantization NTF, setting the practical noise floor once quantization noise drops beneath it.

## The chip that followed

In 2021, Tzu-Han Wang and Ruowei Wu (with Xiyuan Tang, Prof. Li, and myself as co-author on the architecture side) published a 65 nm third-order EF–CIFF NS-SAR built around a single shared dynamic amplifier. Sharing that amplifier across the hybrid EF–CIFF filter — and reusing the same hardware to cancel sampling <span class="math-inline"><var>kT</var>/<var>C</var></span> noise despite a compact 0.4 pF input capacitor — kept total power to 119 µW while achieving 13.8 ENOB and 84.8 dB SNDR over 625 kHz bandwidth at OSR 8 (a 182 dB Schreier figure of merit).

- Tzu-Han Wang, Ruowei Wu, Vasu Gupta, and Shaolan Li, <a href="https://doi.org/10.1109/ISSCC42613.2021.9365990">"27.3 A 13.8-ENOB 0.4pF-C<sub>IN</sub> 3rd-Order Noise-Shaping SAR in a Single-Amplifier EF-CIFF Structure with Fully Dynamic Hardware-Reusing kT/C Noise Cancelation,"</a> ISSCC Digest of Technical Papers, 2021.
- Tzu-Han Wang, Ruowei Wu, Vasu Gupta, Xiyuan Tang, and Shaolan Li, <a href="https://doi.org/10.1109/JSSC.2021.3108620">"A 13.8-ENOB Fully Dynamic Third-Order Noise-Shaping SAR ADC in a Single-Amplifier EF-CIFF Structure With Hardware-Reusing kT/C Noise Cancellation,"</a> IEEE Journal of Solid-State Circuits, vol. 56, no. 12, pp. 3668–3680, Dec. 2021.

## Further reading

- Li, Qiao, Gandara, Pan, and Sun, <a href="https://doi.org/10.1109/JSSC.2018.2871081">"A 13-ENOB Second-Order Noise-Shaping SAR ADC Realizing Optimized NTF Zeros Using the Error-Feedback Structure,"</a> IEEE JSSC, 2018 — the EF starting point for this study.
- Jie, Zheng, Chen, and Flynn, <a href="https://doi.org/10.1109/JSSC.2020.3019487">"A Cascaded Noise-Shaping SAR Architecture for Robust Order Extension,"</a> IEEE JSSC, 2020 — cascading as a route to robust higher order.
- Shettigar and Pavan, <a href="https://doi.org/10.1109/JSSC.2012.2217871">"Design Techniques for Wideband Single-Bit Continuous-Time Delta Sigma Modulators With FIR Feedback DACs,"</a> IEEE JSSC, 2012 — loop-filter design language from the continuous-time delta-sigma world.
- Jie, Tang, Liu, Shen, Li, Sun, and Flynn, <a href="https://doi.org/10.1109/OJSSCS.2021.3119910">"An Overview of Noise-Shaping SAR ADC: From Fundamentals to the Frontier,"</a> IEEE OJ-SSCS, 2021 — a survey of the architecture and its development.

## Glossary

<dl class="glossary-list" aria-label="Noise-shaping glossary">
  <div class="glossary-list__item"><dt>NS-SAR</dt><dd>Noise-shaping successive-approximation-register ADC; a SAR ADC that filters and reuses conversion residue to push quantization noise out of band.</dd></div>
  <div class="glossary-list__item"><dt>OSR</dt><dd>Oversampling ratio, <span class="math-inline"><var>f</var><sub>s</sub>/(2&thinsp;BW)</span> for a low-pass converter.</dd></div>
  <div class="glossary-list__item"><dt>STF</dt><dd>Signal transfer function; ideally close to unity across the signal band.</dd></div>
  <div class="glossary-list__item"><dt>NTF</dt><dd>Noise transfer function; the transfer from quantization error to the ADC output.</dd></div>
  <div class="glossary-list__item"><dt>SQNR</dt><dd>Signal-to-quantization-noise ratio; a behavioral metric counting quantization noise alone.</dd></div>
  <div class="glossary-list__item"><dt>SNDR</dt><dd>Signal-to-noise-and-distortion ratio; includes thermal noise, quantization noise, and harmonic distortion.</dd></div>
  <div class="glossary-list__item"><dt>ENOB</dt><dd>Effective number of bits, derived from SNDR as <span class="math-inline">(SNDR − 1.76)/6.02</span>.</dd></div>
  <div class="glossary-list__item"><dt>EF</dt><dd>Error feedback; a loop structure that filters prior conversion residue and feeds it directly into subsequent conversions.</dd></div>
  <div class="glossary-list__item"><dt>CIFF</dt><dd>Cascaded-integrator feed-forward; a loop-filter topology inherited from delta-sigma modulators.</dd></div>
  <div class="glossary-list__item"><dt>OBG</dt><dd>Out-of-band gain of the NTF; digging a deeper in-band notch generally raises OBG, swelling internal swings and tightening coefficient margin.</dd></div>
  <div class="glossary-list__item"><dt><span class="math-inline"><var>kT</var>/<var>C</var></span> noise</dt><dd>Sampling thermal noise set by absolute temperature, Boltzmann's constant, and sampling capacitance.</dd></div>
</dl>

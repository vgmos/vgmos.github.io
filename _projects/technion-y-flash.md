---
title: Y-Flash Device Modeling and Trainable DAC
institution: Technion
period: 2018–2020
publication: Nature Electronics 2019, DATE 2020
role: Device modeling, Verilog-A, and the trainable-DAC study
kind: project
featured: true
topics:
  - neuromorphic circuits
  - floating-gate devices
  - Verilog-A
  - trainable DACs
  - CAD modeling
status: DATE 2020 paper; device published in Nature Electronics 2019
date: 2020-03-01
summary: Modeling how floating-gate charge tunes subthreshold conductance, then training an array of those weights to calibrate a 4-bit DAC.
description: Y-Flash floating-gate memristive device modeling with the Technion ASIC2 group, including Verilog-A CAD infrastructure, small-signal analysis, and a trainable 4-bit DAC architecture.
---

My BITS undergraduate thesis grew into a two-year collaboration with the ASIC<sup>2</sup> group at the Technion, focused on turning a single-poly floating-gate memory cell into a device circuit designers could simulate and build with: a Verilog-A compact model for Cadence, MATLAB fitting and training scripts, small-signal analysis, and a trainable-DAC architecture study.

## How a floating gate stores an analog weight

A Y-Flash cell pairs two NMOS transistors in a standard 180 nm CMOS process — requiring no extra process masks — around one shared, electrically isolated polysilicon **floating gate**: an injection transistor for charge transfer and a readout transistor for sensing ([Danial et al., 2019](https://doi.org/10.1038/s41928-019-0331-1)). Applying a high positive program pulse (~5 V) injects hot electrons onto the floating gate, screening the readout channel, raising its effective threshold voltage <var>V</var><sub>th</sub>, and throttling readout current; applying an erase pulse (~8 V) drives band-to-band tunneling hot-hole injection to neutralize that charge, lowering <var>V</var><sub>th</sub> and restoring current. Because oxide insulates the floating gate completely, the stored analog state persists once the pulse ends.

Readout operates at a lower bias in **subthreshold**, where drain current varies exponentially with threshold voltage while keeping static current in the nanoamp-to-microamp range. Because the floating gate couples capacitively to the read terminal, the large-signal <var>I</var>–<var>V</var> curve bends steeply upward with bias; yet perturbing the terminal slightly around a fixed operating point produces a linear incremental response, <span class="math-inline">Δ<var>I</var> ≈ <var>g</var><sub>read</sub>&thinsp;Δ<var>V</var></span>, whose local slope <var>g</var><sub>read</sub> is tuned directly by the stored charge. Below frequencies where floating-gate and junction capacitances begin to shunt the channel, the cell behaves to first order as a nonvolatile, programmable incremental conductance ([Danial et al., DATE 2020](https://doi.org/10.23919/DATE48585.2020.9116354)).

Designing real circuits around Y-Flash therefore requires a compact model that unifies both regimes — high-voltage charge dynamics and low-voltage subthreshold conduction — alongside device-to-device variation and neighbor disturbances.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/y-flash/y-flash-iv-hysteresis.png' | relative_url }}" alt="Y-Flash memristive I-V simulation showing asymmetric hysteresis across drain-source voltage." width="1920" height="656" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>Model-generated Y-Flash <var>I</var>–<var>V</var> behavior.</strong> Effective threshold voltage serves as the internal state variable; each stored state yields an asymmetric nonlinear read curve whose local slope sets the incremental conductance <var>g</var><sub>read</sub>. See <a href="https://asic2.group/wp-content/uploads/2021/02/Y-flash-manual-1.pdf#page=5">Gupta et al., model manual, Fig. 8</a>.</figcaption>
</figure>

## Bringing the device into Cadence

The centerpiece of my work was the **Verilog-A compact model**, which let analog designers drop Y-Flash directly into Cadence Virtuoso schematics alongside standard CMOS transistors. Driven with 50%-duty, 20 µs pulses, the deterministic model resolves more than 650 continuous resistance states — a bound on numerical granularity rather than hardware noise margin, since the *Nature Electronics* device paper demonstrates 65 experimentally distinguishable resistive states. The modeling suite covers:

- program and erase dynamics fitted to measured Y-Flash switching data;
- a subthreshold read equation mapping stored floating-gate threshold voltage to readout current;
- a Cadence Virtuoso Verilog-A implementation exposing coupling ratio, initial threshold voltage, programming constants, read-current scaling, and timestep resolution;
- a stochastic extension for Monte Carlo variation studies;
- small-signal equivalent circuits delineating the voltage and frequency boundaries where the device acts as a passive incremental resistance.

The DATE 2020 paper integrates this model into a full top-down CAD flow spanning schematic simulation, Monte Carlo variation, layout, DRC/LVS, and parasitic extraction.

## Training a 4-bit DAC instead of matching it

Conventional binary-weighted DACs earn sub-0.5 LSB linearity through large silicon area, common-centroid layout, and factory trim. In a follow-on study inspired by [DIDACTIC](https://doi.org/10.1109/JETCAS.2017.2780251), I explored inverting that tradeoff: begin with an imperfectly matched array of analog weights and *train* their states in situ until the output staircase locks onto the target codes. My earlier study used a VTEAM model fitted to an HfO<sub>x</sub> memristor in a 2T1R synapse; moving to Y-Flash introduced a distinct circuit constraint — living with asymmetric program/erase voltages and a fixed read bias.

<figure class="source-figure">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/y-flash/y-flash-dac.png' | relative_url }}" alt="Y-Flash based 4-bit DAC architecture with four Y-Flash cells feeding a transimpedance amplifier and an external software training loop." width="1299" height="1119" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>My Y-Flash 4-bit DAC concept.</strong> Four floating-gate cells supply trainable branch currents into a transimpedance amplifier's virtual ground while an external training loop updates their threshold states.</figcaption>
</figure>

Follow a single branch in the 4×1 array: asserting a digital bit applies the 1.8 V read voltage to its Y-Flash cell, injecting a DC branch current set by that cell's stored threshold voltage into the transimpedance amplifier's virtual ground. Under ideal feedback, the enabled branches sum cleanly — <var>I</var><sub>sum</sub> ≈ <span class="math-inline"><var>B</var><sub>1</sub><var>I</var><sub>1</sub></span> + <span class="math-inline"><var>B</var><sub>2</sub><var>I</var><sub>2</sub></span> + <span class="math-inline"><var>B</var><sub>3</sub><var>I</var><sub>3</sub></span> + <span class="math-inline"><var>B</var><sub>4</sub><var>I</var><sub>4</sub></span>, producing <span class="math-inline"><var>V</var><sub>out</sub> ≈ −<var>R</var><sub>f</sub>&thinsp;<var>I</var><sub>sum</sub></span> (with each <var>B</var> equal to 0 or 1). Uniform DAC steps emerge once training drives those four currents into a 1:2:4:8 binary progression — which, because subthreshold current depends exponentially on threshold voltage, corresponds to four nearly equidistant values of <var>V</var><sub>th</sub>. During training, an external loop compares the sensed output against each target code and routes program or erase pulses to nudge each cell's threshold up or down.

Process voltage ratings shaped the array immediately. Programming requires 5 V pulses and erasing requires 8 V; integrating DIDACTIC's 2T1R access switches on chip would demand charge pumps and transistors able to withstand more than 8 V, which the TowerJazz process did not offer. Driving bare 1R cells from an external test bench sidestepped that breakdown limit for a proof of concept, keeping the core array compact while leaving the high-voltage training interface off chip.

A subtle analog bottleneck surfaces at code `0000`: op-amp input offset. An assumed ±2 mV offset amplified 45× by the readout chain shifts the zero-code output by up to 90 mV. Under this unipolar positive read bias (1.8 V into a 0 V virtual ground), enabled branches inject current in only one direction — and at code `0000`, none of the four bit branches conduct at all — so training the four binary weights alone cannot cancel a bipolar offset. To absorb offset of either sign, I proposed adding two dedicated trim cells of opposing polarity: measure the zero-code error first, program whichever trim cell zeroes it out, and hold that cell active while training the four binary weights and throughout normal conversion.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/y-flash/y-flash-threshold-training.png' | relative_url }}" alt="Training plot showing four Y-Flash threshold voltages converging over roughly 300 samples." width="1295" height="906" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>My DAC training simulation.</strong> Program and erase pulses steer the four initially identical threshold voltages into nearly evenly spaced subthreshold levels (~1.11 to 1.41 V) over ~300 training samples — equal spacing in <var>V</var><sub>th</sub> that maps exponentially into binary-weighted branch currents.</figcaption>
</figure>

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/y-flash/y-flash-dac-output.png' | relative_url }}" alt="DAC output plot comparing the initial irregular DAC response against the final trained staircase response." width="1956" height="1030" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>My simulated DAC response, before and after training.</strong> Training corrects an irregular initial transfer curve into a uniform 4-bit staircase (plotted as output voltage magnitude <span class="math-inline"><var>A</var>(V)</span> across the initial and final 16-code sweeps).</figcaption>
</figure>

In preliminary SPICE simulations with ideal peripheral blocks, the trained 4-bit core reached 0.25 LSB DNL and 0.26 LSB INL — validating weight convergence before introducing non-ideal peripherals, implementing the proposed offset-trim cells, or taping out silicon.

## Published work

- Loai Danial, Vasu Gupta, Evgeny Pikhay, Yakov Roizin, and Shahar Kvatinsky, ["Modeling a Floating-Gate Memristive Device for Computer Aided Design of Neuromorphic Computing,"](https://doi.org/10.23919/DATE48585.2020.9116354) 2020 Design, Automation & Test in Europe Conference & Exhibition (DATE), pp. 472–477, 2020.
- Loai Danial, Evgeny Pikhay, Eric Herbelin, Nicolas Wainstein, Vasu Gupta, Nimrod Wald, Yakov Roizin, Ramez Daniel, and Shahar Kvatinsky, ["Two-terminal floating-gate transistors with a low-power memristive operation mode for analogue neuromorphic computing,"](https://doi.org/10.1038/s41928-019-0331-1) Nature Electronics, vol. 2, no. 12, pp. 596–605, 2019.
- Vasu Gupta, Loai Danial, and Shahar Kvatinsky, ["Verilog-A model – Y-flash memristive device,"](https://asic2.group/wp-content/uploads/2021/02/Y-flash-manual-1.pdf) technical manual, ASIC² research group, Technion–Israel Institute of Technology, undated, 6 pp.

## Further reading

- Loai Danial, Nicolás Wainstein, Shraga Kraus, and Shahar Kvatinsky, ["DIDACTIC: A Data-Intelligent Digital-to-Analog Converter with a Trainable Integrated Circuit using Memristors,"](https://doi.org/10.1109/JETCAS.2017.2780251) IEEE Journal on Emerging and Selected Topics in Circuits and Systems, vol. 8, no. 1, pp. 146–158, March 2018 — the trainable-DAC approach behind my follow-on study.

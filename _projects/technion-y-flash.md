---
title: Y-Flash Device Modeling and Trainable DAC
institution: Technion
period: 2018–2020
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
summary: Y-Flash device modeling published at DATE 2020, with a separate trainable-DAC study.
description: Y-Flash floating-gate memristive device modeling with the Technion ASIC2 group, including Verilog-A CAD infrastructure, small-signal analysis, and a trainable DAC architecture.
---

This project started as my BITS undergraduate thesis and grew into a two-year collaboration with the ASIC2 group at the Technion. The group had a floating-gate device, Y-Flash, that behaves like an analog memristive synapse; the device itself was published in Nature Electronics. My work focused on the circuit-design tools: a Verilog-A model that runs in Cadence, MATLAB fitting and training simulations, small-signal analysis, and a trainable-DAC concept that used the device as its weights.

## The device

Y-Flash is two NMOS transistors sharing a floating gate, built in a commercial 180 nm CMOS flow. In subthreshold read, the threshold-voltage state sets the current, so the device acts as a tunable conductance. That makes it a candidate for vector-matrix multiplication and trainable analog weights, using standard CMOS without exotic materials.

Circuit evaluation needs models of program and erase dynamics, read behavior, variability, and array disturb effects. Device characterization alone does not show how a circuit will behave.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/y-flash/y-flash-iv-hysteresis.png' | relative_url }}" alt="Y-Flash memristive I-V simulation showing asymmetric hysteresis across drain-source voltage." width="1920" height="656" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>Model-generated Y-Flash I-V behavior.</strong> The model treats the floating-gate threshold voltage as the internal state and uses subthreshold read current as the circuit-facing conductance. See <a href="https://asic2.group/wp-content/uploads/2021/02/Y-flash-manual-1.pdf#page=5">Gupta et al., model manual, Fig. 8</a>.</figcaption>
</figure>

## The model

The Verilog-A model was the center of my work because it made the device available to other designers. The public manual describes more than 650 distinguishable resistance levels in the model for 50%-duty 20 µs pulse inputs, with deterministic memristive dynamics, usable directly at schematic level. The model includes:

- program and erase dynamics fitted from measured Y-Flash behavior;
- a read-mode equation mapping floating-gate threshold voltage to subthreshold current;
- a Verilog-A implementation for Cadence Virtuoso;
- parameters for coupling ratio, initial threshold voltage, programming constants, read-current scale, and simulation resolution;
- a stochastic extension for Monte Carlo and variation studies;
- small-signal schematics showing when the device can be treated as a passive incremental resistance.

The DATE 2020 paper describes a top-down CAD framework, from Verilog-A through Monte Carlo, layout, DRC/LVS, and extraction.

## The trainable DAC

In a separate follow-on study, I explored a Y-Flash DAC inspired by [DIDACTIC](https://doi.org/10.1109/JETCAS.2017.2780251). The idea treats DAC calibration as a learning problem: instead of assuming a perfectly matched binary-weighted array, use analog weights and train them until the output approaches the target code levels. My earlier DAC study used a VTEAM model fitted to an HfOx memristor in a 2T1R synapse. With Y-Flash, I asked what changes when the weights are floating-gate devices with asymmetric program/erase and specific read-bias requirements.

<figure class="source-figure">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/y-flash/y-flash-dac.png' | relative_url }}" alt="Y-Flash based 4-bit DAC architecture with four Y-Flash cells feeding a transimpedance amplifier and an external software training loop." width="1299" height="1119" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>My Y-Flash 4-bit DAC concept.</strong> Four Y-Flash devices provide trainable conductance weights; an op-amp senses the summed current while an external training loop updates the device states.</figcaption>
</figure>

The study used a 4×1 Y-Flash array with transimpedance sensing. In operation, the digital code selects which conductances contribute current. In training, program and erase pulses adjust the threshold voltages until the analog output approaches the target code levels.

Amplifier offset can produce a nonzero output even at code 0000. My proposed correction adds two Y-Flash cells: first check the zero-code output, program the appropriate cell to cancel the offset, then keep that cell enabled while training the four DAC weights and during conversion. Program and erase also require separate high-voltage connections, so the sensing circuit and training interface are part of the DAC design.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/y-flash/y-flash-threshold-training.png' | relative_url }}" alt="Training plot showing four Y-Flash threshold voltages converging over roughly 300 samples." width="1295" height="906" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>My DAC training simulation.</strong> The learned DAC weights are Y-Flash threshold-voltage states, moved by program and erase pulses.</figcaption>
</figure>

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/y-flash/y-flash-dac-output.png' | relative_url }}" alt="DAC output plot comparing the initial irregular DAC response against the final trained staircase response." width="1956" height="1030" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>My simulated DAC response, before and after training.</strong> The training loop moved an irregular initial response toward the desired staircase output.</figcaption>
</figure>

My preliminary SPICE simulations of the four-bit concept used ideal peripheral blocks and reported 0.25 LSB DNL and 0.26 LSB INL. These results do not demonstrate the proposed offset correction or fabricated-DAC performance.

## Published work

- Loai Danial, Vasu Gupta, Evgeny Pikhay, Yakov Roizin, and Shahar Kvatinsky, ["Modeling a Floating-Gate Memristive Device for Computer Aided Design of Neuromorphic Computing,"](https://doi.org/10.23919/DATE48585.2020.9116354) 2020 Design, Automation & Test in Europe Conference & Exhibition (DATE), pp. 472–477, 2020.
- Loai Danial, Evgeny Pikhay, Eric Herbelin, Nicolas Wainstein, Vasu Gupta, Nimrod Wald, Yakov Roizin, Ramez Daniel, and Shahar Kvatinsky, ["Two-terminal floating-gate transistors with a low-power memristive operation mode for analogue neuromorphic computing,"](https://doi.org/10.1038/s41928-019-0331-1) Nature Electronics, vol. 2, no. 12, pp. 596–605, 2019.
- Vasu Gupta, Loai Danial, and Shahar Kvatinsky, ["Verilog-A model – Y-flash memristive device,"](https://asic2.group/wp-content/uploads/2021/02/Y-flash-manual-1.pdf) technical manual, ASIC² research group, Technion–Israel Institute of Technology, undated, 6 pp.

## Further reading

- Loai Danial, Nicolás Wainstein, Shraga Kraus, and Shahar Kvatinsky, ["DIDACTIC: A Data-Intelligent Digital-to-Analog Converter with a Trainable Integrated Circuit using Memristors,"](https://doi.org/10.1109/JETCAS.2017.2780251) IEEE Journal on Emerging and Selected Topics in Circuits and Systems, vol. 8, no. 1, pp. 146–158, March 2018 — the trainable-DAC approach behind my follow-on study.

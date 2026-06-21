---
title: Y-Flash Memristive Device Modeling and Trainable DAC
institution: Technion
period: 2018–2020
role: Undergraduate research contributor; Verilog-A modeling, DAC architecture, and training simulations
kind: project
featured: true
topics:
  - neuromorphic circuits
  - floating-gate devices
  - Verilog-A
  - trainable DACs
  - CAD modeling
status: Technion/ASIC2 research thread with Nature Electronics and DATE publication anchors
date: 2020-03-01
updated: 2026-06-21
summary: A Technion/ASIC2 research thread connecting a CMOS-compatible Y-Flash memristive device to circuit-level Verilog-A modeling, small-signal analysis, and a gradient-descent-trained DAC concept.
description: Technion/ASIC2 Y-Flash project work on floating-gate memristive device modeling, Verilog-A CAD infrastructure, small-signal analysis, and a trainable DAC architecture.
links:
  - label: DATE 2020 paper DOI
    url: https://doi.org/10.23919/DATE48585.2020.9116354
  - label: Nature Electronics paper DOI
    url: https://doi.org/10.1038/s41928-019-0331-1
  - label: Public ASIC2 Y-Flash Verilog-A manual
    url: https://asic2.group/wp-content/uploads/2021/02/Y-flash-manual-1.pdf
---

This was the Technion project where device physics, circuit modeling, and data-converter architecture all became part of the same problem.

The starting question was practical: if a floating-gate memory device can behave like an analog memristive synapse, what does a circuit designer need before using it inside a larger system? A nice device curve is not enough. The designer needs a model that runs in Cadence, captures the important operating modes, exposes the right knobs, and stays honest about where the device is deterministic, stochastic, linear enough, or awkward.

My thread sat inside the ASIC2 work on the Y-Flash device. The broader group result was the low-power two-terminal floating-gate memristive device published in Nature Electronics, and the CAD/modeling framework later published at DATE. My contribution was the modeling and system-design layer around that device: Verilog-A models, MATLAB fitting and training simulations, small-signal and array-level thinking, and the Y-Flash version of a trainable DAC.

## Design Question

The useful design question was not "can this device remember a conductance?" It was more specific: can a standard-CMOS floating-gate device become a reliable design primitive for neuromorphic mixed-signal circuits?

Y-Flash was attractive because it avoided the usual gap between exotic memristive materials and CMOS integration. The device was built in a commercial 180 nm CMOS flow using floating-gate technology, with two NMOS transistors coupled through a common floating gate. In subthreshold operation, the threshold-voltage state controls the read current, so the device can act as a tunable conductance.

That made it promising for vector-matrix multiplication and trainable analog weights. It also made the modeling burden real: program, erase, read, small-signal behavior, variability, and array disturbances all had to be translated into something usable in a circuit simulator.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/y-flash/y-flash-iv-hysteresis.png' | relative_url }}" alt="Y-Flash memristive I-V simulation showing asymmetric hysteresis across drain-source voltage.">
  </div>
  <figcaption><strong>Y-Flash memristive I-V behavior.</strong> The model treated the floating-gate threshold voltage as the internal state and used subthreshold read current as the circuit-facing conductance.</figcaption>
</figure>

## Modeling Work

The Verilog-A model was the center of the work because it made the device available to circuit designers. The public model manual describes the model as having more than 650 accurate resistance levels for 50% duty-cycle 20 us pulse inputs, deterministic memristive dynamics, and schematic-level use for neuromorphic circuit simulation.

The modeling path had several layers:

- Program and erase dynamics fitted from measured Y-Flash behavior.
- A read-mode equation that maps floating-gate threshold voltage to subthreshold current.
- A Verilog-A implementation that could be used directly in Cadence Virtuoso.
- Model parameters for coupling ratio, initial threshold voltage, programming constants, read-current scale, and simulation resolution.
- A stochastic/variation extension for Monte Carlo and PVT-style exploration.
- Small-signal schematics that showed when the device could be treated as a passive incremental resistance.

The DATE paper framed this as a top-down CAD framework: Verilog-A modeling, small-signal schematics, stochastic modeling, Monte Carlo simulation, layout, DRC, LVS, and RC extraction. That framing is exactly what made the project useful to me. It was not just writing equations down. It was turning a device into an engineering object.

## Trainable DAC Thread

The data-converter part came from DIDACTIC, a trainable DAC idea that treats calibration as a learning problem. Instead of assuming a perfectly matched binary-weighted DAC, the circuit uses analog weights and trains them so the output codes line up with desired analog labels.

My BITS thesis started from that idea: **Full-custom design of DIDACTIC: A data-intelligent digital to analog converter using trainable integrated circuit**. The thesis used a memristor-based learning-DAC abstraction. The Y-Flash work asked a harder implementation question: what changes if the learned weights are CMOS-compatible floating-gate memristive devices with asymmetric program/erase/read requirements?

<figure class="source-figure">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/y-flash/y-flash-dac.png' | relative_url }}" alt="Y-Flash based 4-bit DAC architecture with four Y-Flash cells feeding a transimpedance amplifier and an external software training loop.">
  </div>
  <figcaption><strong>Y-Flash 4-bit DAC concept.</strong> Four Y-Flash devices provide trainable conductance weights; an op-amp senses the summed current while an external training loop updates the device states.</figcaption>
</figure>

The resulting 4-bit DAC study used a 4-by-1 Y-Flash array and a transimpedance-style sensing path. During operation, the digital input selects which Y-Flash conductances contribute current. During training, the threshold voltages are adjusted so the analog output approaches the target code levels.

That is the analog-design part I still like: the machine-learning language only matters if it survives the device constraints. Y-Flash needed high-voltage program and erase pulses, asymmetric terminal connections, careful read biasing, and offset-aware sensing. The DAC architecture had to respect those facts rather than pretending the memristor was an ideal variable resistor.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/y-flash/y-flash-threshold-training.png' | relative_url }}" alt="Training plot showing four Y-Flash threshold voltages converging over roughly 300 samples.">
  </div>
  <figcaption><strong>Training as threshold-voltage movement.</strong> The learned DAC weights are not abstract numbers; they are Y-Flash threshold-voltage states moved by program and erase pulses.</figcaption>
</figure>

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/y-flash/y-flash-dac-output.png' | relative_url }}" alt="DAC output plot comparing the initial irregular DAC response against the final trained staircase response.">
  </div>
  <figcaption><strong>Initial and trained DAC response.</strong> The training loop moved an irregular initial response toward the desired staircase output.</figcaption>
</figure>

## What Held Together

The durable technical pattern was the same across the model, DAC, and publication work:

- A device state is only useful if the circuit can read it without disturbing it.
- A model is only useful if it compresses physics without erasing the constraints that matter.
- A learning algorithm is only useful in hardware if its update rule maps to real program and erase operations.
- A compact architecture is not automatically practical; high-voltage pulses, offsets, sneak paths, and variation still set the terms.

This project made me more suspicious of clean block diagrams in a productive way. The model, the circuit, and the training loop all had to agree with each other. When they did not, the disagreement was usually the most useful design information.

## Sources

- Local BITS thesis report: **Full-custom design of DIDACTIC: A data-intelligent digital to analog converter using trainable integrated circuit**, submitted November 2018.
- Local Technion group-meeting deck: **Trainable DACs using Y-flash memristive device**, December 2018.
- Public ASIC2 manual: **Verilog-A model - Y-flash memristive device**, Vasu Gupta, Loai Danial, and Shahar Kvatinsky.
- DATE 2020 paper: **Modeling a Floating-Gate Memristive Device for Computer Aided Design of Neuromorphic Computing**, Loai Danial, Vasu Gupta, Evgeny Pikhay, Yakov Roizin, and Shahar Kvatinsky.
- Nature Electronics 2019 paper: **Two-terminal floating-gate transistors with a low-power memristive operation mode for analogue neuromorphic computing**, Loai Danial, Evgeny Pikhay, Eric Herbelin, Nicolas Wainstein, Vasu Gupta, Nimrod Wald, Yakov Roizin, Ramez Daniel, and Shahar Kvatinsky.

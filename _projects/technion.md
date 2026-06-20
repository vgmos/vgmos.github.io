---
title: Technion Research Projects
institution: Technion
period: 2018–2019
role: Undergraduate thesis researcher and modeling contributor
kind: era
featured: false
topics:
  - neuromorphic circuits
  - memory devices
  - Verilog-A
  - modeling
status: BITS thesis with Technion supervision
date: 2019-12-01
updated: 2026-06-12
summary: Undergraduate thesis and modeling work around trainable DACs, floating-gate memristive devices, Verilog-A, and neuromorphic circuit design.
description: Technion-supervised undergraduate thesis and modeling work around trainable DACs, floating-gate memristive devices, Verilog-A, and neuromorphic circuit design.
---

## Device Questions, Circuit Models

The Technion thread carried the strongest bridge between device-level questions and circuit-level modeling. The center of the work was a BITS thesis, supervised on campus by Prof. Pravin Mane and off campus by Prof. Shahar Kvatinsky, on a data-intelligent DAC using a trainable integrated circuit.

The thesis title captures the ambition: **Full-custom design of DIDACTIC: A data-intelligent digital to analog converter using trainable integrated circuit**. The source material also includes a detailed 2018 work plan for Verilog-A modeling, Y-Flash device modeling, neuromorphic array exploration, circuit/layout design, and final thesis submission in December 2018.

## Technical Shape

The durable technical question was not simply "can a memory device act like a synapse?" It was how to turn a device idea into something a circuit designer can simulate, stress, and place inside a larger system.

That made the useful artifacts practical:

- A BITS thesis on a trainable DAC, reporting an ANN-inspired, fault-tolerant DAC architecture using stochastic-gradient-style training and HfO2 memristor-based 2T1R synaptic conductance.
- A Y-Flash modeling thread with Verilog-A models and simulation artifacts.
- Conference-manuscript work on modeling a floating-gate memristive device for CAD of neuromorphic computing, including SPICE modeling, small-signal schematics, stochastic behavior, Monte Carlo simulation, layout, DRC, LVS, and extraction.

## What I Learned

This period made circuit modeling feel less like documentation and more like design infrastructure. A useful model has to compress physics without lying about it. It has to be simple enough to compose, accurate enough to guide decisions, and honest enough to expose where the device is still immature.

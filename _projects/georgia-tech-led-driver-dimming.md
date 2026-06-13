---
title: Dimming DC-DC LED Drivers
institution: Georgia Tech
period: 2020-2021
role: MS thesis researcher
kind: project
featured: true
topics:
  - power IC
  - LED drivers
  - switched-inductor converters
  - dimming
status: Scaffolded from thesis and IECON paper
date: 2021-12-10
updated: 2026-06-12
summary: A Georgia Tech thesis and IECON paper on luminous efficiency, power losses, and best-in-class dimming methods for switched-inductor LED drivers.
description: Georgia Tech MS thesis research on dimming DC-DC LED drivers, comparing analog and PWM techniques through power-loss and luminous-efficiency models.
links:
  - label: IECON 2021 paper DOI
    url: https://doi.org/10.1109/IECON48115.2021.9589840
---

## Why It Belongs

This should be one of the headline Georgia Tech pages. It is thesis work, it produced a first-author conference paper, and it connects directly to power-conversion design judgment.

The strongest public version is not just "LED dimming." It is about how to compare dimming techniques honestly: include the power stage, include the LED electro-optical behavior, and distinguish dimming range from luminous efficiency.

## Source Trail

- MS thesis approved December 10, 2021: "Dimming DC-DC LED Drivers: Power Losses, Luminous Efficiency & Best-in-Class."
- IECON 2021 paper with Gabriel A. Rincon-Mora: "Dimming DC-DC LED Drivers: Luminous Efficiency, Power Losses, & Best-in-Class."
- Archived CV listing the Georgia Tech GTAPE research period and LED-driver work.

## Technical Shape

The thesis compares analog dimming and duty-cycled PWM dimming in switched-inductor LED drivers. The source material builds the argument through:

- LED electrical and optical behavior.
- DC-DC LED-driver load configurations and switched-inductor topologies.
- Analog dimming across CCM and DCM operation.
- Shutdown, shunt-switched, and series-switched PWM dimming.
- Luminous efficiency, dimming range, input power, and power-loss mechanisms.

The headline result is that analog dimming can be substantially more efficient while also offering the widest dimming range in the analyzed context.

## Presentation Plan

This page deserves the most polished reconstruction:

- A short "problem" section explaining why brightness control is not the same as efficient light delivery.
- One figure comparing analog, shutdown PWM, shunt PWM, and series PWM.
- One technical table for efficiency, dimming range, dominant losses, and implementation complexity.
- A final reflection connecting the thesis to later professional power IC work.

The tone should be careful: present the result as context-specific analysis of switched-inductor LED drivers, not as a universal rule for every lighting system.

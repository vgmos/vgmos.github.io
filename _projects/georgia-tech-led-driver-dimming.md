---
title: Dimming DC-DC LED Driver
institution: Georgia Tech
period: 2020–2021
role: MS thesis researcher, first author
kind: project
featured: true
topics:
  - power IC
  - LED drivers
  - switched-inductor converters
  - dimming
status: MS thesis and IECON 2021 paper
date: 2021-12-10
summary: My MS thesis on analog and PWM dimming. Published at IECON 2021.
description: MS thesis on dimming DC-DC LED drivers, comparing analog, shutdown PWM, shunt-switched PWM, and series-switched PWM by luminous efficiency, power loss, and dimming range.
links:
  - label: IECON 2021 paper DOI
    url: https://doi.org/10.1109/IECON48115.2021.9589840
---

My MS thesis at Georgia Tech was about where the energy goes when you dim an LED. I went in assuming brightness follows average LED current and the driver just supplies it. Neither holds cleanly: luminous flux bends over at high current, and a switched-inductor driver spends power differently depending on how you ask it to dim. Two methods can deliver the same average current and still produce different light from different input watts. The thesis was about pinning that down.

## Problem

High-power LEDs are current-controlled devices whose flux rises with current but saturates instead of scaling forever. The driver stacks its own losses on top: controller, gate drive, switches, inductor, output capacitor. So the comparison that matters is useful light out per input watt, through the whole chain.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/led-driver-dimming/power-stage.png' | relative_url }}" alt="Original IECON schematic of the switched-inductor buck-boost LED driver power stage feeding four LEDs.">
  </div>
  <figcaption><strong>Fig. 2 — Power stage.</strong> The synchronous buck-boost switched-inductor LED driver used for the dimming comparison.</figcaption>
</figure>

I modeled a representative 12 V automotive buck-boost driver delivering up to 1 A into four CREE XP-E2-class LEDs. The model folded together the LED's electro-optical curve, its I-V curve, and the converter's loss profile, with SPICE runs to check the pieces.

## Dimming Methods

The thesis compared analog dimming against three PWM variants: shutdown PWM, shunt-switched PWM, and series-switched PWM. All four control perceived brightness; the differences show up in where the power goes.

PWM holds the LED at a high peak current and chops time, so it keeps producing light at an operating point where the flux curve has already flattened. Analog dimming moves the operating point itself, which avoids that penalty across most of the light range. The loss breakdown makes the split visible: the PWM-specific term dominates much of the dimming range, while the shared converter losses are common to both methods.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/led-driver-dimming/power-loss-breakdown.png' | relative_url }}" alt="Original IECON power-loss breakdown plot comparing analog and PWM dimming losses across luminous flux.">
  </div>
  <figcaption><strong>Fig. 13 — Power-loss breakdown.</strong> The PWM-specific loss term dominates much of the dimming range, while shared switched-inductor losses remain common to both methods.</figcaption>
</figure>

## Result

PWM still earns its place; you want it when color consistency, control simplicity, or a very deep dimming ratio matters. But in this driver, analog dimming had better luminous efficiency over most of the range — peaking near 93 lm/W where PWM sits near 59 — and in principle it can cover the full 0–100% span if DCM operation and current sensing are handled with care.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/led-driver-dimming/luminous-efficiency.png' | relative_url }}" alt="Original IECON luminous-efficiency plot showing analog dimming peaking near 93 lumens per watt and PWM near 59 lumens per watt.">
  </div>
  <figcaption><strong>Fig. 9 — Luminous efficiency.</strong> Analog peaks near 93 L/W, while PWM remains near 59 L/W in the modeled setup.</figcaption>
</figure>

That gap is where the thesis's "up to 57%" number comes from. PWM's efficiency curve is flat because the operating point never moves; analog dimming rides closer to the LED's most efficient region.

<figure class="source-figure source-figure--table">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/led-driver-dimming/comparison-table.png' | relative_url }}" alt="Original IECON comparison table for analog, shutdown PWM, shunt-switched PWM, and series-switched PWM dimming.">
  </div>
  <figcaption><strong>Table I — Method comparison.</strong> Luminous efficiency, dimming range, transient behavior, and added loss mechanisms.</figcaption>
</figure>

One caveat survived every attempt to simplify it away: at very low output, the converter's fixed losses dominate and PWM can briefly come out ahead. Rules of thumb have operating regions too.

The lasting effect on me was how I read "efficiency." It's never one number. Half the job is working out which loss is active at a given operating point, which one scales, and which one is an artifact of the control method rather than the physics.

## Sources

The work was completed as my Georgia Tech MS thesis, **Dimming DC-DC LED Drivers: Power Losses, Luminous Efficiency & Best-in-Class**, approved in December 2021. The conference version was published with Prof. Gabriel A. Rincón-Mora at IECON 2021 as **Dimming DC-DC LED Drivers: Luminous Efficiency, Power Losses, & Best-in-Class**.

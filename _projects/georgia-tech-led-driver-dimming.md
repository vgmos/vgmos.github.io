---
title: Dimming DC-DC LED Drivers
institution: Georgia Tech
period: 2020-2021
role: MS thesis researcher, first author
kind: project
featured: true
topics:
  - power IC
  - LED drivers
  - switched-inductor converters
  - dimming
status: MS thesis and IECON publication
date: 2021-12-10
summary: A Georgia Tech thesis and IECON paper comparing analog and PWM dimming in switched-inductor LED drivers through luminous efficiency, power loss, and dimming range.
description: Georgia Tech MS thesis research on dimming DC-DC LED drivers, comparing analog, shutdown PWM, shunt-switched PWM, and series-switched PWM methods through power-loss and luminous-efficiency models.
links:
  - label: IECON 2021 paper DOI
    url: https://doi.org/10.1109/IECON48115.2021.9589840
---

This project asked a deceptively simple power-IC question: when an LED driver dims a light, where does the energy actually go?

The easy story is that brightness follows average LED current. The more useful story is that LEDs are nonlinear optical loads, and switched-inductor drivers are not ideal current sources. Once both facts are included, two dimming methods with the same average current can deliver different light for different input power. That is the part I cared about: not just making the LED dim, but making the comparison honest.

## Problem

High-power LEDs are current-controlled devices. Their luminous flux increases with current, but it bends over at high current instead of scaling forever. A DC-DC LED driver also has its own loss profile: controller loss, gate-drive loss, switch loss, inductor loss, and output-capacitor energy movement.

So the design question becomes: how much useful light does each control method deliver per input watt across the actual LED driver chain?

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/led-driver-dimming/power-stage.png' | relative_url }}" alt="Original IECON schematic of the switched-inductor buck-boost LED driver power stage feeding four LEDs.">
  </div>
  <figcaption>Original IECON Fig. 2 power stage: the synchronous buck-boost switched-inductor LED driver used for the dimming comparison.</figcaption>
</figure>

In the thesis, I modeled a representative 12 V automotive buck-boost LED driver delivering up to 1 A into four CREE XP-E2 class LEDs. The analysis folded together the LED electro-optical curve, the LED I-V curve, converter efficiency, and SPICE validation. That let me compare dimming methods by luminous efficiency, power loss, and dimming range instead of by habit or datasheet folklore.

## Dimming Methods

The work compared analog dimming against three PWM variants: shutdown PWM, shunt-switched PWM, and series-switched PWM. All four can control perceived brightness. They do not spend power the same way.

The clean intuition is this: PWM keeps the LED biased at a high peak current and chops time. Because LED luminous flux saturates at high current, PWM pays a penalty for producing light at that peak operating point. Analog dimming moves the operating point itself. In this modeled driver, that removed a fundamental PWM power penalty across most of the useful light range.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/led-driver-dimming/power-loss-breakdown.png' | relative_url }}" alt="Original IECON power-loss breakdown plot comparing analog and PWM dimming losses across luminous flux.">
  </div>
  <figcaption>Original IECON Fig. 13 power-loss breakdown: the PWM-specific loss term dominates much of the dimming range, while shared switched-inductor losses remain common to both methods.</figcaption>
</figure>

## Result

The headline result was not "PWM is bad." PWM is useful, especially when color consistency, control simplicity, or a very high dimming ratio matter. The result was more precise: in this switched-inductor automotive setup, analog dimming gave the best luminous efficiency over most of the range and could theoretically cover the full 0-100% dimming span when DCM operation and sensing limits were handled well.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/led-driver-dimming/luminous-efficiency.png' | relative_url }}" alt="Original IECON luminous-efficiency plot showing analog dimming peaking near 93 lumens per watt and PWM near 59 lumens per watt.">
  </div>
  <figcaption>Original IECON Fig. 9 luminous-efficiency result: analog peaks near 93 L/W, while PWM remains near 59 L/W in the modeled setup.</figcaption>
</figure>

This is where the "up to 57%" result comes from. PWM is flat because it keeps the LEDs at the same peak operating point and changes duty cycle. Analog dimming changes the LED current itself, so it can sit closer to the load's most efficient optical region.

<figure class="source-figure source-figure--table">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/led-driver-dimming/comparison-table.png' | relative_url }}" alt="Original IECON comparison table for analog, shutdown PWM, shunt-switched PWM, and series-switched PWM dimming.">
  </div>
  <figcaption>Original IECON Table I: comparison of luminous efficiency, dimming range, transient behavior, and added loss mechanisms.</figcaption>
</figure>

There is a useful caveat at the low end. When the output power is tiny, fixed switched-inductor losses can dominate, and PWM can briefly look better. That caveat is the point. A design engineer should not carry a rule of thumb farther than its operating region.

## What I Learned as a Designer

This work helped move me from circuit familiarity toward design judgment. It forced me to stop treating "efficiency" as one number and start asking which loss is active, which loss scales, and which loss is an artifact of the control method.

It also gave me a power-IC way of thinking:

- Model the load before optimizing the converter.
- Separate physical loss from control-policy loss.
- Use SPICE as a correlation tool, not a substitute for first-principles reasoning.
- Treat dimming range as a transient and sensing problem, not just a percentage on a datasheet.
- Compare techniques at the system boundary: input watts in, useful lumens out.

That is still how I like to reason about analog and power design. A good circuit is not only a schematic that regulates. It is a chain of assumptions that still makes sense when current, voltage, temperature, timing, and human perception all enter the room.

## Sources

The work was completed as my Georgia Tech MS thesis, **Dimming DC-DC LED Drivers: Power Losses, Luminous Efficiency & Best-in-Class**, approved in December 2021. The conference version was published with Prof. Gabriel A. Rincón-Mora at IECON 2021 as **Dimming DC-DC LED Drivers: Luminous Efficiency, Power Losses, & Best-in-Class**.

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
---

My MS thesis at Georgia Tech studied where energy goes when an LED is dimmed. Luminous flux becomes less proportional to current at high current, and driver losses depend on the dimming method. Two methods can deliver the same average current yet produce different amounts of light and consume different input power. I modeled those differences.

## Problem

The controller, gate drive, switches, inductor, and output capacitor add losses. I compared useful light output per input watt across the complete LED-and-driver system.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/led-driver-dimming/power-stage.png' | relative_url }}" alt="Original IECON schematic of the switched-inductor buck-boost LED driver power stage feeding four LEDs." width="1846" height="336" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>Fig. 2 — Power stage.</strong> The synchronous buck-boost switched-inductor LED driver used for the dimming comparison. Source: <a href="https://rincon-mora.gatech.edu/publicat/cnfs/iecon21dim.pdf#page=1">IECON 2021</a>.</figcaption>
</figure>

I modeled a representative 12 V automotive buck-boost driver delivering up to 1 A into four CREE XP-E2-class LEDs. The model combined the LED's electro-optical curve, its I-V curve, and the converter's loss profile. I used SPICE simulations to check individual parts.

## Dimming methods

The thesis compared analog dimming against three PWM variants: shutdown PWM, shunt-switched PWM, and series-switched PWM.

In the buck-boost stage studied here:

- **Shutdown PWM** stops the power stage. Inductor current decays, and the output capacitor continues supplying the LEDs as it discharges, extending turn-off.
- **Shunt-switched PWM** discharges the output capacitor through a parallel switch. The LEDs turn off faster, but the capacitor must be recharged on the next pulse, losing stored energy each cycle.
- **Series-switched PWM** interrupts the LED current while preserving the output-capacitor voltage. Precharging the inductor before reconnecting the LEDs shortens turn-on, while the added switch introduces conduction loss and the remaining inductor energy requires overshoot control.

PWM holds the LED at a high peak current during each on interval, so it keeps producing light at an operating point where the flux curve has already flattened. Analog dimming moves the operating point itself, which avoids that penalty across most of the light range.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/led-driver-dimming/power-loss-breakdown.png' | relative_url }}" alt="Original IECON power-loss breakdown plot comparing analog and PWM dimming losses across luminous flux." width="1726" height="546" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>Fig. 13 — Power-loss breakdown.</strong> The PWM-specific loss term dominates much of the dimming range, while shared switched-inductor losses remain common to both methods. Source: <a href="https://rincon-mora.gatech.edu/publicat/cnfs/iecon21dim.pdf#page=3">IECON 2021</a>.</figcaption>
</figure>

## Result

PWM remains useful when color consistency, control simplicity, or a very deep dimming ratio matters. In this modeled driver, analog dimming had better luminous efficiency over most of the range: a peak near 93 lm/W compared with PWM near 59 lm/W.

In DCM, lengthening the switching period spaces fixed inductor-energy packets farther apart and lowers the average LED current. The output capacitor smooths the delivered current. This gives the model its theoretical 0–100% dimming range; the practical lower limit depends on current-sensing noise and offset, and on whether the LED still emits light at that current.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/led-driver-dimming/luminous-efficiency.png' | relative_url }}" alt="Original IECON luminous-efficiency plot showing analog dimming peaking near 93 lumens per watt and PWM near 59 lumens per watt." width="1656" height="670" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>Fig. 9 — Luminous efficiency.</strong> Analog peaks near 93 lm/W, while PWM remains near 59 lm/W in the modeled setup. Source: <a href="https://rincon-mora.gatech.edu/publicat/cnfs/iecon21dim.pdf#page=2">IECON 2021</a>.</figcaption>
</figure>

That gap is where the thesis's "up to 57%" number comes from. In the modeled comparison above, PWM's efficiency curve is flat because its on-state operating point stays fixed. Analog dimming moves the LED closer to its most efficient region.

<figure class="source-figure source-figure--table">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/led-driver-dimming/comparison-table.png' | relative_url }}" alt="Original IECON comparison table for analog, shutdown PWM, shunt-switched PWM, and series-switched PWM dimming." width="1766" height="786" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>Table I — Method comparison.</strong> Luminous efficiency, dimming range, transient behavior, and added loss mechanisms for the modeled driver. Source: <a href="https://rincon-mora.gatech.edu/publicat/cnfs/iecon21dim.pdf#page=6">IECON 2021</a>.</figcaption>
</figure>

At very low output, the converter's fixed losses dominate and PWM can briefly be more efficient. Rules of thumb have operating regions too.

## Published work

- Vasu Gupta and Gabriel A. Rincón-Mora, ["Dimming DC–DC LED Drivers: Luminous Efficiency, Power Losses, & Best-in-Class,"](https://doi.org/10.1109/IECON48115.2021.9589840) IECON 2021 – 47th Annual Conference of the IEEE Industrial Electronics Society, pp. 1–6, 2021.
- Vasu Gupta, ["Dimming DC–DC LED Drivers: Power Losses, Luminous Efficiency & Best-in-Class,"](https://repository.gatech.edu/entities/publication/8d35e029-25b7-40ed-b7de-0392023dd439) M.S. thesis, School of Electrical and Computer Engineering, Georgia Institute of Technology, December 2021.

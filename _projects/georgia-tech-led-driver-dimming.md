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
summary: How LED current and converter losses determine the power needed to dim a light. MS thesis and IECON 2021 paper.
description: MS thesis on dimming DC-DC LED drivers, comparing analog, shutdown PWM, shunt-switched PWM, and series-switched PWM by luminous efficiency, power loss, and dimming range.
---

An LED can be dimmed by lowering its current or by switching a fixed current on and off. These are analog and pulse-width-modulated (PWM) dimming. The same average current need not produce the same light: the LED's light output is not perfectly proportional to current, and each dimming method changes the driver's losses.

My MS thesis at Georgia Tech modeled these differences and checked the analysis with SPICE simulations.

## Compare at the same light output

The useful comparison is input power at the same light output. I used lumens per input watt, called luminous efficiency in the paper, to account for both the LED and its driver. The controller, gate drive, switches, inductor, and output capacitor all contribute to the power budget.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/led-driver-dimming/power-stage.png' | relative_url }}" alt="Original IECON schematic of the switched-inductor buck-boost LED driver power stage feeding four LEDs." width="1846" height="336" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>Fig. 2 — Power stage.</strong> The synchronous buck-boost switched-inductor LED driver used for the dimming comparison. Source: <a href="https://rincon-mora.gatech.edu/publicat/cnfs/iecon21dim.pdf#page=1">IECON 2021</a>.</figcaption>
</figure>

I modeled a representative 12 V automotive buck-boost driver delivering up to 1 A into four CREE XP-E2-class LEDs. The model combined light versus current, voltage versus current, and converter losses.

## Dimming methods

Analog dimming lowers the regulated LED current. PWM instead shortens the time spent at a fixed current. Its turn-on and turn-off behavior depends on where the stored inductor energy and capacitor charge go.

In the buck-boost stage studied here:

- **Shutdown PWM** stops the power stage. Inductor current decays, and the output capacitor continues supplying the LEDs as it discharges, extending turn-off.
- **Shunt-switched PWM** discharges the output capacitor through a parallel switch. The LEDs turn off faster, but the capacitor must be recharged on the next pulse, losing stored energy each cycle.
- **Series-switched PWM** interrupts the LED current while preserving the output-capacitor voltage. Precharging the inductor before reconnecting the LEDs shortens turn-on, while the added switch introduces conduction loss and the remaining inductor energy requires overshoot control.

The PWM comparison uses a fixed 1 A on-state LED current. At that operating point, light output has grown more slowly than current. Shorter pulses reduce average brightness but retain this less efficient operating point. Analog dimming lowers the current itself and moves the LED toward a more efficient region.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/led-driver-dimming/power-loss-breakdown.png' | relative_url }}" alt="Original IECON power-loss breakdown plot comparing analog and PWM dimming losses across luminous flux." width="1726" height="546" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>Fig. 13 — Power-loss breakdown.</strong> The PWM penalty is the extra input power needed for the same light output. It accounts for the different operating points of the LED and driver and dominates much of the modeled range. Source: <a href="https://rincon-mora.gatech.edu/publicat/cnfs/iecon21dim.pdf#page=3">IECON 2021</a>.</figcaption>
</figure>

## Result

PWM remains useful when color consistency, control simplicity, or a very deep dimming ratio matters. In this modeled driver, analog dimming had better luminous efficiency over most of the range: a peak near 93 lm/W compared with PWM near 59 lm/W.

At low current, the driver enters discontinuous conduction mode (DCM): the inductor delivers an energy packet, its current falls to zero, and it waits before the next packet. Longer waits lower the average LED current, while the output capacitor smooths the delivered current. This gives the model its theoretical 0–100% dimming range. The practical lower limit depends on current-sensing noise and offset, and on whether the LED still emits light at that current.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/led-driver-dimming/luminous-efficiency.png' | relative_url }}" alt="Original IECON luminous-efficiency plot showing analog dimming peaking near 93 lumens per watt and PWM near 59 lumens per watt." width="1656" height="670" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>Fig. 9 — Luminous efficiency.</strong> Analog peaks near 93 lm/W, while PWM remains near 59 lm/W in the modeled setup. Source: <a href="https://rincon-mora.gatech.edu/publicat/cnfs/iecon21dim.pdf#page=2">IECON 2021</a>.</figcaption>
</figure>

The paper reports up to 57% higher luminous efficiency for analog dimming in this comparison. This is a relative gain in lumens per input watt. PWM's modeled curve stays flat because both light and input power scale with its duty cycle at the fixed on-state operating point.

<figure class="source-figure source-figure--table">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/led-driver-dimming/comparison-table.png' | relative_url }}" alt="Original IECON comparison table for analog, shutdown PWM, shunt-switched PWM, and series-switched PWM dimming." width="1766" height="786" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>Table I — Method comparison.</strong> Luminous efficiency, dimming range, transient behavior, and added loss mechanisms for the modeled driver. Source: <a href="https://rincon-mora.gatech.edu/publicat/cnfs/iecon21dim.pdf#page=6">IECON 2021</a>.</figcaption>
</figure>

At very low light output, converter overhead dominates and PWM can be more efficient. The choice therefore depends on the LED, its operating current, driver losses, and required dimming range. These results come from modeling and simulation of the stated system.

## Published work

- Vasu Gupta and Gabriel A. Rincón-Mora, ["Dimming DC–DC LED Drivers: Luminous Efficiency, Power Losses, & Best-in-Class,"](https://doi.org/10.1109/IECON48115.2021.9589840) IECON 2021 – 47th Annual Conference of the IEEE Industrial Electronics Society, pp. 1–6, 2021.
- Vasu Gupta, ["Dimming DC–DC LED Drivers: Power Losses, Luminous Efficiency & Best-in-Class,"](https://repository.gatech.edu/entities/publication/8d35e029-25b7-40ed-b7de-0392023dd439) M.S. thesis, School of Electrical and Computer Engineering, Georgia Institute of Technology, December 2021.

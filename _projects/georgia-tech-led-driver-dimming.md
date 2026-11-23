---
title: Dimming DC-DC LED Driver
institution: Georgia Tech
period: 2020–2021
publication: MS thesis, IECON 2021
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
summary: Tracing LED efficacy droop and switched-inductor losses to see which dimming scheme delivers the most light per input watt.
description: MS thesis on dimming DC-DC LED drivers under Gabriel Rincón-Mora, comparing analog, shutdown PWM, shunt-switched PWM, and series-switched PWM by luminous efficiency, power loss, and dimming range.
---

There are two standard ways to dim an LED string: reduce its DC forward current (**analog dimming**) or chop a fixed peak current into pulses (**PWM dimming**). At first glance, matching the average current ought to cost the same input power. In practice it does not, for two physical reasons. First, LEDs exhibit **efficacy droop**: as forward current climbs, light output grows sublinearly while forward voltage edges upward, so every electrical watt yields *fewer* lumens at high current. Second, interrupting current in a switched-inductor stage forces a choice about where stored magnetic and capacitive energy go on every PWM edge.

For my MS thesis with Prof. Gabriel Rincón-Mora at Georgia Tech, I built an analytical loss model linking LED electro-optical droop to converter losses across four dimming schemes, and validated it in SPICE.

## Measure light per input watt, not converter efficiency alone

Comparing drivers at equal average current hides the LED's own nonlinearity. The system-level figure of merit is **luminous efficiency** (<var>η</var><sub>L</sub>) — lumens delivered per watt drawn from the supply — evaluated at equal luminous flux. That single ratio captures both LED efficacy droop and every loss mechanism in the power stage: switch conduction, gate drive, inductor resistance, output capacitor ESR, and controller overhead.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/led-driver-dimming/power-stage.png' | relative_url }}" alt="Original IECON schematic of the switched-inductor buck-boost LED driver power stage feeding four LEDs." width="1846" height="336" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>Fig. 2 — Power stage.</strong> The four-switch non-inverting synchronous buck-boost LED driver (<span class="math-inline"><var>L</var><sub>X</sub> = 4.7 µH</span>, <span class="math-inline"><var>C</var><sub>O</sub> = 10 µF</span>) supplying four series LEDs. Source: <a href="https://rincon-mora.gatech.edu/publicat/cnfs/iecon21dim.pdf#page=1">IECON 2021</a>.</figcaption>
</figure>

To ground the comparison in an automotive rail, I modeled a 12 V four-switch non-inverting synchronous buck-boost stage supplying up to 1 A into four series CREE XP-E2-class LEDs — a string whose forward voltage sits right around the nominal 12 V battery, requiring both step-down and step-up capability — pairing measured LED light-vs.-current and voltage-vs.-current curves with the converter's switching, conduction, and quiescent losses.

## Where energy goes in each dimming method

**Analog dimming** lowers the regulated DC current through the string. As current falls, the LEDs step out of their drooping 1 A region into a higher-efficacy operating point, delivering the same light from less electrical power — while also slashing quadratic <span class="math-inline"><var>i</var><sup>2</sup><var>R</var></span> conduction loss in the inductor and switches.

**PWM dimming** keeps the on-state current pinned at 1 A and modulates duty cycle instead. Whenever the LEDs conduct, both the string and the power stage stay locked at that lower-efficacy, higher-conduction-loss 1 A point. On top of that steady penalty, gating a switched-inductor output introduces distinct transient and energy-disposal tradeoffs across the three PWM topologies:

- **Shutdown PWM** disables the converter during the off interval. Leftover inductor current decays and the output capacitor continues discharging into the LEDs, dragging out turn-off and turn-on (<span class="math-inline"><var>t</var><sub>R</sub> + <var>t</var><sub>F</sub> ≤ 100 µs</span>) and limiting dimming range to 1–100%, with no added power switch.
- **Shunt-switched PWM** closes an auxiliary switch in parallel with the LED string to extinguish light abruptly. Turn-off is fast, but shorting the output dumps <var>C</var><sub>O</sub>'s stored charge to ground — forcing the converter to dissipate capacitive recharge energy (<var>P</var><sub>C</sub>) and rebuild output voltage from zero on every turn-on (<span class="math-inline"><var>t</var><sub>R</sub> + <var>t</var><sub>F</sub> ≤ 120 µs</span>, dimming range 1.2–100%).
- **Series-switched PWM** opens a switch in series with the LEDs, cutting string current in <span class="math-inline">≤ 10 ns</span> (extending dimming range to ≈ 0–100%) while trapping <var>C</var><sub>O</sub> near the string's forward voltage so no recharge cycle is wasted. The cost shifts to continuous conduction loss in the series switch (<var>P</var><sub>R</sub>), gate drive (<var>P</var><sub>G</sub>), and managing leftover inductor energy (<var>P</var><sub>L</sub>).

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/led-driver-dimming/power-loss-breakdown.png' | relative_url }}" alt="Original IECON power-loss breakdown plot comparing analog and PWM dimming losses across luminous flux." width="1726" height="546" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>Fig. 13 — Power-loss breakdown.</strong> The PWM penalty (<span class="math-inline">Δ<var>P</var><sub>PWM</sub></span>, peaking at 2.2 W) captures the extra power demanded by pinning the LEDs at 1 A instead of dimming continuously, while <var>P</var><sub>SL(PWM)</sub> exceeds <var>P</var><sub>SL(A)</sub> through higher pulsed conduction loss; added shunt and series switch losses (<span class="math-inline">Δ<var>P</var><sub>SH</sub></span>, <span class="math-inline">Δ<var>P</var><sub>SE</sub></span>) remain far smaller. Source: <a href="https://rincon-mora.gatech.edu/publicat/cnfs/iecon21dim.pdf#page=3">IECON 2021</a>.</figcaption>
</figure>

## Analog vs. PWM across the dimming range

Across nearly the entire brightness range, lowering DC current decisively beats pulsing at 1 A: analog dimming peaks at **93 lm/W** (near 180 lm, or ~0.16 A), up to **57% higher** luminous efficiency than PWM's nearly flat **59 lm/W** — with the analytical model tracking SPICE within 1%. PWM's curve stays flat because light output and average input power scale proportionally with duty cycle at the fixed 1 A operating point.

At low regulated current, the converter transitions naturally into **discontinuous conduction mode (DCM)**: each switching cycle transfers a smaller magnetic packet, inductor current returns to zero, and the stage idles while <var>C</var><sub>O</sub> sustains the string. Extending that idle interval gives the analytical model a 0–100% analog dimming range; in hardware, current-sense offset, noise, and the LED's minimum emission threshold bound the dim end.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/led-driver-dimming/luminous-efficiency.png' | relative_url }}" alt="Original IECON luminous-efficiency plot showing analog dimming peaking near 93 lumens per watt and PWM near 59 lumens per watt." width="1656" height="670" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>Fig. 9 — Luminous efficiency.</strong> Analog dimming climbs into the LED's higher-efficacy region (peaking at 93 lm/W near 180 lm) before fixed converter overhead pulls it down at very low flux; PWM remains flat near 59 lm/W, and model error stays under 1%. Source: <a href="https://rincon-mora.gatech.edu/publicat/cnfs/iecon21dim.pdf#page=2">IECON 2021</a>.</figcaption>
</figure>

<figure class="source-figure source-figure--table">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/led-driver-dimming/comparison-table.png' | relative_url }}" alt="Original IECON comparison table for analog, shutdown PWM, shunt-switched PWM, and series-switched PWM dimming." width="1766" height="786" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>Table I — Method comparison.</strong> Modeled luminous efficiency, switch overhead, rise-plus-fall transition time, dimming range, and added loss terms across the four schemes. Source: <a href="https://rincon-mora.gatech.edu/publicat/cnfs/iecon21dim.pdf#page=6">IECON 2021</a>.</figcaption>
</figure>

At ultra-low brightness, the crossover reverses: as optical output approaches zero, fixed controller and switching overhead dominates the denominator and pulls analog luminous efficiency down toward 45 lm/W, letting PWM edge ahead. Even at mid-brightness, PWM remains the right engineering choice whenever tight chromaticity stability (since LED color coordinates shift slightly with forward current) or extreme contrast ratio outweighs battery life. All values above come from analytical modeling and SPICE simulation of this 12 V, four-LED stage.

## Published work

- Vasu Gupta and Gabriel A. Rincón-Mora, ["Dimming DC–DC LED Drivers: Luminous Efficiency, Power Losses, & Best-in-Class,"](https://doi.org/10.1109/IECON48115.2021.9589840) IECON 2021 – 47th Annual Conference of the IEEE Industrial Electronics Society, pp. 1–6, 2021.
- Vasu Gupta, ["Dimming DC–DC LED Drivers: Power Losses, Luminous Efficiency & Best-in-Class,"](https://repository.gatech.edu/entities/publication/8d35e029-25b7-40ed-b7de-0392023dd439) M.S. thesis, School of Electrical and Computer Engineering, Georgia Institute of Technology, December 2021.

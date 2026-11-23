---
title: "LT83402: 42 V Low-Noise Buck Regulator"
institution: Analog Devices
period: "2025"
role: Chip lead
kind: project
featured: true
status: Released
date: 2026-09-04
summary: Leading a 42 V, 2.5 A ultra-low-noise buck regulator from concept to silicon release — and why its unity-gain SET reference keeps output noise to a few microvolts.
description: LT83402 chip leadership, how its unity-gain SET-current reference filters output noise, and Analog Devices' published noise and switch-node characterization.
image: /assets/projects/lt83402/lt83402-package.png
---

Switching regulators usually sit upstream of a low-dropout linear regulator (LDO) whenever a rail powers sensitive RF, precision analog, or sensor loads — because a conventional buck amplifies its internal reference noise and injects switching artifacts onto the rail. The [LT83402](https://www.analog.com/en/products/lt83402.html) is a 2.8–42 V, 2.5 A synchronous buck regulator in a 3 × 2 mm Silent Switcher 3 package engineered to deliver microvolt-level baseband noise directly from the switcher.

I led the chip from concept and design reviews through layout, validation, silicon debug, and release alongside colleagues across applications, validation, test, and qualification ([release post](https://www.linkedin.com/posts/vgmos_analogdevices-powerelectronics-lownoise-activity-7391518741676638208-qXI3)). Every curve and specification below comes from Analog Devices' published characterization.

<figure class="source-figure source-figure--compact">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/lt83402/lt83402-package.png' | relative_url }}" alt="Analog Devices illustration of the LT83402 package, showing its top and underside." width="1100" height="759" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>LT83402 package illustration.</strong> Source: <a href="https://www.analog.com/en/products/lt83402.html">Analog Devices</a>.</figcaption>
</figure>

## Why the SET-pin path stays quiet

In a conventional buck regulator, a resistive divider feeds a fraction of the output back to a fixed bandgap reference. That closed loop multiplies both the bandgap reference's noise and the error amplifier's input-referred noise by the noise gain <span class="math-inline">1 + <var>R</var><sub>1</sub>/<var>R</var><sub>2</sub></span> (on top of the divider's own thermal noise) — so stepping up the target output voltage directly raises output noise at the load.

The LT83402 removes that gain penalty across its unity-gain operating range (up to 15 V output) with a current-reference architecture. A precision 100 µA current out of the SET pin develops the target voltage directly across a single external resistor (<span class="math-inline"><var>R</var><sub>SET</sub> = 33.2 kΩ</span> for 3.3 V in Figure 59), and the loop senses <var>V</var><sub>OUT</sub> directly at OUTS so the output tracks SET at unity gain. Shunting <var>R</var><sub>SET</sub> with an external bypass capacitor <var>C</var><sub>SET</sub> forms a first-order RC low-pass filter right at the reference input, rolling off both the reference current's noise and <var>R</var><sub>SET</sub>'s thermal noise before they reach the error amplifier. A larger <var>C</var><sub>SET</sub> pushes that filter corner lower, at the cost of a slower natural charging ramp — which is why the IC adds fast start-up circuitry that temporarily boosts the SET current while <var>V</var><sub>OUT</sub> climbs (governed via PGFB in Figure 59). See the data sheet's [output-voltage setting](https://www.analog.com/media/en/technical-documentation/data-sheets/lt83401-lt83402.pdf#page=28) and [SET-capacitor guidance](https://www.analog.com/media/en/technical-documentation/data-sheets/lt83401-lt83402.pdf#page=32).

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/lt83402/lt83402-rev1-p38-fig59-application.png' | relative_url }}" alt="LT83402 application circuit with a 2.2 µH inductor, four 22 µF output capacitors, and a 1 µF SET capacitor." width="1042" height="540" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>3.3 V, 2.5 A application.</strong> The 2 MHz noise-test circuit: paired 1 µF input bypass capacitors flank the twin V<sub>IN</sub>/GND pins, a 33.2 kΩ resistor and 1 µF <var>C</var><sub>SET</sub> establish and filter the reference, and OUTS senses <var>V</var><sub>OUT</sub> directly at unity gain. Source: Analog Devices, <a href="https://www.analog.com/media/en/technical-documentation/data-sheets/lt83401-lt83402.pdf#page=38">LT83401/LT83402 Rev. 1, Figure 59</a>.</figcaption>
</figure>

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/lt83402/lt83402-rev1-p11-fig4-noise-load.png' | relative_url }}" alt="LT83402 noise-density curves versus frequency at 0 A, 1 A, and 2.5 A load, with integrated-noise values and test conditions shown." width="815" height="617" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>Noise across load.</strong> At 12 V input, 3.3 V output, 2 MHz, and 25 °C: 3.31, 3.32, and 2.80 µV RMS at 0, 1, and 2.5 A respectively, integrated over 10 Hz–100 kHz. Source: Analog Devices, <a href="https://www.analog.com/media/en/technical-documentation/data-sheets/lt83401-lt83402.pdf#page=11">Rev. 1, Figure 4</a>.</figcaption>
</figure>

Reading the spectral density from left to right traces each mechanism in frequency: the <span class="math-inline"><var>R</var><sub>SET</sub> · <var>C</var><sub>SET</sub></span> pole (near 4.8 Hz here) rolls low-frequency reference noise down to a ~3.5 nV/√Hz floor around 1–3 kHz; a modest hump rises near 30–60 kHz as closed-loop gain rolls off toward crossover; and the output capacitor bank pulls the density back down above 100 kHz. Integrating that squared density over 10 Hz–100 kHz captures baseband reference, amplifier, and loop noise — distinct from MHz switching ripple and radiated electromagnetic interference (EMI), which belong to high-frequency measurements.

## Comparing published 2 MHz noise against LT83205

The [LT83205](https://www.analog.com/en/products/lt83205.html) is a companion 18 V, 5 A Silent Switcher 3 buck regulator. Its published Figure 4 noise sweep shares the same 12 V input, 2 MHz switching frequency, 25 °C ambient, and 10 Hz–100 kHz integration band, offering a clear view of how external component choices reshape the curve.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/lt83402/lt83205-revc-p11-fig4-noise-load.png' | relative_url }}" alt="LT83205 noise-density curves at 0 A, 1 A, 3 A, and 5 A, with integrated-noise values and the 12 V input, 1 V output, 2 MHz test conditions." width="840" height="630" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>LT83205 noise across load.</strong> The Figure 60 circuit at 12 V input, 1 V output, and 2 MHz. Source: Analog Devices, <a href="https://www.analog.com/media/en/technical-documentation/data-sheets/lt83203-lt83205.pdf#page=11">LT83203/LT83205 Rev. C, Figure 4</a>.</figcaption>
</figure>

<p class="project-table__hint" id="noise-comparison-hint">Scroll horizontally to compare every column →</p>
<div class="project-table project-table--comparison" role="region" tabindex="0" aria-label="Published LT83402 and LT83205 noise at 2 MHz" aria-describedby="noise-comparison-hint">
  <table>
    <thead>
      <tr><th scope="col">Published noise example</th><th scope="col">LT83402, Figure 4</th><th scope="col">LT83205, Figure 4</th></tr>
    </thead>
    <tbody>
      <tr><th scope="row">Noise at 0 A</th><td>3.31 µV RMS</td><td>4.42 µV RMS</td></tr>
      <tr><th scope="row">Noise at 1 A</th><td>3.32 µV RMS</td><td>4.51 µV RMS</td></tr>
      <tr><th scope="row">Noise at rated load</th><td>2.80 µV RMS at 2.5 A</td><td>5.64 µV RMS at 5 A</td></tr>
      <tr><th scope="row">Input / output</th><td>12 V / 3.3 V</td><td>12 V / 1 V</td></tr>
      <tr><th scope="row">Switching frequency</th><td>2 MHz</td><td>2 MHz</td></tr>
      <tr><th scope="row">Inductor / nominal output capacitance</th><td>2.2 µH / 88 µF</td><td>0.47 µH / 183.4 µF</td></tr>
      <tr><th scope="row">SET capacitor</th><td>1 µF</td><td>2.2 µF</td></tr>
      <tr><th scope="row">Compensation <span class="math-inline"><var>R</var><sub>C</sub> / <var>C</var><sub>C</sub></span></th><td>1 kΩ / 4.7 nF</td><td>1.82 kΩ / 2.2 nF</td></tr>
    </tbody>
  </table>
</div>

Even with identical input voltage and switching frequency, the two benches regulate different outputs (3.3 V vs. 1 V) with different inductors, nominal output capacitances, SET bypass capacitors, and compensation networks (the LT83402 bench also includes an 82 pF high-frequency compensation capacitor, while the LT83205 values come from [Figure 60](https://www.analog.com/media/en/technical-documentation/data-sheets/lt83203-lt83205.pdf#page=38)). Because those external impedances shift both the SET filter corner and the closed-loop noise hump near crossover, the differing output voltages and components prevent a like-for-like noise ranking.

## Switch rising edges

Each time the high-side switch closes in CCM, current in the input "hot loop" steps sharply from zero to the inductor valley current. Any parasitic inductance in that loop converts fast <span class="math-inline">d<var>i</var>/d<var>t</var></span> into switch-node overshoot, high-frequency ringing, and radiated EMI; slowing the edge suppresses ringing, but widens the simultaneous voltage–current overlap and increases switching loss. Silent Switcher packaging splits the input bypass path into two symmetric halves (visible at the paired V<sub>IN</sub>/GND pins in Figure 59) so their opposing magnetic fields largely cancel, letting the switch node rise cleanly with minimal ringing.

The two published captures below zoom in on a single rising edge at 12 V input. Read them with their test conditions in mind: they are taken at different loads (2.5 A vs. 5 A) and different horizontal scales (2 ns/div vs. 5 ns/div), neither figure specifies switching frequency, and the time base frames the waveform rather than defining a rise-time specification.

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/lt83402/lt83402-rev1-p16-fig37-switch-rising-edge.png' | relative_url }}" alt="LT83402 switch-node rising-edge trace at 12 V input and 2.5 A load, with the original 2 ns/div and 2 V/div scales." width="810" height="595" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>LT83402 switch rising edge.</strong> 12 V input and 2.5 A load; 2 ns/div horizontally and 2 V/div vertically. Source: Analog Devices, <a href="https://www.analog.com/media/en/technical-documentation/data-sheets/lt83401-lt83402.pdf#page=16">Rev. 1, Figure 37</a>.</figcaption>
</figure>

<figure class="source-figure source-figure--wide">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/lt83402/lt83203-lt83205-revc-p16-fig38-switch-rising-edge.png' | relative_url }}" alt="LT83203/LT83205 family datasheet switch-node rising-edge trace at 12 V input and 5 A load, with the original 5 ns/div and 2 V/div scales." width="840" height="610" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>LT83203/LT83205 switch rising edge.</strong> 12 V input and 5 A load; 5 ns/div horizontally and 2 V/div vertically. Source: Analog Devices, <a href="https://www.analog.com/media/en/technical-documentation/data-sheets/lt83203-lt83205.pdf#page=16">Rev. C, Figure 38</a>.</figcaption>
</figure>

## Technical references

- Analog Devices, ["LT83401/LT83402: 42V, 1A/2.5A Step-Down Silent Switcher 3 with Ultra-Low Noise Reference,"](https://www.analog.com/media/en/technical-documentation/data-sheets/lt83401-lt83402.pdf) data sheet, Rev. 1, April 2026.
- Analog Devices, ["LT83203/LT83205: 18V, 3A/5A Step-Down Silent Switcher 3 with Ultra-Low Noise Reference,"](https://www.analog.com/media/en/technical-documentation/data-sheets/lt83203-lt83205.pdf) data sheet, Rev. C, January 2026.

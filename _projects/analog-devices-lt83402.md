---
title: "LT83402: 42 V Low-Noise Buck Regulator"
institution: Analog Devices
period: "2025"
role: Chip lead
kind: project
featured: true
status: Released
date: 2026-09-04
summary: My first chip release at Analog Devices.
description: Leading LT83402 from concept to release, with ADI's published application circuit, output-noise examples, and switch rising edge.
image: /assets/projects/lt83402/lt83402-package.png
---

I led the chip from concept and design reviews through layout, validation, silicon debugging, and release, working with colleagues across applications, validation, test, and qualification. [Release post](https://www.linkedin.com/posts/vgmos_analogdevices-powerelectronics-lownoise-activity-7391518741676638208-qXI3)

The [LT83402](https://www.analog.com/en/products/lt83402.html) is a synchronous buck regulator with a 2.8–42 V input range and a 2.5 A output-current rating. It uses Silent Switcher 3 in a 3 × 2 mm package.

<figure class="source-figure source-figure--compact source-figure--inspect-below">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/lt83402/lt83402-package.png' | relative_url }}" alt="Analog Devices illustration of the LT83402 package, showing its top and underside." width="1100" height="759" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>LT83402 package illustration.</strong> Source: <a href="https://www.analog.com/en/products/lt83402.html">Analog Devices</a>.</figcaption>
</figure>

## Output noise

<figure class="source-figure source-figure--wide source-figure--inspect-below">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/lt83402/lt83402-rev1-p38-fig59-application.png' | relative_url }}" alt="LT83402 application circuit with a 2.2 µH inductor, four 22 µF output capacitors, and a 1 µF SET capacitor." width="1042" height="540" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>3.3 V, 2.5 A application.</strong> The 2 MHz noise-test circuit. Source: Analog Devices, <a href="https://www.analog.com/media/en/technical-documentation/data-sheets/lt83401-lt83402.pdf#page=38">LT83401/LT83402 Rev. 1, Figure 59</a>.</figcaption>
</figure>

<figure class="source-figure source-figure--wide source-figure--inspect-below">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/lt83402/lt83402-rev1-p11-fig4-noise-load.png' | relative_url }}" alt="LT83402 noise-density curves versus frequency at 0 A, 1 A, and 2.5 A load, with integrated-noise values and test conditions shown." width="815" height="617" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>Noise across load.</strong> At 12 V input, 3.3 V output, 2 MHz, and 25 °C: 3.31, 3.32, and 2.80 µV RMS at 0, 1, and 2.5 A respectively, integrated over 10 Hz–100 kHz. Source: Analog Devices, <a href="https://www.analog.com/media/en/technical-documentation/data-sheets/lt83401-lt83402.pdf#page=11">Rev. 1, Figure 4</a>.</figcaption>
</figure>

The 10 Hz–100 kHz integral excludes MHz switching ripple and does not measure radiated EMI.

## LT83205 comparison at 2 MHz

The [LT83205](https://www.analog.com/en/products/lt83205.html) is an 18 V, 5 A buck regulator. Both noise examples use 12 V input, 2 MHz switching, and 25 °C ambient temperature, with noise integrated over 10 Hz–100 kHz. The output voltages and external components differ.

<figure class="source-figure source-figure--wide source-figure--inspect-below">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/lt83402/lt83205-revc-p11-fig4-noise-load.png' | relative_url }}" alt="LT83205 noise-density curves at 0 A, 1 A, 3 A, and 5 A, with integrated-noise values and the 12 V input, 1 V output, 2 MHz test conditions." width="840" height="630" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>LT83205 noise across load.</strong> The Figure 60 circuit at 12 V input, 1 V output, and 2 MHz. Source: Analog Devices, <a href="https://www.analog.com/media/en/technical-documentation/data-sheets/lt83203-lt83205.pdf#page=11">LT83203/LT83205 Rev. C, Figure 4</a>.</figcaption>
</figure>

<p class="project-table__hint" id="noise-comparison-hint">Scroll horizontally to compare every column →</p>
<div class="project-table" role="region" tabindex="0" aria-label="Published LT83402 and LT83205 noise at 2 MHz" aria-describedby="noise-comparison-hint">
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
      <tr><th scope="row">Compensation R<sub>C</sub> / C<sub>C</sub></th><td>1 kΩ / 4.7 nF</td><td>1.82 kΩ / 2.2 nF</td></tr>
    </tbody>
  </table>
</div>

The LT83402 circuit also includes an 82 pF compensation capacitor. LT83205 component values come from [the Figure 60 circuit](https://www.analog.com/media/en/technical-documentation/data-sheets/lt83203-lt83205.pdf#page=38). Capacitances are nominal; differing output voltages and components prevent a like-for-like noise ranking.

## Switch rising edges

Both traces use 12 V input. Loads and time scales differ, and neither figure specifies switching frequency. Horizontal scales are not rise-time specifications.

<figure class="source-figure source-figure--wide source-figure--inspect-below">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/lt83402/lt83402-rev1-p16-fig37-switch-rising-edge.png' | relative_url }}" alt="LT83402 switch-node rising-edge trace at 12 V input and 2.5 A load, with the original 2 ns/div and 2 V/div scales." width="810" height="595" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>LT83402 switch rising edge.</strong> 12 V input and 2.5 A load; 2 ns/div horizontally and 2 V/div vertically. Source: Analog Devices, <a href="https://www.analog.com/media/en/technical-documentation/data-sheets/lt83401-lt83402.pdf#page=16">Rev. 1, Figure 37</a>.</figcaption>
</figure>

<figure class="source-figure source-figure--wide source-figure--inspect-below">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/lt83402/lt83203-lt83205-revc-p16-fig38-switch-rising-edge.png' | relative_url }}" alt="LT83203/LT83205 family datasheet switch-node rising-edge trace at 12 V input and 5 A load, with the original 5 ns/div and 2 V/div scales." width="840" height="610" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>LT83203/LT83205 switch rising edge.</strong> 12 V input and 5 A load; 5 ns/div horizontally and 2 V/div vertically. Source: Analog Devices, <a href="https://www.analog.com/media/en/technical-documentation/data-sheets/lt83203-lt83205.pdf#page=16">Rev. C, Figure 38</a>.</figcaption>
</figure>

## Technical references

- Analog Devices, ["LT83401/LT83402: 42V, 1A/2.5A Step-Down Silent Switcher 3 with Ultra-Low Noise Reference,"](https://www.analog.com/media/en/technical-documentation/data-sheets/lt83401-lt83402.pdf) data sheet, Rev. 1, April 2026.
- Analog Devices, ["LT83203/LT83205: 18V, 3A/5A Step-Down Silent Switcher 3 with Ultra-Low Noise Reference,"](https://www.analog.com/media/en/technical-documentation/data-sheets/lt83203-lt83205.pdf) data sheet, Rev. C, January 2026.

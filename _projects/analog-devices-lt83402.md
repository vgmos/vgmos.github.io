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

## Output noise and switching edge

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

<figure class="source-figure source-figure--wide source-figure--inspect-below">
  <div class="source-figure__frame">
    <img src="{{ '/assets/projects/lt83402/lt83402-rev1-p16-fig37-switch-rising-edge.png' | relative_url }}" alt="LT83402 switch-node rising-edge trace at 12 V input and 2.5 A load, with the original 2 ns/div and 2 V/div scales." width="810" height="595" loading="lazy" decoding="async">
  </div>
  <figcaption><strong>Switch rising edge.</strong> 12 V input and 2.5 A load; 2 ns/div horizontally and 2 V/div vertically. The time scale is not a rise-time specification. Source: Analog Devices, <a href="https://www.analog.com/media/en/technical-documentation/data-sheets/lt83401-lt83402.pdf#page=16">Rev. 1, Figure 37</a>.</figcaption>
</figure>

## LT83203 comparison

The [LT83203](https://www.analog.com/en/products/lt83203.html) is an 18 V, 3 A buck regulator. These published examples use the same input, output, and noise bandwidth, but different switching frequencies and external components.

<p class="project-table__hint" id="noise-comparison-hint">Scroll horizontally to compare every column →</p>
<div class="project-table" role="region" tabindex="0" aria-label="Published LT83402 and LT83203 noise conditions" aria-describedby="noise-comparison-hint">
  <table>
    <thead>
      <tr><th scope="col">Published noise example</th><th scope="col">LT83402, Figure 4</th><th scope="col">LT83203, Table 1</th></tr>
    </thead>
    <tbody>
      <tr><th scope="row">Typical noise, 10 Hz–100 kHz</th><td>2.80 µV RMS</td><td>1.93 µV RMS</td></tr>
      <tr><th scope="row">Input / output</th><td>12 V / 3.3 V</td><td>12 V / 3.3 V</td></tr>
      <tr><th scope="row">Switching frequency</th><td>2 MHz</td><td>6 MHz</td></tr>
      <tr><th scope="row">Noise-test load</th><td>2.5 A</td><td>Not stated</td></tr>
      <tr><th scope="row">Inductor / nominal output capacitance</th><td>2.2 µH / 88 µF</td><td>0.47 µH / 130.4 µF</td></tr>
      <tr><th scope="row">SET capacitor</th><td>1 µF</td><td>4.7 µF</td></tr>
      <tr><th scope="row">Compensation R<sub>C</sub> / C<sub>C</sub></th><td>1 kΩ / 4.7 nF</td><td>3.01 kΩ / 560 pF</td></tr>
    </tbody>
  </table>
</div>

The LT83402 circuit also includes an 82 pF compensation capacitor. LT83203 values: [Rev. C, Table 1](https://www.analog.com/media/en/technical-documentation/data-sheets/lt83203-lt83205.pdf#page=4) and [Figure 61](https://www.analog.com/media/en/technical-documentation/data-sheets/lt83203-lt83205.pdf#page=39). These typical results use different circuits and operating points; they do not establish a device ranking.

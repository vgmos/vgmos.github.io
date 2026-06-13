---
title: Dimming DC-DC LED Drivers
institution: Georgia Tech
period: Fall 2020-Dec 2021
role: MS thesis researcher, first author
kind: project
featured: true
topics:
  - power IC
  - LED drivers
  - switched-inductor converters
  - dimming
status: MS thesis approved Dec 2021; IECON 2021 paper
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

So the design question becomes:

<figure class="tech-diagram led-system" aria-label="LED driver energy path">
  <div class="flow-row">
    <div class="flow-node source">
      <strong>12 V automotive input</strong>
      <span>cold crank, load dump, board-level constraints</span>
    </div>
    <div class="flow-arrow" aria-hidden="true">-></div>
    <div class="flow-node converter">
      <strong>Buck-boost SL driver</strong>
      <span>4.7 uH, 2 MHz, current regulation</span>
    </div>
    <div class="flow-arrow" aria-hidden="true">-></div>
    <div class="flow-node load">
      <strong>Four power LEDs</strong>
      <span>about 13.3 V at 1 A peak current</span>
    </div>
    <div class="flow-arrow" aria-hidden="true">-></div>
    <div class="flow-node light">
      <strong>Luminous flux</strong>
      <span>light per input watt, not just current</span>
    </div>
  </div>
  <figcaption>Brightness control has to be read through the whole chain: source, converter, LED load, and light output.</figcaption>
</figure>

In the thesis, I modeled a representative 12 V automotive buck-boost LED driver delivering up to 1 A into four CREE XP-E2 class LEDs. The analysis folded together the LED electro-optical curve, the LED I-V curve, converter efficiency, and SPICE validation. That let me compare dimming methods by luminous efficiency, power loss, and dimming range instead of by habit or datasheet folklore.

## Dimming Methods

The work compared analog dimming against three PWM variants.

<figure class="tech-diagram dimming-map" aria-label="Dimming techniques compared">
  <div class="dimming-method analog">
    <h3>Analog</h3>
    <p>Continuously regulate LED current. At low light, sparse inductor packets in DCM can make the average current very small.</p>
    <span>Best for efficiency over most of the range</span>
  </div>
  <div class="dimming-method shutdown">
    <h3>Shutdown PWM</h3>
    <p>Turn the power stage on and off at a much lower dimming frequency. The eye averages the pulses.</p>
    <span>Simple, but rise/fall time limits low dimming</span>
  </div>
  <div class="dimming-method shunt">
    <h3>Shunt PWM</h3>
    <p>Add a switch in parallel with the LEDs to discharge the output node faster during PWM off-time.</p>
    <span>Improves turn-off behavior with extra switch loss</span>
  </div>
  <div class="dimming-method series">
    <h3>Series PWM</h3>
    <p>Add a series switch and preserve the output-capacitor voltage so the LED current can reconnect quickly.</p>
    <span>Excellent dimming range, more circuitry</span>
  </div>
  <figcaption>All four methods can control brightness. They do not spend power the same way.</figcaption>
</figure>

The clean intuition is this: PWM keeps the LED biased at a high peak current and chops time. Because LED luminous flux saturates at high current, PWM pays a penalty for producing light at that peak operating point. Analog dimming moves the operating point itself. In this modeled driver, that removed a fundamental PWM power penalty across most of the useful light range.

## Result

The headline result was not "PWM is bad." PWM is useful, especially when color consistency, control simplicity, or a very high dimming ratio matter. The result was more precise: in this switched-inductor automotive setup, analog dimming gave the best luminous efficiency over most of the range and could theoretically cover the full 0-100% dimming span when DCM operation and sensing limits were handled well.

<div class="metric-strip" aria-label="Key project results">
  <div>
    <strong>up to 57%</strong>
    <span>higher luminous efficiency for analog dimming over PWM in the modeled range</span>
  </div>
  <div>
    <strong>0-100%</strong>
    <span>theoretical analog dimming range through CCM and DCM current control</span>
  </div>
  <div>
    <strong>1.5-5%</strong>
    <span>model-to-SPICE agreement for key power, light, and dimming-range checks</span>
  </div>
</div>

<table class="dimming-table">
  <caption>Comparison from the thesis and IECON analysis</caption>
  <thead>
    <tr>
      <th>Parameter</th>
      <th>Analog</th>
      <th>Shutdown PWM</th>
      <th>Shunt PWM</th>
      <th>Series PWM</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th>Luminous efficiency</th>
      <td>45-93 lm/W</td>
      <td>59 lm/W</td>
      <td>59 lm/W</td>
      <td>59 lm/W</td>
    </tr>
    <tr>
      <th>LED-current rise + fall time</th>
      <td>N/A</td>
      <td>&lt;= 100 us</td>
      <td>&lt;= 120 us</td>
      <td>&lt;= 10 ns</td>
    </tr>
    <tr>
      <th>Dimming range</th>
      <td>0-100%</td>
      <td>1-100%</td>
      <td>1.2-100%</td>
      <td>about 0-100%</td>
    </tr>
    <tr>
      <th>Shared converter loss</th>
      <td>0.18-1.4 W</td>
      <td>&lt;= 1.4 W</td>
      <td>&lt;= 1.4 W</td>
      <td>&lt;= 1.4 W</td>
    </tr>
    <tr>
      <th>PWM-specific loss</th>
      <td>none</td>
      <td>&lt;= 2.2 W</td>
      <td>&lt;= 2.2 W</td>
      <td>&lt;= 2.2 W</td>
    </tr>
    <tr>
      <th>Extra implementation cost</th>
      <td>current-sense accuracy at low light</td>
      <td>minimal</td>
      <td>extra shunt switch; capacitor and inductor energy loss</td>
      <td>extra series switch; output-voltage preservation</td>
    </tr>
  </tbody>
</table>

There is a useful caveat at the low end. When the output power is tiny, fixed switched-inductor losses can dominate, and PWM can briefly look better. That caveat is the point. A design engineer should not carry a rule of thumb farther than its operating region.

## What I Learned As A Designer

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

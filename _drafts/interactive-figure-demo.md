---
layout: post
title: Interactive Figure Demo
description: A draft demonstrating per-post scripts, math, code highlighting, and an interactive RC step-response figure.
tags:
  - technical
  - craft
scripts:
  - /js/figures/rc-step.js
math: true
---

This draft exists as a working pattern for future technical essays with small interactive figures.

<figure id="fig-rc-step" class="fig-interactive">
  <div class="fig-interactive__plot"></div>
  <figcaption class="quiet-note">Interactive figure loading.</figcaption>
</figure>

For a first-order RC circuit, the capacitor voltage after a unit step is:

$$
v_C(t) = V_f \left(1 - e^{-t / RC}\right)
$$

The same idea can be sketched as a behavioral block:

```verilog
module rc_step(
  input real vin,
  output real vout
);
  parameter real tau = 1.0e-3;

  analog begin
    vout <+ transition(vin, 0.0, tau);
  end
endmodule
```

And the numerical shape is easy to reproduce:

```python
import math

def vc(t, r, c, vf=1.0):
    tau = r * c
    return vf * (1 - math.exp(-t / tau))
```

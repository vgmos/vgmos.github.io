# Buck-loss v2 SPICE goldens

The committed JSON fixture is consumed by the normal unit suite, so contributors and CI do not need ngspice installed.

To regenerate it deliberately:

```sh
npm run data:buck-loss:spice:regenerate
```

Regeneration is pinned to ngspice 46. The script runs two steady-state CCM buck circuits with PWM duty found by a simulator-side output-voltage search, one ideal DCM triangular PWL integration, and one switching/recovery phase integration. It records the ngspice version, method, raw measurements, and review status in `tests/fixtures/buck-loss-spice-golden.v2.json`.

The output is byte-stable for a pinned simulator and source revision. It records a reviewed fixture revision instead of a wall-clock generation timestamp so two unchanged regeneration runs produce the same artifact.

The fixtures cover the plan's 3% waveform/static-term, 15% switching/recovery, 8% aggregate-loss, and one-percentage-point efficiency gates. They are analytical cross-checks, not transistor-model or part-signoff simulations.

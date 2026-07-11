# Buck-loss v2.1 SPICE verification

The buck-loss checks deliberately keep two evidence lanes separate:

1. `tests/fixtures/buck-loss-spice-golden.v3.json` is the independent switched-topology reference generated with ngspice 46.
2. `tests/fixtures/buck-loss-vendor-*.v2.json` records bounded, local characterization of hash-locked vendor models in native LTspice 17.0.38.

Both sets of JSON reports are committed and covered by the ordinary unit suite. Contributors and CI can therefore validate their structure and results without installing either simulator or downloading a vendor model.

## Independent topology goldens (v3)

The v3 fixture contains 15 switched-buck cases across 12 V to 3.3 V and 48 V to 12 V operation. The matrix exercises DCM and CCM on both sides of the zero-current boundary, dead-time variation, full-load operation, and a forced-CCM negative-current warning case. Separate simulator-side searches cover zero-current onset and dropout onset.

`analyticalIdentityChecks` contains formula-generated PWL integrations for the ideal DCM triangle and textbook transition-phase energy. These are intentionally labeled `formula-integration-identity`; they test integration identities and are never promoted to independent topology, loss, or efficiency evidence.

The committed acceptance policy is:

- 3% relative for waveform quantities and individual comparable static-loss terms;
- 8% relative for the aggregate comparable static-loss subset;
- one percentage point absolute for the known-static-subset efficiency;
- near-zero absolute floors of 5 mA current, 0.2 mA dead-path current, 0.005 duty fraction, 5 mV voltage, 0.2 mW individual/dead-path static loss, and 1 mW aggregate loss.

The floors prevent a harmless numerical residue near zero from becoming an unbounded relative error. In the forced-negative CCM case, current moments, non-commutation static terms, aggregate static loss, and efficiency remain hard-gated. The commanded high/low duty split and the signed/RMS dead-path quantities remain characterization-only because the analytical model does not resolve the high-side reverse-path commutation volt-seconds.

Regenerate or byte-verify the v3 fixture with the pinned ngspice version:

```sh
npm run data:buck-loss:spice:regenerate
npm run data:buck-loss:spice:verify
```

The output is byte-stable for the pinned simulator and source revision. It records a fixture revision rather than a wall-clock generation timestamp.

## Hash-locked vendor-model characterization

`vendor-models.lock.json` pins two official libraries without redistributing them:

- EPC2090, EPC LTspice library version 1.104;
- Infineon BSC010N04LS6, OptiMOS 6 library version 280225, subcircuit `BSC010N04LS6_L1`.

The lock records the official product/download URLs, archive and extracted-library SHA-256 hashes, subcircuit name and pin order, retrieval date, simulator version, and any required directive. It also contains immutable datasheet identities and page/table locations, exact published conditions and values, project comparison limits, and the strict coverage list. Reports copy those contracts verbatim so the simulator cannot silently move to an easier bias point. The Infineon run includes `.options Thev_Induc=1`; omitting it changes the package-inductor treatment and invalidates the characterization.

Vendor archives and extracted libraries live only under the ignored `.cache/buck-loss/vendor-models/` directory. Acquire the default Infineon model from the official archive with:

```sh
npm run data:buck-loss:spice:vendor:acquire
```

Acquire EPC explicitly with:

```sh
npm run data:buck-loss:spice:vendor:acquire -- --id epc2090-ltspice-v1.104
```

If an official community/download endpoint returns HTTP 403 to the command-line client, download the unchanged archive in a browser and pass it locally. The archive is still accepted only when its locked hash matches:

```sh
npm run data:buck-loss:spice:vendor:acquire -- \
  --id epc2090-ltspice-v1.104 \
  --archive /path/to/EPCGaNLibrary.zip

npm run data:buck-loss:spice:vendor:acquire -- \
  --id infineon-bsc010n04ls6-280225 \
  --archive /path/to/OptiMOS6_40V_Spice.zip
```

Infineon uses the locked library unchanged. The EPC archive contains one known, indented prose line in its header that LTspice interprets as a continuation statement. Adapter revision 1 comments only that exact non-electrical header line. The runner refuses to adapt a different source, and the resulting adapter hash and label are recorded in the committed report.

The v2 vendor reports force the published current, voltage, gate-bias, and temperature conditions wherever the scalar datasheet contract is reproducible. Both models receive exact-condition RDS(on), VSD, total QG, and QOSS comparisons. EPC additionally receives an EOSS comparison against `0.5 × COSS(ER) × VDS²`; Infineon has no scalar EOSS/COSS(ER) counterpart and retains a reviewed energy record instead. Every comparison commits the measured value, typical/max values, relative delta, policy limit, and pass result. RDS(on), VSD, QOSS, and EOSS each retain a repeated baseline and a half-timestep run; their 0.5% repeat and 2% half-step checks are ordinary native-verification gates.

Gate charge uses a constant-gate-current, clamped-drain fixture with a committed 1 ns coarse point, 0.5 ns baseline/repeat, and 0.25 ns refined point. Current stays constant through the selected VGS crossing, then tapers to zero over a 20 mV margin. Every run asserts final VGS remains inside the selected 15% tolerance and the device absolute maximum; the post-measurement fixture therefore cannot overdrive the gate. The reports retain all measurements and netlist hashes. Infineon total QG passes the 2% half-step gate and its published-typical policy. EPC total QG remains timestep-unstable and is therefore strict-coverage unsupported even though its 0.5 ns scalar happens to lie inside the typical-value policy. QGS/QGD use disclosed 99%/1% drain-transition proxies; the vendor extraction thresholds are unpublished, so those values are reviewed attempts and never badge evidence.

Infineon reverse recovery uses a bounded L1 current-slope fixture at the published VR, IF, and dIF/dt. Its repeat/half-step results are reproducible, but the QOSS-subtracted commutation charge is not promoted to datasheet-equivalent QRR without the vendor double-pulse fixture and extraction procedure. EPC QRR is explicitly `not-applicable`: EPC specifies a majority-carrier reverse path and zero QRR, so the runner does not execute a silicon minority-carrier recovery test.

Separate turn-on/turn-off windows, commanded dead-window energy, QOSS/EOSS, and full-buck behavior are committed as reviewed characterization. Where a valid analytical counterpart exists, the report records its delta: exact scalar datasheet comparisons, EPC COSS(ER)-derived EOSS, ideal volt-second duty, and on-interval inductor ripple. Edge/dead-time energies without a published counterpart stay labeled as such. Dead-window values are signed terminal energy: a negative value means energy returned to the fixture, not negative dissipated loss.

Both reports now include a bounded 12 V to 3.3 V full-buck run with repeat, half-timestep, steady-window, KCL, and energy-balance checks. EPC executes its locked primary `EPC2090` model. The detailed Infineon `BSC010N04LS6_L1` half-bridge did not converge under hard commutation, so the full-buck lane separately executes the official simplified, standard-SPICE-compatible `BSC010N04LS6_L0` fallback; L1 remains the source for the static, terminal, and single-device characterizations. The lock and report preserve both Infineon pin contracts so the L0 result cannot be mistaken for L1 full-buck validation. Raw switch-node extrema are retained as timestep-sensitive diagnostics and do not enter the half-step quality gate.

The ordinary native verification gate checks byte stability, finite values, repeatability, the accepted switching/full-buck half-step checks, steady windows, series-current consistency, and fixture energy balance. Gate-charge half-step results remain in `qualityGates` but are release-only so an honest unsupported report can still be reproduced and committed. The independent v3 topology cases remain the source for the application model's application-level waveform and comparable static-loss gates.

`coverageComplete`, `badgeEligible`, and `releaseGate` are fail-closed. At this revision both reports intentionally remain ineligible: Infineon lacks datasheet-equivalent partitioned QGS/QGD and QRR coverage; EPC has unstable total QG, non-equivalent QGS/QGD proxies, and a VSD policy mismatch. The release-only command runs the complete topology/native/committed verification first and then exits nonzero while any strict requirement remains unsupported or failed:

```sh
npm run test:spice:release
```

With both archives already acquired, regenerate or verify the native-LTspice reports with:

```sh
npm run data:buck-loss:spice:vendor:regenerate
npm run data:buck-loss:spice:vendor:verify
```

These commands require LTspice 17.0.38 at the locked macOS executable path. They execute both EPC and Infineon reports. `verify` reruns the characterization, requires the ordinary verification gate to pass, and compares the result byte-for-byte with the committed v2 report. It does not grant the stricter badge.

## Test commands

```sh
# Committed JSON checks only; no simulator or vendor download required
npm run test:spice:committed

# Full regeneration/verification path; requires ngspice 46, LTspice 17.0.38,
# and both hash-locked archives in the local cache
npm run test:spice
```

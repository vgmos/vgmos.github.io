#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateBuckLossBenchmarkFixtureV2,
  expectedBuckLossBenchmarkV1
} from "../../js/tools/buck-loss-benchmark-v2.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
export const FIXTURE_PATH = resolve(root, "tests/fixtures/buck-loss-benchmark-ti-tps40071evm.v1.json");
export const ARTIFACT_PATH = resolve(root, "design-research/buck-loss-ti-tps40071-benchmark.artifact.json");
const GENERATED_AT = "2026-07-11T12:00:00Z";

const round = (value, digits = 4) => {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
};

const signed = (value, digits = 2, unit = "") => `${value >= 0 ? "+" : ""}${value.toFixed(digits)}${unit}`;

function reportRows(analysis) {
  return analysis.lanes.flatMap((lane) => lane.rows.map((row) => ({
    id: row.id,
    laneId: lane.id,
    lane: lane.label,
    vinV: row.vin,
    voutV: row.vout,
    loadA: row.iout,
    measuredEfficiencyPct: round(row.measuredEfficiencyPercent),
    calculatedEfficiencyPct: round(row.predictedEfficiencyPercent),
    efficiencyErrorPp: round(row.efficiencyErrorPp),
    measuredLossW: round(row.measuredLossW, 6),
    calculatedKnownLossW: round(row.predictedKnownLossW, 6),
    lossErrorW: round(row.lossErrorW, 6),
    lossErrorPct: round(row.lossErrorPercent),
    availability: row.availability,
    omitted: row.omitted.join(", "),
    waveformMode: row.waveformMode,
    ripplePpA: round(row.ripplePpA),
    rdsHighMohm: round(row.rdsHighOhm * 1e3),
    gateDriveV: row.gateDriveV
  })));
}

function curveRows(rows, valueKind) {
  return rows.flatMap((row) => {
    if (valueKind === "efficiency") {
      return [
        { loadA: row.loadA, series: "TI measured", value: row.measuredEfficiencyPct, vinV: row.vinV, laneId: "measured", measuredLossW: row.measuredLossW },
        { loadA: row.loadA, series: "25 °C ceiling", value: row.calculatedEfficiencyPct, vinV: row.vinV, laneId: "nominal-25c", measuredLossW: row.measuredLossW }
      ];
    }
    return [
      { loadA: row.loadA, series: "TI total", value: row.measuredLossW, vinV: row.vinV, laneId: "measured", measuredEfficiencyPct: row.measuredEfficiencyPct },
      { loadA: row.loadA, series: "25 °C subtotal", value: row.calculatedKnownLossW, vinV: row.vinV, laneId: "nominal-25c", measuredEfficiencyPct: row.measuredEfficiencyPct }
    ];
  });
}

function traceSummaryRows(analysis) {
  return analysis.lanes.flatMap((lane) => lane.traceResults.map((trace) => ({
    laneId: lane.id,
    lane: lane.label,
    vinV: trace.vin,
    points: trace.summary.pointCount,
    efficiencyMaePp: round(trace.summary.efficiencyMaePp),
    worstEfficiencyErrorPp: round(trace.summary.efficiencyWorstAbsPp),
    signedBiasPp: round(trace.summary.efficiencySignedBiasPp),
    curveShapeMaePp: round(trace.summary.curveShapeMaePp),
    medianAbsLossErrorPct: round(trace.summary.medianAbsLossErrorPercent),
    result: trace.summary.pass ? "PASS" : "FAIL"
  })));
}

function source(id, label, path, href) {
  return { id, label, path, href };
}

function reconciliationSql(rows) {
  const values = rows.map((row) => (
    `    ('${row.laneId}', ${row.vinV}, ${row.loadA}, ${row.measuredEfficiencyPct}, ` +
    `${row.calculatedEfficiencyPct}, ${row.measuredLossW}, ${row.calculatedKnownLossW})`
  ));
  return [
    "WITH benchmark_points(lane_id, vin_v, load_a, measured_efficiency_pct, calculated_efficiency_pct, measured_loss_w, calculated_known_loss_w) AS (",
    "  VALUES",
    values.join(",\n"),
    ")",
    "SELECT",
    "  lane_id, vin_v, load_a, measured_efficiency_pct, calculated_efficiency_pct,",
    "  calculated_efficiency_pct - measured_efficiency_pct AS efficiency_error_pp,",
    "  measured_loss_w, calculated_known_loss_w,",
    "  calculated_known_loss_w - measured_loss_w AS loss_error_w,",
    "  100.0 * (calculated_known_loss_w - measured_loss_w) / measured_loss_w AS loss_error_pct",
    "FROM benchmark_points",
    "ORDER BY lane_id, vin_v, load_a;"
  ].join("\n");
}

export function buildBenchmarkArtifact(fixture, analysis) {
  const rows = reportRows(analysis);
  const nominalRows = rows.filter((row) => row.laneId === "nominal-25c");
  const hotRows = rows.filter((row) => row.laneId === "hot-rds-bound");
  const nominal12 = nominalRows.filter((row) => row.vinV === 12);
  const hot12 = hotRows.filter((row) => row.vinV === 12);
  const nominal8 = nominalRows.filter((row) => row.vinV === 8);
  const nominal5 = nominalRows.filter((row) => row.vinV === 5);
  const curve12Efficiency = curveRows(nominal12, "efficiency");
  const curve12Loss = curveRows(nominal12, "loss");
  hot12.forEach((row) => {
    curve12Efficiency.push({ loadA: row.loadA, series: "1.3× RDS ceiling", value: row.calculatedEfficiencyPct, vinV: 12, laneId: row.laneId, measuredLossW: row.measuredLossW });
    curve12Loss.push({ loadA: row.loadA, series: "1.3× RDS subtotal", value: row.calculatedKnownLossW, vinV: 12, laneId: row.laneId, measuredEfficiencyPct: row.measuredEfficiencyPct });
  });
  const nominalError = nominalRows.map((row) => ({
    loadA: row.loadA,
    series: `VIN = ${row.vinV} V`,
    vinV: row.vinV,
    efficiencyErrorPp: row.efficiencyErrorPp,
    measuredEfficiencyPct: row.measuredEfficiencyPct,
    calculatedEfficiencyPct: row.calculatedEfficiencyPct,
    measuredLossW: row.measuredLossW,
    calculatedKnownLossW: row.calculatedKnownLossW
  }));
  const primary = analysis.lanes.find((lane) => lane.id === analysis.primaryLaneId);
  const overall = primary.overall;
  const at = (set, load) => set.find((row) => row.loadA === load);
  const low12 = at(nominal12, 2);
  const high12 = at(nominal12, 10);
  const mid8 = at(nominal8, 5);
  const high5 = at(nominal5, 8);
  const resultWord = analysis.acceptance.pass ? "passes" : "fails";
  const resultUpper = analysis.acceptance.status.toUpperCase();
  const measurement = fixture.sources.measurement;
  const calculationSource = source(
    "benchmark_calculation",
    "TI curve extraction and buck-loss v2.2 calculation",
    "tests/fixtures/buck-loss-benchmark-ti-tps40071evm.v1.json",
    measurement.url
  );
  const calculationSourceDetailed = {
    ...calculationSource,
    query: {
      engine: "sqlite",
      language: "sql",
      sql: reconciliationSql(rows),
      description: "Reconciles the reviewed point records produced by the committed Node model run and derives report error fields.",
      executed_at: GENERATED_AT,
      tables_used: [
        "benchmark_points (inline reviewed records generated from tests/fixtures/buck-loss-benchmark-ti-tps40071evm.v1.json)"
      ],
      filters: ["VOUT = 3.3 V", "IOUT = 2-10 A inclusive", "VIN in {5 V, 8 V, 12 V}", "Primary acceptance lane = nominal-25c"],
      metric_definitions: [
        "Measured loss = VOUT × IOUT × (1 / measured efficiency - 1)",
        "Efficiency error = calculated known-loss efficiency ceiling - TI measured total efficiency, in percentage points",
        "Loss error percent = (calculated known-loss subtotal - measured total loss) / measured total loss × 100",
        "Strict pass requires every VIN trace and the combined primary lane to satisfy all three committed thresholds",
        "Mechanism validation accepts only direct measured or instrument-derived family-loss evidence; modeled decompositions are ineligible"
      ]
    }
  };
  const tiSource = source("ti_evm_guide", `${measurement.publisher} ${measurement.documentId}`, measurement.documentId, measurement.url);
  const vishay = fixture.sources.mosfet;
  const vishaySource = source("vishay_si7860dp", `${vishay.publisher} ${vishay.documentId}`, vishay.documentId, vishay.url);
  const traceSummaries = traceSummaryRows(analysis);
  const overallSummary = [{
    result: resultUpper,
    efficiencyMaePp: round(overall.efficiencyMaePp),
    efficiencyWorstAbsPp: round(overall.efficiencyWorstAbsPp),
    medianAbsLossErrorPct: round(overall.medianAbsLossErrorPercent),
    pointCount: overall.pointCount
  }];

  return {
    surface: "report",
    manifest: {
      version: 1,
      surface: "report",
      title: "TI TPS40071EVM Buck-Loss Benchmark",
      description: "Measured-versus-calculated efficiency and known power loss for a discrete synchronous buck converter.",
      generatedAt: GENERATED_AT,
      cards: [
        {
          id: "efficiency_mae",
          dataset: "overall_summary",
          sourceId: "benchmark_calculation",
          description: "Mean absolute efficiency error across all 27 nominal-lane points from 2 A through 10 A.",
          metrics: [{ label: "Efficiency MAE", field: "efficiencyMaePp", format: "number" }]
        },
        {
          id: "worst_efficiency_error",
          dataset: "overall_summary",
          sourceId: "benchmark_calculation",
          description: "Largest absolute nominal-lane efficiency error; the strict threshold is 1.5 percentage points.",
          metrics: [{ label: "Worst error", field: "efficiencyWorstAbsPp", format: "number" }]
        },
        {
          id: "median_loss_error",
          dataset: "overall_summary",
          sourceId: "benchmark_calculation",
          description: "Median absolute relative error between the modeled known-loss subtotal and measured total loss.",
          metrics: [{ label: "Median loss error", field: "medianAbsLossErrorPct", format: "number" }]
        }
      ],
      charts: [
        {
          id: "efficiency_12v",
          title: "12 V input efficiency across load",
          subtitle: "TI measured total efficiency versus nominal and hot-RDS(on) calculator ceilings, 3.3 V output and 300 kHz.",
          type: "line",
          dataset: "curve_12v_efficiency",
          sourceId: "benchmark_calculation",
          xAxisTitle: "Output current (A)",
          yAxisTitle: "Efficiency (%)",
          unit: "%",
          encodings: {
            x: { field: "loadA", type: "quantitative", label: "Output current" },
            y: { field: "value", type: "quantitative", label: "Efficiency" },
            color: { field: "series", type: "nominal", label: "Series" },
            tooltip: [
              { field: "vinV", type: "quantitative", label: "Input voltage" },
              { field: "measuredLossW", type: "quantitative", label: "Measured loss" }
            ]
          }
        },
        {
          id: "loss_12v",
          title: "12 V input power loss across load",
          subtitle: "Measured board total versus modeled known-loss subtotal; the calculator traces are not complete total-loss estimates.",
          type: "line",
          dataset: "curve_12v_loss",
          sourceId: "benchmark_calculation",
          xAxisTitle: "Output current (A)",
          yAxisTitle: "Power loss (W)",
          unit: "W",
          encodings: {
            x: { field: "loadA", type: "quantitative", label: "Output current" },
            y: { field: "value", type: "quantitative", label: "Power loss" },
            color: { field: "series", type: "nominal", label: "Series" },
            tooltip: [{ field: "measuredEfficiencyPct", type: "quantitative", label: "Measured efficiency" }]
          }
        },
        {
          id: "nominal_error",
          title: "Nominal efficiency error by input voltage",
          subtitle: "Calculated efficiency minus TI measured efficiency; positive values overstate efficiency.",
          type: "line",
          dataset: "nominal_error",
          sourceId: "benchmark_calculation",
          xAxisTitle: "Output current (A)",
          yAxisTitle: "Efficiency error (percentage points)",
          unit: "pp",
          referenceLines: [{ axis: "y", value: 0, label: "No error" }],
          encodings: {
            x: { field: "loadA", type: "quantitative", label: "Output current" },
            y: { field: "efficiencyErrorPp", type: "quantitative", label: "Efficiency error" },
            color: { field: "series", type: "nominal", label: "Input voltage" },
            tooltip: [
              { field: "measuredEfficiencyPct", type: "quantitative", label: "Measured efficiency" },
              { field: "calculatedEfficiencyPct", type: "quantitative", label: "Calculated efficiency" },
              { field: "measuredLossW", type: "quantitative", label: "Measured loss" },
              { field: "calculatedKnownLossW", type: "quantitative", label: "Known-loss subtotal" }
            ]
          }
        }
      ],
      tables: [
        {
          id: "trace_summary",
          title: "Accuracy metrics by input voltage and temperature lane",
          subtitle: "Nine load points per trace, 2-10 A; only the 25 °C nominal lane controls acceptance.",
          dataset: "trace_summary",
          sourceId: "benchmark_calculation",
          density: "comfortable",
          defaultSort: { field: "vinV", direction: "asc" },
          columns: [
            { field: "lane", label: "Lane", type: "text" },
            { field: "vinV", label: "VIN", format: "number", unit: "V" },
            { field: "efficiencyMaePp", label: "Efficiency MAE", format: "number", unit: "pp" },
            { field: "worstEfficiencyErrorPp", label: "Worst error", format: "number", unit: "pp" },
            { field: "medianAbsLossErrorPct", label: "Median |loss error|", format: "number", unit: "%" },
            { field: "result", label: "Strict result", type: "text" }
          ]
        },
        {
          id: "nominal_point_detail",
          title: "Nominal point-by-point comparison",
          subtitle: "TI total efficiency/loss and calculator known-loss ceiling/subtotal at the same operating points.",
          dataset: "nominal_point_detail",
          sourceId: "benchmark_calculation",
          density: "compact",
          defaultSort: { field: "vinV", direction: "asc" },
          columns: [
            { field: "vinV", label: "VIN", format: "number", unit: "V" },
            { field: "loadA", label: "Load", format: "number", unit: "A" },
            { field: "measuredEfficiencyPct", label: "TI efficiency", format: "number", unit: "%" },
            { field: "calculatedEfficiencyPct", label: "Calculated ceiling", format: "number", unit: "%" },
            { field: "measuredLossW", label: "TI total loss", format: "number", unit: "W" },
            { field: "calculatedKnownLossW", label: "Known-loss subtotal", format: "number", unit: "W" }
          ]
        }
      ],
      sources: [calculationSourceDetailed, tiSource, vishaySource],
      blocks: [
        { id: "title", type: "markdown", body: "# TI TPS40071EVM Buck-Loss Benchmark" },
        {
          id: "technical_summary",
          type: "markdown",
          sourceId: "benchmark_calculation",
          body: [
            "## The strict hardware benchmark fails, but the mismatch is strongly load-dependent",
            "",
            `- **Result: ${resultUpper}.** The nominal model ${resultWord} the locked ≤1.0 pp MAE, ≤1.5 pp worst-error, and ≤20% median-loss-error policy when every input-voltage trace must pass.`,
            `- Across all 27 nominal points, efficiency MAE is **${overall.efficiencyMaePp.toFixed(2)} pp**, worst-case error is **${overall.efficiencyWorstAbsPp.toFixed(2)} pp**, and median absolute loss error is **${overall.medianAbsLossErrorPercent.toFixed(1)}%**.`,
            `- At 12 V and 10 A, the model is close: ${high12.calculatedEfficiencyPct.toFixed(2)}% calculated versus ${high12.measuredEfficiencyPct.toFixed(2)}% measured, with ${signed(high12.lossErrorPct, 1, "%")} known-loss error. At 2 A it overstates efficiency by ${low12.efficiencyErrorPp.toFixed(2)} pp.`,
            "- The comparison validates the calculator as an auditable loss subtotal, not yet as a strict full-board efficiency predictor.",
            `- Mechanism validation is **${analysis.mechanismValidation.status}**: TI Figure 5-3 supplies total efficiency only, not direct conduction, transition, dead-time, magnetic, or gate-drive loss measurements.`
          ].join("\n")
        },
        { id: "headline_metrics", type: "metric-strip", cardIds: ["efficiency_mae", "worst_efficiency_error", "median_loss_error"] },
        {
          id: "finding_12v_efficiency",
          type: "markdown",
          sourceId: "benchmark_calculation",
          body: [
            "## The 12 V trace converges at high load but misses fixed loss at low load",
            "",
            `At 10 A the nominal prediction is within ${Math.abs(high12.efficiencyErrorPp).toFixed(2)} pp of TI. At 2 A, the calculated ${low12.calculatedEfficiencyPct.toFixed(2)}% ceiling is ${low12.efficiencyErrorPp.toFixed(2)} pp above the measured curve. The widening low-load gap is consistent with omitted fixed or weakly current-dependent terms, but the published curve alone cannot identify their individual causes.`
          ].join("\n")
        },
        { id: "efficiency_12v_chart", type: "chart", chartId: "efficiency_12v" },
        {
          id: "finding_12v_loss",
          type: "markdown",
          sourceId: "benchmark_calculation",
          body: [
            "## Measured total loss exposes what the known-loss subtotal cannot cover",
            "",
            `At 2 A, TI's inferred total loss is ${low12.measuredLossW.toFixed(3)} W versus ${low12.calculatedKnownLossW.toFixed(3)} W modeled. By 10 A the values converge to ${high12.measuredLossW.toFixed(3)} W measured and ${high12.calculatedKnownLossW.toFixed(3)} W modeled. The hot-RDS(on) lane is a sensitivity bound, not a fitted correction.`
          ].join("\n")
        },
        { id: "loss_12v_chart", type: "chart", chartId: "loss_12v" },
        {
          id: "finding_cross_vin",
          type: "markdown",
          sourceId: "benchmark_calculation",
          body: [
            "## The residual changes sign with input voltage, so one fitted offset would be misleading",
            "",
            `The 8 V trace is nearly exact at 5 A (${signed(mid8.efficiencyErrorPp, 2, " pp")}) but overstates efficiency at low load. The 5 V trace instead becomes pessimistic through mid/high load; at 8 A its error is ${signed(high5.efficiencyErrorPp, 2, " pp")}. This pattern points to condition-dependent gate drive, transition, and resistance assumptions rather than a single missing constant loss.`
          ].join("\n")
        },
        { id: "nominal_error_chart", type: "chart", chartId: "nominal_error" },
        {
          id: "scope_definitions",
          type: "markdown",
          body: [
            "## Scope and metric definitions",
            "",
            "The benchmark uses TI Figure 5-3 at 3.3 V output, 300 kHz, and 2-10 A for 5 V, 8 V, and 12 V input. Published curve efficiency is converted to measured total loss as `VOUT × IOUT × (1 / η - 1)`. Calculator loss is the sum of known modeled terms; because `COSS(ER)` and inductor AC/core loss are unavailable, calculated efficiency is a known-loss ceiling. Error is calculated minus measured, in percentage points for efficiency and percent of measured total loss for power loss."
          ].join("\n")
        },
        { id: "trace_summary_table", type: "table", tableId: "trace_summary" },
        {
          id: "methodology",
          type: "markdown",
          body: [
            "## Method: published vectors, disclosed adaptations, no curve fitting",
            "",
            "The 27 measurements come from the vector centerlines embedded in TI Figure 5-3, calibrated against every integer axis gridline. The fixture retains the source document hash and a ±0.1 pp publication/readout uncertainty. The symmetric Si7860DP pair uses TI's 8 mΩ design value, Vishay measured charge/diode data, derived gate-path timing, and a disclosed triangular recovery-charge proxy. The 5 V case uses Vishay's measured 9 mΩ value at 4.5 V gate drive. The second lane changes only both MOSFET resistances by TI's documented 1.3 temperature factor. No parameter is fitted to measured efficiency."
          ].join("\n")
        },
        { id: "nominal_detail_table", type: "table", tableId: "nominal_point_detail" },
        {
          id: "limitations",
          type: "markdown",
          body: [
            "## Limitations and robustness checks",
            "",
            "Both model lanes remain subtotals because switch-node energy and magnetic AC/core loss are unavailable. Adaptive dead time, the populated 2.2 nF switch-node snubber, PCB/package resistance, ringing, bootstrap loss, and DBP linear-regulator overhead are outside coverage. The source figure supplies typical curves but no raw instrument readings, board temperature, laboratory uncertainty, or per-mechanism calorimetry/waveform energy. Consequently, total-loss residuals may diagnose load/voltage shape but cannot validate the modeled family decomposition. Data-quality checks confirm 27 unique in-axis points and reproduce TI's stated 96% 8 V result within the ±0.1 pp readout band. The 1.3×-RDS(on) lane tests thermal sensitivity without pretending to solve junction temperature."
          ].join("\n")
        },
        {
          id: "next_steps",
          type: "markdown",
          body: [
            "## Recommended next steps",
            "",
            "1. Add an explicit controller gate-regulator loss term so `Qg × VIN × fSW` can be reconciled with the present `Qg × VDRIVE × fSW` device term.",
            "2. Add source-qualified `EOSS` or `COSS(ER)` and characterize the DXM1306-1R6 AC/core loss before tightening low-load acceptance.",
            "3. Re-run the locked fixture after each model change; improve the strict result without adding a tuned residual or weakening the published thresholds."
          ].join("\n")
        },
        {
          id: "further_questions",
          type: "markdown",
          body: [
            "## Further questions",
            "",
            "Would raw TI bench readings, board temperatures, or the original DXM1306-1R6 characterization change the low-load attribution? Can a second discrete ADI or MPS reference design reproduce the same residual shape, or is it specific to TPS40071 predictive gate drive?"
          ].join("\n")
        }
      ]
    },
    snapshot: {
      version: 1,
      generatedAt: GENERATED_AT,
      status: "ready",
      datasets: {
        overall_summary: overallSummary,
        curve_12v_efficiency: curve12Efficiency,
        curve_12v_loss: curve12Loss,
        nominal_error: nominalError,
        trace_summary: traceSummaries,
        nominal_point_detail: nominalRows
      },
      accessIssues: []
    },
    sources: [calculationSourceDetailed, tiSource, vishaySource]
  };
}

export function loadBenchmarkFixture() {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function generatedState(fixture) {
  const analysis = evaluateBuckLossBenchmarkFixtureV2(fixture);
  return {
    analysis,
    expected: expectedBuckLossBenchmarkV1(analysis),
    artifact: buildBenchmarkArtifact(fixture, analysis)
  };
}

function printReceipt(analysis) {
  const primary = analysis.lanes.find((lane) => lane.id === analysis.primaryLaneId);
  process.stdout.write(`${JSON.stringify({
    fixture: analysis.fixtureId,
    modelRevision: analysis.modelRevision,
    status: analysis.acceptance.status,
    pointCount: primary.overall.pointCount,
    efficiencyMaePp: round(primary.overall.efficiencyMaePp),
    efficiencyWorstAbsPp: round(primary.overall.efficiencyWorstAbsPp),
    medianAbsLossErrorPercent: round(primary.overall.medianAbsLossErrorPercent),
    mechanismValidation: analysis.mechanismValidation.status
  }, null, 2)}\n`);
}

export function writeBenchmarkArtifacts() {
  const fixture = loadBenchmarkFixture();
  const generated = generatedState(fixture);
  writeFileSync(FIXTURE_PATH, stableJson({ ...fixture, expected: generated.expected }), "utf8");
  writeFileSync(ARTIFACT_PATH, stableJson(generated.artifact), "utf8");
  printReceipt(generated.analysis);
}

export function verifyBenchmarkArtifacts() {
  const fixture = loadBenchmarkFixture();
  const generated = generatedState(fixture);
  assert.deepEqual(fixture.expected, generated.expected, "benchmark expected results are stale; run with --write");
  const committedArtifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8"));
  assert.deepEqual(committedArtifact, generated.artifact, "benchmark report artifact is stale; run with --write");
  printReceipt(generated.analysis);
}

function main() {
  const command = process.argv[2] || "run";
  if (command === "--write") return writeBenchmarkArtifacts();
  if (command === "--check") return verifyBenchmarkArtifacts();
  if (command !== "run") throw new Error(`Unknown argument: ${command}`);
  const fixture = loadBenchmarkFixture();
  printReceipt(evaluateBuckLossBenchmarkFixtureV2(fixture));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

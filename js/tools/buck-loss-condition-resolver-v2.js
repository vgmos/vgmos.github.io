const EXPLICIT_PROVENANCE = new Set(["entered", "url-entered", "entered-blank"]);
const DERIVED_LOW_DETAIL_KEYS = Object.freeze([
  "qgs2Low",
  "qgdLow",
  "plateauLow",
  "gateResistanceOnLow",
  "gateResistanceOffLow"
]);

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const numberOrNull = (value) => finite(value) ? Number(value) : null;
const issue = (code, message, details = {}) => Object.freeze({ code, message, ...details });

function interpolateCurve(points, driveVoltageV) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const sorted = [...points]
    .filter((point) => finite(point?.driveVoltageV) && finite(point?.resistanceMohm))
    .sort((left, right) => left.driveVoltageV - right.driveVoltageV);
  if (sorted.length < 2) return null;
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (driveVoltageV < first.driveVoltageV || driveVoltageV > last.driveVoltageV) return null;
  const exact = sorted.find((point) => Math.abs(point.driveVoltageV - driveVoltageV) <= 1e-12);
  if (exact) return exact.resistanceMohm;
  const upperIndex = sorted.findIndex((point) => point.driveVoltageV > driveVoltageV);
  if (upperIndex <= 0) return null;
  const lower = sorted[upperIndex - 1];
  const upper = sorted[upperIndex];
  const fraction = (driveVoltageV - lower.driveVoltageV) / (upper.driveVoltageV - lower.driveVoltageV);
  return lower.resistanceMohm + fraction * (upper.resistanceMohm - lower.resistanceMohm);
}

function resolveRdsOnMohm(model, driveVoltageV) {
  if (model?.method === "drive-voltage-curve") {
    return interpolateCurve(model.points, driveVoltageV);
  }
  if (model?.method !== "overdrive-fit") return null;
  const thresholdVoltageV = Number(model.thresholdVoltageV);
  const referenceDriveVoltageV = Number(model.referenceDriveVoltageV);
  const referenceResistanceMohm = Number(model.referenceResistanceMohm);
  const exponent = Number(model.exponent);
  const floorResistanceMohm = Number(model.floorResistanceMohm ?? 0);
  if (!(driveVoltageV > thresholdVoltageV)
    || !(referenceDriveVoltageV > thresholdVoltageV)
    || !(referenceResistanceMohm > floorResistanceMohm)
    || !(exponent > 0)) return null;
  const overdriveRatio = (referenceDriveVoltageV - thresholdVoltageV) / (driveVoltageV - thresholdVoltageV);
  return floorResistanceMohm
    + (referenceResistanceMohm - floorResistanceMohm) * Math.pow(overdriveRatio, exponent);
}

function capacitanceCurve(model) {
  const points = model?.points;
  if (!Array.isArray(points) || points.length < 2) return null;
  const sorted = [...points]
    .filter((point) => finite(point?.voltageV) && finite(point?.capacitancePf))
    .map((point) => ({ voltageV: Number(point.voltageV), capacitancePf: Number(point.capacitancePf) }))
    .sort((left, right) => left.voltageV - right.voltageV);
  if (sorted.length < 2
    || sorted[0].voltageV !== 0
    || sorted.some((point, index) => point.voltageV < 0
      || point.capacitancePf < 0
      || (index > 0 && point.voltageV <= sorted[index - 1].voltageV))) return null;
  return sorted;
}

function integrateCapacitanceCurvePc(points, voltageV) {
  if (!Array.isArray(points) || !(voltageV >= 0) || voltageV > points.at(-1).voltageV) return null;
  if (voltageV === 0) return 0;
  let chargePc = 0;
  for (let index = 1; index < points.length; index += 1) {
    const lower = points[index - 1];
    const upper = points[index];
    if (voltageV <= lower.voltageV) break;
    const segmentEndV = Math.min(voltageV, upper.voltageV);
    const fraction = (segmentEndV - lower.voltageV) / (upper.voltageV - lower.voltageV);
    const endCapacitancePf = lower.capacitancePf
      + fraction * (upper.capacitancePf - lower.capacitancePf);
    chargePc += 0.5 * (lower.capacitancePf + endCapacitancePf) * (segmentEndV - lower.voltageV);
    if (segmentEndV >= voltageV) break;
  }
  return chargePc;
}

function resolveQgdAtVoltageNc(gateCharge, switchVoltageV) {
  const referenceQgdNc = Number(gateCharge?.qgdNc);
  const voltageModel = gateCharge?.qgdVoltage;
  if (voltageModel?.method !== "normalized-crss-integral") {
    return {
      qgdNc: Number.isFinite(referenceQgdNc) ? referenceQgdNc : null,
      method: null,
      supported: false,
      domain: null
    };
  }
  const points = capacitanceCurve(voltageModel);
  const referenceVoltageV = Number(voltageModel.referenceVoltageV);
  const domain = points ? [points[0].voltageV, points.at(-1).voltageV] : null;
  const referenceChargePc = points ? integrateCapacitanceCurvePc(points, referenceVoltageV) : null;
  const operatingChargePc = points ? integrateCapacitanceCurvePc(points, switchVoltageV) : null;
  if (!(referenceQgdNc >= 0)
    || !(referenceChargePc > 0)
    || operatingChargePc === null) {
    return {
      qgdNc: Number.isFinite(referenceQgdNc) ? referenceQgdNc : null,
      method: voltageModel.method,
      supported: false,
      domain
    };
  }
  return {
    qgdNc: Math.abs(switchVoltageV - referenceVoltageV) <= 1e-12
      ? referenceQgdNc
      : referenceQgdNc * operatingChargePc / referenceChargePc,
    method: voltageModel.method,
    supported: true,
    domain,
    referenceVoltageV
  };
}

export function resolveBuckLossConditionPointV2(model, conditions = {}) {
  const reference = model?.reference;
  const currentA = numberOrNull(conditions.currentA);
  const driveVoltageV = numberOrNull(conditions.driveVoltageV);
  const switchVoltageV = numberOrNull(conditions.switchVoltageV)
    ?? numberOrNull(model?.gateCharge?.qgdVoltage?.referenceVoltageV);
  const thresholdVoltageV = Number(model?.transfer?.thresholdVoltageV);
  const conductionParameterAPerV2 = Number(model?.transfer?.conductionParameterAPerV2);
  if (!reference
    || !(currentA >= 0)
    || !(driveVoltageV > 0)
    || !(switchVoltageV >= 0)
    || !Number.isFinite(thresholdVoltageV)
    || !(conductionParameterAPerV2 > 0)) {
    return { available: false, currentA, driveVoltageV, switchVoltageV };
  }
  const atReferenceCurrent = Math.abs(currentA - Number(reference.currentA)) <= 1e-12;
  const chargeReferenceDriveVoltageV = Number(
    model.gateCharge?.referenceDriveVoltageV ?? reference.driveVoltageV
  );
  const atChargeReferenceDrive = Math.abs(driveVoltageV - chargeReferenceDriveVoltageV) <= 1e-12;
  const plateauV = atReferenceCurrent
    ? Number(reference.plateauV)
    : thresholdVoltageV + Math.sqrt(currentA / conductionParameterAPerV2);
  const qgs2Nc = atReferenceCurrent
    ? Number(reference.qgs2Nc)
    : Number(model.gateCharge?.cgsNcPerV) * (plateauV - thresholdVoltageV);
  const qgd = resolveQgdAtVoltageNc(model.gateCharge, switchVoltageV);
  const driveHeadroomV = driveVoltageV - plateauV;
  const qgThresholdNc = Number(model.gateCharge?.qgThresholdNc);
  const cpostNcPerV = Number(model.gateCharge?.cpostNcPerV);
  const qgdNc = qgd.qgdNc;
  const atReferencePartition = atReferenceCurrent
    && atChargeReferenceDrive
    && Math.abs(switchVoltageV - Number(qgd.referenceVoltageV ?? switchVoltageV)) <= 1e-12;
  const totalGateChargeNc = atReferencePartition
    ? Number(reference.totalGateChargeNc)
    : qgThresholdNc + qgs2Nc + qgdNc + cpostNcPerV * driveHeadroomV;
  const rdsOnMohm = resolveRdsOnMohm(model.rdsOn, driveVoltageV);
  const values = [plateauV, qgs2Nc, qgdNc, totalGateChargeNc, rdsOnMohm, driveHeadroomV];
  return {
    available: values.every(Number.isFinite)
      && plateauV >= thresholdVoltageV
      && qgs2Nc >= 0
      && qgdNc >= 0
      && totalGateChargeNc >= 0
      && rdsOnMohm > 0,
    currentA,
    driveVoltageV,
    switchVoltageV,
    thresholdVoltageV,
    plateauV,
    driveHeadroomV,
    rdsOnMohm,
    totalGateChargeNc,
    qgs2Nc,
    qgdNc,
    qgdVoltageMethod: qgd.method,
    qgdVoltageSupported: qgd.supported,
    qgdVoltageDomain: qgd.domain,
    chargeReferenceDriveVoltageV,
    atReferenceCurrent,
    atChargeReferenceDrive
  };
}

export function resolveBuckLossEffectiveTimingV2(model, conditionPoint = {}) {
  const timing = model?.effectiveTiming;
  const reference = model?.reference;
  if (!timing || !reference || !conditionPoint?.available) return { available: false };
  const referenceTurnOnNs = Number(timing.referenceTurnOnNs);
  const referenceTurnOffNs = Number(timing.referenceTurnOffNs);
  const referenceDriveVoltageV = Number(timing.referenceDriveVoltageV ?? reference.driveVoltageV);
  const referencePlateauVoltageV = Number(timing.referencePlateauVoltageV ?? reference.plateauV);
  const thresholdVoltageV = Number(conditionPoint.thresholdVoltageV);
  const offDriveVoltageV = Number(timing.offDriveVoltageV ?? 0);
  if (![referenceTurnOnNs, referenceTurnOffNs, referenceDriveVoltageV, referencePlateauVoltageV, thresholdVoltageV, offDriveVoltageV]
    .every(Number.isFinite)) return { available: false };

  if (timing.method === "gate-headroom-scaling") {
    const referenceHeadroomV = referenceDriveVoltageV - referencePlateauVoltageV;
    const onHeadroomV = conditionPoint.driveVoltageV - conditionPoint.plateauV;
    if (!(referenceHeadroomV > 0) || !(onHeadroomV > 0) || !(conditionPoint.plateauV > offDriveVoltageV)) {
      return { available: false };
    }
    return {
      available: true,
      method: timing.method,
      turnOnNs: referenceTurnOnNs * referenceHeadroomV / onHeadroomV,
      turnOffNs: referenceTurnOffNs
        * (referencePlateauVoltageV - offDriveVoltageV)
        / (conditionPoint.plateauV - offDriveVoltageV)
    };
  }

  if (timing.method !== "phase-charge-scaling") return { available: false };
  const referenceThresholdVoltageV = Number(timing.referenceThresholdVoltageV ?? thresholdVoltageV);
  const referenceQgs2Nc = Number(timing.referenceQgs2Nc ?? reference.qgs2Nc);
  const referenceQgdNc = Number(timing.referenceQgdNc ?? reference.qgdNc);
  const referenceAverageGateV = (referencePlateauVoltageV + referenceThresholdVoltageV) / 2;
  const operatingAverageGateV = (conditionPoint.plateauV + thresholdVoltageV) / 2;
  const referenceOnChargeTime = referenceQgs2Nc / (referenceDriveVoltageV - referenceAverageGateV)
    + referenceQgdNc / (referenceDriveVoltageV - referencePlateauVoltageV);
  const operatingOnChargeTime = conditionPoint.qgs2Nc / (conditionPoint.driveVoltageV - operatingAverageGateV)
    + conditionPoint.qgdNc / (conditionPoint.driveVoltageV - conditionPoint.plateauV);
  const referenceOffChargeTime = referenceQgs2Nc / (referenceAverageGateV - offDriveVoltageV)
    + referenceQgdNc / (referencePlateauVoltageV - offDriveVoltageV);
  const operatingOffChargeTime = conditionPoint.qgs2Nc / (operatingAverageGateV - offDriveVoltageV)
    + conditionPoint.qgdNc / (conditionPoint.plateauV - offDriveVoltageV);
  if (![referenceOnChargeTime, operatingOnChargeTime, referenceOffChargeTime, operatingOffChargeTime]
    .every((value) => Number.isFinite(value) && value > 0)) return { available: false };
  return {
    available: true,
    method: timing.method,
    turnOnNs: referenceTurnOnNs * operatingOnChargeTime / referenceOnChargeTime,
    turnOffNs: referenceTurnOffNs * operatingOffChargeTime / referenceOffChargeTime,
    turnOnScale: operatingOnChargeTime / referenceOnChargeTime,
    turnOffScale: operatingOffChargeTime / referenceOffChargeTime
  };
}

function baseDiagnostics(model, currentA, driveVoltageV) {
  return {
    currentA,
    driveVoltageV,
    plateauV: null,
    driveHeadroomV: null,
    rdsOnMohm: null,
    totalGateChargeNc: null,
    qgs2Nc: null,
    qgdNc: null,
    switchVoltageV: null,
    effectiveTurnOnNs: null,
    effectiveTurnOffNs: null,
    estimatedEffectiveTurnOnNs: null,
    estimatedEffectiveTurnOffNs: null,
    supported: false,
    method: "condition-model-v2",
    rdsOnMethod: model?.rdsOn?.method ?? null,
    plateauMethod: model?.transfer?.method ?? null,
    qgs2Method: model?.gateCharge?.qgs2Method ?? null,
    qgdVoltageMethod: model?.gateCharge?.qgdVoltage?.method ?? null,
    totalGateChargeMethod: model?.gateCharge?.totalMethod ?? null,
    effectiveTimingMethod: model?.effectiveTiming?.method ?? null,
    source: model?.source ?? null,
    reference: model?.reference ?? null,
    preservedKeys: [],
    lanes: null
  };
}

function laneValue(rawInputs, key, fallback) {
  return finite(rawInputs[key]) ? Number(rawInputs[key]) : fallback;
}

/**
 * Resolve condition-coupled switch parameters in the same display units used by
 * the v2 form (mOhm, nC, V, ns). The input object and template are never mutated.
 */
export function resolveBuckLossConditionsV2(rawInputs = {}, template = null, options = {}) {
  const provenance = { ...(rawInputs?.__provenance || {}) };
  const resolved = { ...(rawInputs || {}), __provenance: provenance };
  const adjustedKeys = [];
  const warnings = [];
  const errors = [];
  const model = template?.conditionModel ?? null;
  const reference = model?.reference ?? null;
  const currentA = numberOrNull(options?.currentA)
    ?? numberOrNull(rawInputs?.ioutMax)
    ?? numberOrNull(reference?.currentA);
  const driveVoltageV = numberOrNull(rawInputs?.vDrive)
    ?? numberOrNull(template?.values?.vDrive)
    ?? numberOrNull(reference?.driveVoltageV);
  const diagnostics = baseDiagnostics(model, currentA, driveVoltageV);

  if (!model || !reference) {
    errors.push(issue("missing-condition-model", "The selected device template has no condition model."));
    return { rawInputs: resolved, diagnostics, adjustedKeys, warnings, errors };
  }

  // These low-side partition fields are deliberately not interactive: the
  // shipped templates use one symmetric device pair, and the loss kernel only
  // consumes aggregate low-side QG. Canonicalize old shared-link overrides so
  // a hidden legacy value cannot change or block the live calculation.
  for (const key of DERIVED_LOW_DETAIL_KEYS) {
    const templateValue = template?.values?.[key] ?? null;
    if (resolved[key] !== templateValue || EXPLICIT_PROVENANCE.has(provenance[key])) adjustedKeys.push(key);
    resolved[key] = templateValue;
    provenance[key] = template?.provenance?.[key]
      || (templateValue === null ? "missing" : template?.source?.kind || "default");
  }
  if (!(currentA >= 0)) {
    errors.push(issue("invalid-condition-current", "Condition current must be a finite, non-negative value.", { field: "ioutMax" }));
  }
  if (!(driveVoltageV > 0)) {
    errors.push(issue("invalid-drive-voltage", "Gate-drive voltage must be a finite, positive value.", { field: "vDrive" }));
  }
  if (errors.length) return { rawInputs: resolved, diagnostics, adjustedKeys, warnings, errors };

  const minDriveVoltageV = numberOrNull(model.driveRange?.minVoltageV);
  const maxDriveVoltageV = numberOrNull(model.driveRange?.maxVoltageV);
  if ((minDriveVoltageV !== null && driveVoltageV < minDriveVoltageV)
    || (maxDriveVoltageV !== null && driveVoltageV > maxDriveVoltageV)) {
    errors.push(issue(
      "drive-outside-condition-domain",
      `The ${driveVoltageV} V gate drive is outside this condition model's ${minDriveVoltageV}-${maxDriveVoltageV} V domain.`,
      { field: "vDrive" }
    ));
  }
  const recommendedMinDriveVoltageV = numberOrNull(model.driveRange?.recommendedMinVoltageV);
  const recommendedMaxDriveVoltageV = numberOrNull(model.driveRange?.recommendedMaxVoltageV);
  if (!errors.length && (
    (recommendedMinDriveVoltageV !== null && driveVoltageV < recommendedMinDriveVoltageV)
    || (recommendedMaxDriveVoltageV !== null && driveVoltageV > recommendedMaxDriveVoltageV)
  )) {
    const recommendedRangeLabel = model.driveRange?.recommendedRangeLabel;
    const recommendedRangeCopy = recommendedRangeLabel
      ? `the ${recommendedRangeLabel} ${recommendedMinDriveVoltageV}-${recommendedMaxDriveVoltageV} V range`
      : `the device's ${recommendedMinDriveVoltageV}-${recommendedMaxDriveVoltageV} V recommended range`;
    warnings.push(issue(
      "drive-outside-recommended-range",
      `The ${driveVoltageV} V gate drive is inside the fitted model but outside ${recommendedRangeCopy}; treat this as an exploratory estimate.`
    ));
  }

  const switchVoltageV = numberOrNull(rawInputs?.vin)
    ?? numberOrNull(model.gateCharge?.qgdVoltage?.referenceVoltageV)
    ?? 0;
  const conditionPoint = resolveBuckLossConditionPointV2(model, {
    currentA,
    driveVoltageV,
    switchVoltageV
  });
  const thresholdVoltageV = conditionPoint.thresholdVoltageV;
  const atReferenceCurrent = conditionPoint.atReferenceCurrent;
  const atChargeReferenceDrive = conditionPoint.atChargeReferenceDrive;
  const plateauV = conditionPoint.plateauV;
  const rdsOnMohm = conditionPoint.rdsOnMohm;
  const cgsNcPerV = Number(model.gateCharge?.cgsNcPerV);
  const qgThresholdNc = Number(model.gateCharge?.qgThresholdNc);
  const qgdNc = conditionPoint.qgdNc;
  const cpostNcPerV = Number(model.gateCharge?.cpostNcPerV);
  const qgs2Nc = conditionPoint.qgs2Nc;
  const resolvedPlateauForLane = (key) => EXPLICIT_PROVENANCE.has(provenance[key]) && finite(rawInputs?.[key])
    ? Number(rawInputs[key])
    : plateauV;
  const highPlateauV = resolvedPlateauForLane("plateauHigh");
  const lowPlateauV = resolvedPlateauForLane("plateauLow");
  const highDriveHeadroomV = driveVoltageV - highPlateauV;
  const lowDriveHeadroomV = driveVoltageV - lowPlateauV;
  const driveHeadroomV = driveVoltageV - plateauV;
  const totalGateChargeNc = conditionPoint.totalGateChargeNc;

  const driveOutsideDomain = errors.some(({ code }) => code === "drive-outside-condition-domain");
  if (!driveOutsideDomain && (![plateauV, rdsOnMohm, qgs2Nc, qgdNc, totalGateChargeNc, driveHeadroomV].every(Number.isFinite)
    || !(plateauV >= thresholdVoltageV)
    || !(rdsOnMohm > 0)
    || !(qgs2Nc >= 0)
    || !(totalGateChargeNc >= 0))) {
    errors.push(issue("invalid-condition-model", "The selected device condition model did not produce finite physical values."));
  }
  if (conditionPoint.qgdVoltageMethod && !conditionPoint.qgdVoltageSupported) {
    const domain = conditionPoint.qgdVoltageDomain;
    const explicitQgd = EXPLICIT_PROVENANCE.has(provenance.qgdHigh) && finite(rawInputs.qgdHigh);
    const fallbackCopy = explicitQgd
      ? "the entered QGD override is retained"
      : "the automatic model uses the source QGD anchor";
    warnings.push(issue(
      "switch-voltage-outside-qgd-domain",
      domain
        ? `VIN ${switchVoltageV} V is outside the ${domain[0]}-${domain[1]} V QGD curve domain; ${fallbackCopy}.`
        : `The voltage-dependent QGD curve is invalid; ${fallbackCopy}.`
    ));
  }
  const belowThresholdLanes = [
    { label: "high-side", key: "plateauHigh", plateauV: highPlateauV },
    { label: "low-side", key: "plateauLow", plateauV: lowPlateauV }
  ].filter(({ plateauV: lanePlateauV }) => Number.isFinite(lanePlateauV) && lanePlateauV < thresholdVoltageV);
  if (belowThresholdLanes.length) {
    const laneDetail = belowThresholdLanes
      .map(({ label, plateauV: lanePlateauV }) => `${label} plateau ${lanePlateauV.toFixed(3)} V`)
      .join(" and ");
    const manualLane = belowThresholdLanes.find(({ key }) => EXPLICIT_PROVENANCE.has(provenance[key]));
    errors.push(issue(
      "plateau-below-transfer-threshold",
      `The resolved ${laneDetail} is below the device transfer-fit threshold ${thresholdVoltageV.toFixed(3)} V.`,
      {
        field: manualLane?.key || belowThresholdLanes[0].key,
        lanes: Object.freeze(belowThresholdLanes.map(({ label }) => label))
      }
    ));
  }
  const insufficientLanes = [
    { label: "high-side", key: "plateauHigh", plateauV: highPlateauV, headroomV: highDriveHeadroomV },
    { label: "low-side", key: "plateauLow", plateauV: lowPlateauV, headroomV: lowDriveHeadroomV }
  ].filter(({ plateauV: lanePlateauV, headroomV: laneHeadroomV }) => Number.isFinite(lanePlateauV)
    && Number.isFinite(laneHeadroomV)
    && !(laneHeadroomV > 0));
  if (insufficientLanes.length) {
    const laneDetail = insufficientLanes
      .map(({ label, plateauV: lanePlateauV }) => `${label} plateau ${lanePlateauV.toFixed(3)} V`)
      .join(" and ");
    const manualLane = insufficientLanes.find(({ key }) => EXPLICIT_PROVENANCE.has(provenance[key]));
    errors.push(issue(
      "insufficient-gate-headroom",
      `The ${driveVoltageV} V drive does not exceed the resolved ${laneDetail} at ${currentA} A.`,
      {
        field: manualLane?.key || "vDrive",
        lanes: Object.freeze(insufficientLanes.map(({ label }) => label))
      }
    ));
  }

  diagnostics.plateauV = Number.isFinite(highPlateauV) ? highPlateauV : null;
  diagnostics.driveHeadroomV = Number.isFinite(highDriveHeadroomV) ? highDriveHeadroomV : null;
  diagnostics.rdsOnMohm = Number.isFinite(rdsOnMohm) ? rdsOnMohm : null;
  diagnostics.totalGateChargeNc = Number.isFinite(totalGateChargeNc) ? totalGateChargeNc : null;
  diagnostics.qgs2Nc = Number.isFinite(qgs2Nc) ? qgs2Nc : null;
  diagnostics.qgdNc = Number.isFinite(qgdNc) ? qgdNc : null;
  diagnostics.switchVoltageV = Number.isFinite(switchVoltageV) ? switchVoltageV : null;

  let effectiveTurnOnNs = null;
  let effectiveTurnOffNs = null;
  if (!driveOutsideDomain && model.effectiveTiming && highDriveHeadroomV > 0) {
    const highTimingPoint = {
      ...conditionPoint,
      available: conditionPoint.available,
      plateauV: highPlateauV,
      driveHeadroomV: highDriveHeadroomV,
      qgs2Nc: EXPLICIT_PROVENANCE.has(provenance.qgs2High) && finite(rawInputs.qgs2High)
        ? Number(rawInputs.qgs2High)
        : qgs2Nc,
      qgdNc: EXPLICIT_PROVENANCE.has(provenance.qgdHigh) && finite(rawInputs.qgdHigh)
        ? Number(rawInputs.qgdHigh)
        : qgdNc
    };
    const timing = resolveBuckLossEffectiveTimingV2(model, highTimingPoint);
    effectiveTurnOnNs = timing.available ? timing.turnOnNs : null;
    effectiveTurnOffNs = timing.available ? timing.turnOffNs : null;
    if (![effectiveTurnOnNs, effectiveTurnOffNs].every((value) => Number.isFinite(value) && value >= 0)) {
      errors.push(issue("invalid-effective-timing-model", "Condition-aware phase-charge timing scaling did not produce finite transition times."));
      effectiveTurnOnNs = null;
      effectiveTurnOffNs = null;
    }
  }
  diagnostics.estimatedEffectiveTurnOnNs = effectiveTurnOnNs;
  diagnostics.estimatedEffectiveTurnOffNs = effectiveTurnOffNs;

  const canAdjust = (key) => !EXPLICIT_PROVENANCE.has(provenance[key]);
  const adjust = (key, value, calculatedProvenance) => {
    if (!canAdjust(key)) {
      diagnostics.preservedKeys.push(key);
      return;
    }
    if (!Number.isFinite(value)) return;
    resolved[key] = value;
    provenance[key] = calculatedProvenance;
    adjustedKeys.push(key);
  };

  if (!errors.some(({ code }) => [
    "invalid-condition-model",
    "drive-outside-condition-domain",
    "plateau-below-transfer-threshold"
  ].includes(code))) {
    adjust("rdsHigh", rdsOnMohm, "calculated-condition-rds");
    adjust("rdsLow", rdsOnMohm, "calculated-condition-rds");
    adjust("plateauHigh", plateauV, "calculated-condition-plateau");
    adjust("plateauLow", plateauV, "calculated-condition-plateau");

    for (const lane of ["High", "Low"]) {
      const lanePlateauV = laneValue(resolved, `plateau${lane}`, plateauV);
      const laneUsesReferencePlateau = atReferenceCurrent
        && Math.abs(lanePlateauV - Number(reference.plateauV)) <= 1e-12;
      const laneQgs2Nc = laneUsesReferencePlateau
        ? Number(reference.qgs2Nc)
        : cgsNcPerV * (lanePlateauV - thresholdVoltageV);
      adjust(`qgs2${lane}`, laneQgs2Nc, "calculated-condition-qgs2");
    }

    if (conditionPoint.qgdVoltageMethod && Number.isFinite(qgdNc)) {
      const qgdProvenance = conditionPoint.qgdVoltageSupported
        ? "calculated-condition-qgd"
        : "source-held-qgd-anchor";
      adjust("qgdHigh", qgdNc, qgdProvenance);
      adjust("qgdLow", qgdNc, qgdProvenance);
    }

    for (const lane of ["High", "Low"]) {
      const plateau = laneValue(resolved, `plateau${lane}`, plateauV);
      const qgs2 = laneValue(resolved, `qgs2${lane}`, qgs2Nc);
      const qgd = laneValue(resolved, `qgd${lane}`, qgdNc);
      const laneHeadroomV = driveVoltageV - plateau;
      const laneUsesReferencePartition = atReferenceCurrent && atChargeReferenceDrive
        && Math.abs(plateau - Number(reference.plateauV)) <= 1e-12
        && Math.abs(qgs2 - Number(reference.qgs2Nc)) <= 1e-12
        && Math.abs(qgd - Number(reference.qgdNc)) <= 1e-12;
      const laneTotalGateChargeNc = laneUsesReferencePartition
        ? Number(reference.totalGateChargeNc)
        : qgThresholdNc + qgs2 + qgd + cpostNcPerV * laneHeadroomV;
      if (laneHeadroomV > 0 && laneTotalGateChargeNc >= 0) {
        adjust(`qg${lane}`, laneTotalGateChargeNc, "calculated-condition-total-qg");
      }
    }
    if (effectiveTurnOnNs !== null) adjust("effectiveTurnOn", effectiveTurnOnNs, "calculated-condition-effective-time");
    if (effectiveTurnOffNs !== null) adjust("effectiveTurnOff", effectiveTurnOffNs, "calculated-condition-effective-time");
  }

  diagnostics.lanes = Object.freeze({
    high: Object.freeze({
      rdsOnMohm: driveOutsideDomain ? null : laneValue(resolved, "rdsHigh", rdsOnMohm),
      plateauV: laneValue(resolved, "plateauHigh", plateauV),
      driveHeadroomV: driveVoltageV - laneValue(resolved, "plateauHigh", plateauV),
      qgs2Nc: laneValue(resolved, "qgs2High", qgs2Nc),
      qgdNc: laneValue(resolved, "qgdHigh", qgdNc),
      totalGateChargeNc: !driveOutsideDomain && driveVoltageV > laneValue(resolved, "plateauHigh", plateauV)
        ? laneValue(resolved, "qgHigh", totalGateChargeNc)
        : null
    }),
    low: Object.freeze({
      rdsOnMohm: driveOutsideDomain ? null : laneValue(resolved, "rdsLow", rdsOnMohm),
      plateauV: laneValue(resolved, "plateauLow", plateauV),
      driveHeadroomV: driveVoltageV - laneValue(resolved, "plateauLow", plateauV),
      qgs2Nc: laneValue(resolved, "qgs2Low", qgs2Nc),
      qgdNc: laneValue(resolved, "qgdLow", qgdNc),
      totalGateChargeNc: !driveOutsideDomain && driveVoltageV > laneValue(resolved, "plateauLow", plateauV)
        ? laneValue(resolved, "qgLow", totalGateChargeNc)
        : null
    })
  });
  diagnostics.rdsOnMohm = diagnostics.lanes.high.rdsOnMohm;
  diagnostics.plateauV = diagnostics.lanes.high.plateauV;
  diagnostics.driveHeadroomV = diagnostics.lanes.high.driveHeadroomV;
  diagnostics.qgs2Nc = diagnostics.lanes.high.qgs2Nc;
  diagnostics.totalGateChargeNc = diagnostics.lanes.high.totalGateChargeNc;
  const appliedTiming = (key, estimate) => {
    if (EXPLICIT_PROVENANCE.has(provenance[key])) return numberOrNull(resolved[key]);
    return numberOrNull(resolved[key]) ?? estimate;
  };
  diagnostics.effectiveTurnOnNs = driveOutsideDomain ? null : appliedTiming("effectiveTurnOn", effectiveTurnOnNs);
  diagnostics.effectiveTurnOffNs = driveOutsideDomain ? null : appliedTiming("effectiveTurnOff", effectiveTurnOffNs);
  diagnostics.preservedKeys = Object.freeze([...new Set(diagnostics.preservedKeys)]);
  diagnostics.supported = errors.length === 0;
  return {
    rawInputs: resolved,
    diagnostics: Object.freeze(diagnostics),
    adjustedKeys: Object.freeze([...new Set(adjustedKeys)]),
    warnings: Object.freeze(warnings),
    errors: Object.freeze(errors)
  };
}

export const BUCK_LOSS_EXPLICIT_CONDITION_PROVENANCE_V2 = Object.freeze([...EXPLICIT_PROVENANCE]);

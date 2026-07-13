import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { updateBuckLossLinkedDraftInputV2 } from "../js/tools/buck-loss-entry-v2.js";
import { detectBuckLossUrlVersion, parseBuckLossUrlV2, serializeBuckLossUrlV2 } from "../js/tools/buck-loss-url-v2.js";

describe("buck loss v2 URL state", () => {
  it("routes bare state to v2 and unversioned parameterized links to legacy v1", () => {
    assert.equal(detectBuckLossUrlVersion("").route, "v2-bare");
    assert.equal(detectBuckLossUrlVersion("?p=12v-to-3v3-pol&i=2").route, "legacy-v1");
    assert.equal(detectBuckLossUrlVersion("?m=2&p=12v-to-3v3-pol&device=epc2090").route, "v2");
  });

  it("requires a device on the first bare visit but accepts a remembered choice", () => {
    assert.equal(parseBuckLossUrlV2("").needsDevice, true);
    const remembered = parseBuckLossUrlV2("", { rememberedDeviceId: "silicon-60v" });
    assert.equal(remembered.needsDevice, false);
    assert.equal(remembered.deviceId, "silicon-60v");
  });

  it("round-trips explicit v2 state through a canonical versioned URL", () => {
    const parsed = parseBuckLossUrlV2("?m=2&p=12v-to-3v3-pol&device=epc2090&control=forced-ccm&vin=15&i=1.5");
    assert.equal(parsed.custom, true);
    const serialized = serializeBuckLossUrlV2(parsed);
    assert.match(serialized, /^m=2&p=12v-to-3v3-pol&device=epc2090&control=forced-ccm&timing=auto/);
    assert.match(serialized, /vin=15/);
    const reparsed = parseBuckLossUrlV2(`?${serialized}`);
    assert.equal(reparsed.rawInputs.vin, 15);
    assert.equal(reparsed.cursor, 1.5);
    assert.equal(reparsed.controlMode, "forced-ccm");
    assert.equal(reparsed.timingMode, "auto");
  });

  it("round-trips unequal effective dead-time edges without changing the legacy fallback", () => {
    const parsed = parseBuckLossUrlV2("?m=2&p=12v-to-3v3-pol&device=epc2090&td=2&tdhl=7&tdlh=1&rsd=100&i=2");
    assert.equal(parsed.rawInputs.deadTime, 2);
    assert.equal(parsed.rawInputs.deadTimeHighToLow, 7);
    assert.equal(parsed.rawInputs.deadTimeLowToHigh, 1);
    assert.equal(parsed.rawInputs.reversePathResistance, 100);
    const serialized = serializeBuckLossUrlV2(parsed);
    assert.match(serialized, /tdhl=7/);
    assert.match(serialized, /tdlh=1/);
    assert.match(serialized, /rsd=100/);
    const reparsed = parseBuckLossUrlV2(serialized);
    assert.equal(reparsed.rawInputs.deadTimeHighToLow, 7);
    assert.equal(reparsed.rawInputs.deadTimeLowToHigh, 1);
  });

  it("round-trips the manufacturer BSC010N04LS6 template without inventing unsupported fields", () => {
    const parsed = parseBuckLossUrlV2("?m=2&p=12v-to-3v3-pol&device=infineon-bsc010n04ls6-4v5&i=2");
    assert.equal(parsed.needsDevice, false);
    assert.equal(parsed.deviceId, "infineon-bsc010n04ls6-4v5");
    assert.equal(parsed.technology, "silicon");
    assert.equal(parsed.rawInputs.rdsHigh, 1.1);
    assert.equal(parsed.rawInputs.qgHigh, 32);
    assert.equal(parsed.rawInputs.qgdHigh, 8.1);
    assert.equal(parsed.rawInputs.qgs2High, 4.7);
    assert.equal(parsed.rawInputs.effectiveTurnOn, null);
    assert.equal(parsed.rawInputs.cossErHigh, null);
    const serialized = serializeBuckLossUrlV2(parsed);
    assert.match(serialized, /device=infineon-bsc010n04ls6-4v5/);
    assert.doesNotMatch(serialized, /(?:qgs2h|teon|cossh)=/);
    const reparsed = parseBuckLossUrlV2(`?${serialized}`);
    assert.equal(reparsed.deviceId, "infineon-bsc010n04ls6-4v5");
    assert.equal(reparsed.rawInputs.qgs2High, 4.7);
    assert.equal(reparsed.rawInputs.effectiveTurnOn, null);
    assert.equal(reparsed.rawInputs.cossErHigh, null);
  });

  it("omits calculated dynamic fields so derived values do not become URL overrides", () => {
    const parsed = parseBuckLossUrlV2("?m=2&p=12v-to-3v3-pol&device=epc2090&i=2");
    parsed.rawInputs.qgHigh = 17.25;
    parsed.rawInputs.plateauHigh = 2.75;
    parsed.rawInputs.__provenance = {
      ...(parsed.rawInputs.__provenance || {}),
      qgHigh: "calculated-from-vdrive",
      plateauHigh: "calculated-condition-plateau"
    };

    const params = new URLSearchParams(serializeBuckLossUrlV2(parsed));
    assert.equal(params.has("qgh"), false);
    assert.equal(params.has("vplh"), false);
  });

  it("preserves explicit overrides while filtering only calculated provenance", () => {
    const parsed = parseBuckLossUrlV2("?m=2&p=12v-to-3v3-pol&device=epc2090&qgdh=8.75&i=2");
    parsed.rawInputs.plateauHigh = 2.75;
    parsed.rawInputs.__provenance = {
      ...(parsed.rawInputs.__provenance || {}),
      plateauHigh: "entered"
    };

    const params = new URLSearchParams(serializeBuckLossUrlV2(parsed));
    assert.equal(params.get("qgdh"), "8.75");
    assert.equal(params.get("vplh"), "2.75");
  });

  it("omits redundant ui-hidden low-side fields from canonical URLs", () => {
    const parsed = parseBuckLossUrlV2("?m=2&p=12v-to-3v3-pol&device=epc2090&qgdl=8.75&vpll=2.75&i=2");
    assert.equal(parsed.rawInputs.__provenance.qgdLow, "url-entered");
    assert.equal(parsed.rawInputs.__provenance.plateauLow, "url-entered");

    const params = new URLSearchParams(serializeBuckLossUrlV2(parsed));
    assert.equal(params.has("qgdl"), false);
    assert.equal(params.has("vpll"), false);
  });

  it("round-trips an explicit conditioned override even when it equals the template baseline", () => {
    const parsed = parseBuckLossUrlV2("?m=2&p=12v-to-3v3-pol&device=epc2090&i=2");
    parsed.rawInputs.vDrive = 3.3;
    parsed.rawInputs.qgHigh = 7.3;
    parsed.rawInputs.__provenance = {
      ...(parsed.rawInputs.__provenance || {}),
      vDrive: "entered",
      qgHigh: "entered"
    };

    const serialized = serializeBuckLossUrlV2(parsed);
    const params = new URLSearchParams(serialized);
    assert.equal(params.get("vdrv"), "3.3");
    assert.equal(params.get("qgh"), "7.3");

    const reparsed = parseBuckLossUrlV2(serialized);
    assert.equal(reparsed.rawInputs.vDrive, 3.3);
    assert.equal(reparsed.rawInputs.qgHigh, 7.3);
    assert.equal(reparsed.rawInputs.__provenance.qgHigh, "url-entered");
  });

  it("preserves inferred RAC linkage through edit, serialization, parse, and another DCR edit", () => {
    const parsed = parseBuckLossUrlV2("?m=2&p=12v-to-3v3-pol&device=epc2090&i=2");
    let editedRawInputs = updateBuckLossLinkedDraftInputV2(parsed.rawInputs, "rac", "");
    editedRawInputs = updateBuckLossLinkedDraftInputV2(editedRawInputs, "dcr", "20");
    assert.equal(editedRawInputs.rac, 20);
    assert.equal(editedRawInputs.__provenance.rac, "inferred-rac-equals-rdc");

    const serialized = serializeBuckLossUrlV2({ ...parsed, selectedInductorPart: null, rawInputs: editedRawInputs });
    const params = new URLSearchParams(serialized);
    assert.equal(params.get("part"), "");
    assert.equal(params.get("rdc"), "20");
    assert.equal(params.has("rac"), true);
    assert.equal(params.get("rac"), "");

    const reparsed = parseBuckLossUrlV2(serialized);
    assert.equal(reparsed.rawInputs.dcr, 20);
    assert.equal(reparsed.rawInputs.rac, 20);
    assert.equal(reparsed.rawInputs.__provenance.rac, "inferred-rac-equals-rdc");

    const reeditedRawInputs = updateBuckLossLinkedDraftInputV2(reparsed.rawInputs, "dcr", "55");
    assert.equal(reeditedRawInputs.dcr, 55);
    assert.equal(reeditedRawInputs.rac, 55);
    assert.equal(reeditedRawInputs.__provenance.rac, "inferred-rac-equals-rdc");
  });

  it("omits a cleared linked optional field when blank matches the preset fallback", () => {
    const parsed = parseBuckLossUrlV2("?m=2&p=12v-to-3v3-pol&device=epc2090&tdhl=7&i=2");
    parsed.rawInputs.deadTimeHighToLow = null;
    parsed.rawInputs.__provenance.deadTimeHighToLow = "entered-blank";
    const params = new URLSearchParams(serializeBuckLossUrlV2(parsed));
    assert.equal(params.has("tdhl"), false);
  });

  it("round-trips an explicit manual-inductor selection without restoring the preset catalog part", () => {
    const parsed = parseBuckLossUrlV2("?m=2&p=12v-to-3v3-pol&device=epc2090&i=2");
    assert.equal(parsed.selectedInductorPart, "XGL6060-222");
    parsed.selectedInductorPart = null;
    parsed.rawInputs.inductance = 3.3;
    parsed.rawInputs.dcr = 18;
    parsed.rawInputs.rac = 24;
    parsed.rawInputs.__provenance = {
      ...(parsed.rawInputs.__provenance || {}),
      inductance: "entered",
      dcr: "entered",
      rac: "entered"
    };

    const serialized = serializeBuckLossUrlV2(parsed);
    const params = new URLSearchParams(serialized);
    assert.equal(params.has("part"), true);
    assert.equal(params.get("part"), "");
    assert.equal(params.get("l"), "3.3");
    assert.equal(params.get("rdc"), "18");
    assert.equal(params.get("rac"), "24");

    const reparsed = parseBuckLossUrlV2(serialized);
    assert.equal(reparsed.selectedInductorPart, null);
    assert.equal(reparsed.rawInputs.inductance, 3.3);
    assert.equal(reparsed.rawInputs.dcr, 18);
    assert.equal(reparsed.rawInputs.rac, 24);
    assert.equal(reparsed.rawInputs.__provenance.inductance, "url-entered");
    assert.equal(reparsed.rawInputs.__provenance.dcr, "url-entered");
    assert.equal(reparsed.rawInputs.__provenance.rac, "url-entered");
  });

  it("clamps numeric state and rejects an unknown device without silently choosing one", () => {
    const parsed = parseBuckLossUrlV2("?m=2&device=not-real&vin=999&vout=3.3");
    assert.equal(parsed.needsDevice, true);
    assert.equal(parsed.deviceId, null);
    assert.equal(parsed.rawInputs.vin, 100);
    assert.ok(parsed.notes.some((note) => note.code === "unknown-device"));
    assert.ok(parsed.notes.some((note) => note.code === "clamped" && note.key === "vin"));
  });
});

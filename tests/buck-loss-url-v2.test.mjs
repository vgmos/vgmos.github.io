import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
    assert.match(serialized, /^m=2&p=12v-to-3v3-pol&device=epc2090&control=forced-ccm&timing=effective/);
    assert.match(serialized, /vin=15/);
    const reparsed = parseBuckLossUrlV2(`?${serialized}`);
    assert.equal(reparsed.rawInputs.vin, 15);
    assert.equal(reparsed.cursor, 1.5);
    assert.equal(reparsed.controlMode, "forced-ccm");
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

  it("clamps numeric state and rejects an unknown device without silently choosing one", () => {
    const parsed = parseBuckLossUrlV2("?m=2&device=not-real&vin=999&vout=3.3");
    assert.equal(parsed.needsDevice, true);
    assert.equal(parsed.deviceId, null);
    assert.equal(parsed.rawInputs.vin, 100);
    assert.ok(parsed.notes.some((note) => note.code === "unknown-device"));
    assert.ok(parsed.notes.some((note) => note.code === "clamped" && note.key === "vin"));
  });
});

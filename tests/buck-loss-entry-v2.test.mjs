import test from "node:test";
import assert from "node:assert/strict";
import {
  BUCK_LOSS_LAST_SETUP_KEY,
  readLastBuckLossQueryV2,
  rememberBuckLossQueryV2,
  seedBuckLossSetupV2,
  seedBuckLossQueryV2
} from "../js/tools/buck-loss-entry-v2.js";
import { parseBuckLossUrlV2 } from "../js/tools/buck-loss-url-v2.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

test("the entry seed is a complete canonical EPC2090 calculation", () => {
  const state = seedBuckLossSetupV2();
  const query = seedBuckLossQueryV2();
  const parsed = parseBuckLossUrlV2(query);

  assert.match(query, /^m=2&/);
  assert.equal(parsed.needsDevice, false);
  assert.equal(parsed.deviceId, "epc2090");
  assert.equal(parsed.presetId, "12v-to-3v3-pol");
  assert.equal(parsed.selectedInductorPart, "XGL6060-222");
  assert.equal(parsed.rawInputs.vin, 12);
  assert.equal(parsed.rawInputs.vout, 3.3);
  assert.equal(parsed.cursor, 2);
  assert.equal(state.conditioning.diagnostics.supported, true);
  assert.equal(state.conditioning.diagnostics.currentA, state.rawInputs.ioutMax);
  assert.equal(state.rawInputs.plateauHigh, state.conditioning.diagnostics.plateauV);
  assert.equal(state.rawInputs.rdsHigh, state.conditioning.diagnostics.rdsOnMohm);
  assert.equal(state.rawInputs.qgHigh, state.conditioning.diagnostics.totalGateChargeNc);
  assert.equal(state.rawInputs.__provenance.plateauHigh, "calculated-condition-plateau");
  assert.equal(state.rawInputs.__provenance.qgHigh, "calculated-condition-total-qg");
  assert.ok(state.rawInputs.effectiveTurnOn > 0);
});

test("last-setup memory preserves a valid customized canonical state", () => {
  const storage = memoryStorage();
  const customized = "m=2&p=12v-to-3v3-pol&device=silicon-30v&control=forced-ccm&timing=auto&vin=18&vout=5&i=1.5";

  assert.equal(rememberBuckLossQueryV2(customized, storage), true);
  const restored = readLastBuckLossQueryV2(storage);
  const parsed = parseBuckLossUrlV2(restored);

  assert.equal(parsed.deviceId, "silicon-30v");
  assert.equal(parsed.controlMode, "forced-ccm");
  assert.equal(parsed.rawInputs.vin, 18);
  assert.equal(parsed.rawInputs.vout, 5);
  assert.equal(parsed.cursor, 1.5);
});

test("last-setup memory rejects legacy, unknown-device, and invalid states", () => {
  const storage = memoryStorage();

  assert.equal(rememberBuckLossQueryV2("p=12v-to-3v3-pol&i=2", storage), false);
  assert.equal(rememberBuckLossQueryV2("m=2&p=12v-to-3v3-pol&device=not-real&i=2", storage), false);
  assert.equal(rememberBuckLossQueryV2("m=2&p=12v-to-3v3-pol&device=epc2090&vin=5&vout=12&i=2", storage), false);
  assert.equal(storage.getItem(BUCK_LOSS_LAST_SETUP_KEY), null);

  storage.setItem(BUCK_LOSS_LAST_SETUP_KEY, "not-a-query");
  assert.equal(readLastBuckLossQueryV2(storage), null);
});

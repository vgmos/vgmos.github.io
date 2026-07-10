import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { interpolatePoints } from "../js/tools/buck-loss-motion.js";

describe("buck loss motion helpers", () => {
  it("interpolates matching chart series without changing point identity", () => {
    const from = [[0, 10], [20, 30]];
    const to = [[10, 20], [40, 50]];

    assert.deepEqual(interpolatePoints(from, to, 0), from);
    assert.deepEqual(interpolatePoints(from, to, 0.5), [[5, 15], [30, 40]]);
    assert.deepEqual(interpolatePoints(from, to, 1), to);
  });

  it("falls back to the destination series when shapes do not match", () => {
    const to = [[1, 2], [3, 4]];
    assert.equal(interpolatePoints([[0, 0]], to, 0.5), to);
    assert.deepEqual(interpolatePoints(null, to, 0.5), to);
  });
});

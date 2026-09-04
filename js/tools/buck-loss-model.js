/**
 * Stable compatibility entry point for the frozen v1 loss model.
 *
 * Keep this public URL for old shared links and downstream imports while the
 * implementation itself lives in the explicitly versioned snapshot.
 */
export {
  classifyRegime,
  computeBuckCore,
  computeLossPoint,
  computeLossSweep,
  normalizeInputs,
  validateInputs
} from "./buck-loss-model-v1.js";

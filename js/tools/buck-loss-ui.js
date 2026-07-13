const moduleVersion = new URL(import.meta.url).searchParams.get("v");

function versionedModuleUrl(path) {
  const url = new URL(path, import.meta.url);
  if (moduleVersion) url.searchParams.set("v", moduleVersion);
  return url.href;
}

const { detectBuckLossUrlVersion, serializeBuckLossUrlV2 } = await import(versionedModuleUrl("./buck-loss-url-v2.js"));

const IMPORT_MEMORY_KEY = "buck-loss-v1-import";
const DEVICE_MEMORY_KEY = "buck-loss-v2-device";

function navigateWithinSite(href) {
  if (typeof window.vgmosNavigation?.navigate === "function") {
    window.vgmosNavigation.navigate(href);
    return;
  }
  window.location.assign(href);
}

function legacyBanner(root) {
  let banner = root.querySelector("[data-blx-legacy-banner]");
  if (banner) return banner;
  banner = document.createElement("section");
  banner.className = "blx-legacy-banner";
  banner.dataset.blxLegacyBanner = "";
  banner.innerHTML = `<div><p class="blx-eyebrow">Earlier shared calculation · Read-only</p><h2>This link uses the original forced-CCM calculation</h2><p>Its result is preserved exactly. Update compatible operating-point and passive inputs to add device choice, nonideal duty, diode-emulation DCM, and equation provenance.</p></div><button type="button" data-blx-import-v2>Update calculation</button>`;
  root.querySelector(".blx-workspace")?.before(banner);
  return banner;
}

function lockLegacyControls(root, options = {}) {
  const lock = () => {
    root.querySelectorAll(".blx-input-disclosure input, .blx-input-disclosure select, .blx-input-disclosure button, [data-blx-cursor-input]").forEach((control) => {
      if (!control.disabled) control.disabled = true;
    });
  };
  lock();
  const observer = new MutationObserver(() => lock());
  observer.observe(root.querySelector(".blx-workspace") || root, { childList: true, subtree: true });
  root.blxLegacyLockObserver = observer;
  options.signal?.addEventListener("abort", () => observer.disconnect(), { once: true });
}

async function importLegacyIntoV2(root, options = {}) {
  const [
    { requestBuckLossDeviceV2 },
    { parseBuckLossUrl },
    { normalizeInputs, computeLossPoint },
    { rawDefaultsV2 },
    { applyBuckLossDeviceTemplateV2, getBuckLossDeviceTemplateV2 },
    { DEFAULT_BUCK_LOSS_PRESET_V2, getBuckLossPresetV2 }
  ] = await Promise.all([
    import(versionedModuleUrl("./buck-loss-ui-v2.js")),
    import(versionedModuleUrl("./buck-loss-url.js")),
    import(versionedModuleUrl("./buck-loss-model-v1.js")),
    import(versionedModuleUrl("./buck-loss-schema-v2.js")),
    import(versionedModuleUrl("./buck-loss-device-templates-v2.js")),
    import(versionedModuleUrl("./buck-loss-presets-v2.js"))
  ]);
  if (options.signal?.aborted) return;
  const legacy = parseBuckLossUrl(window.location.search);
  const deviceId = await requestBuckLossDeviceV2(root, {
    title: "Choose a switch-pair model",
    message: "The earlier link did not identify device technology. Compatible inputs will be retained and the changed result will be disclosed.",
    vin: legacy.rawInputs.vin,
    allowCancel: true,
    signal: options.signal
  });
  if (!deviceId || options.signal?.aborted) return;
  const requestedPreset = getBuckLossPresetV2(legacy.requestedPresetId) || getBuckLossPresetV2(DEFAULT_BUCK_LOSS_PRESET_V2);
  const applied = applyBuckLossDeviceTemplateV2({ ...rawDefaultsV2(), ...requestedPreset.rawInputs }, deviceId);
  const rawInputs = applied.rawInputs;
  const compatibleKeys = [
    "vin", "vout", "ioutMax", "fsw", "inductance",
    "vDrive", "deadTime", "dcr", "esr", "iq", "vBias",
    "inductorAcManual", "inductorIsat"
  ];
  compatibleKeys.forEach((key) => {
    const value = legacy.rawInputs[key];
    if (value === null || value === "" || Number.isFinite(Number(value))) rawInputs[key] = value;
  });
  rawInputs.rac = rawInputs.dcr;
  rawInputs.__provenance = {
    ...(rawInputs.__provenance || {}),
    ...Object.fromEntries(compatibleKeys.map((key) => [key, "url-entered"])),
    rac: "inferred-rac-equals-rdc"
  };

  const oldInputs = normalizeInputs(legacy.rawInputs);
  const oldResult = computeLossPoint(oldInputs, legacy.cursor, { inductorAcLossW: oldInputs.inductorAcManual || 0 });
  try {
    sessionStorage.setItem(IMPORT_MEMORY_KEY, JSON.stringify({
      importedAt: new Date().toISOString(),
      legacySearch: window.location.search,
      result: { efficiency: oldResult.efficiency, pLoss: oldResult.pLoss, pOut: oldResult.pOut },
      deviceId
    }));
    localStorage.setItem(DEVICE_MEMORY_KEY, deviceId);
  } catch {}
  const template = getBuckLossDeviceTemplateV2(deviceId);
  const query = serializeBuckLossUrlV2({
    presetId: requestedPreset.id,
    deviceId,
    controlMode: "auto-dcm",
    timingMode: template.timingMode,
    selectedInductorPart: legacy.selectedInductorPart,
    inductorDcrMode: legacy.inductorDcrMode,
    rawInputs,
    cursor: legacy.cursor
  });
  if (!options.signal?.aborted) navigateWithinSite(`${window.location.pathname}?${query}`);
}

async function initLegacy(root, options = {}) {
  const { initBuckLossExplorer: initV1 } = await import(versionedModuleUrl("./buck-loss-ui-v1.js"));
  if (options.signal?.aborted) return;
  initV1(root, options);
  root.dataset.blxLegacy = "true";
  const eyebrow = root.querySelector(".blx-eyebrow");
  if (eyebrow) eyebrow.textContent = "Interactive tool · Archived calculation";
  const deviceNote = root.querySelector(".blx-device-note");
  if (deviceNote) deviceNote.innerHTML = '<strong>Archived assumptions</strong><br>This preserved result uses the original EPC2090-anchored switch defaults from the shared link.';
  const caveat = root.querySelector(".blx-top-caveat");
  if (caveat) caveat.textContent = "This archived calculation is preserved for shared-link fidelity. Update it for device-aware CCM/DCM analysis and current equation provenance.";
  const equations = root.querySelector(".blx-equations");
  if (equations) equations.innerHTML = '<h2>Archived equations</h2><p>This read-only viewer preserves the original ideal-duty, forced-CCM loss kernel used by the shared link. Update the operating point for nonideal duty, diode-emulation DCM, and term-level textbook provenance.</p>';
  const caveats = root.querySelector(".blx-caveats");
  if (caveats) caveats.innerHTML = '<h2>Archived scope</h2><p>This calculation is retained only for result fidelity. Its controls are locked and its assumptions are not being extended.</p>';
  legacyBanner(root).querySelector("[data-blx-import-v2]")?.addEventListener("click", () => importLegacyIntoV2(root, options));
  lockLegacyControls(root, options);
}

export function destroyBuckLossExplorer(root) {
  if (!root) return;
  const destroy = root.blxDestroy;
  root.blxDestroy = null;
  try { destroy?.(); } catch {}
  root.blxLegacyLockObserver?.disconnect?.();
  root.blxResizeObserver?.disconnect?.();
  root.querySelectorAll?.("*").forEach((node) => {
    clearTimeout(node.blxTimer);
    clearTimeout(node.blxCopyTimer);
    clearTimeout(node.blxAccordionTimer);
    clearTimeout(node.blxAdjustedTimer);
    cancelAnimationFrame(node.blxAccordionFrame || 0);
  });
  try {
    root.getAnimations?.({ subtree: true }).forEach((animation) => animation.cancel());
  } catch {}
}

export async function initBuckLossExplorer(root, options = {}) {
  if (!root || options.signal?.aborted) return;
  const route = detectBuckLossUrlVersion(typeof window === "undefined" ? "" : window.location.search).route;
  if (route === "legacy-v1") await initLegacy(root, options);
  else if (route === "v2-bare") {
    const { initBuckLossEntryV2 } = await import(versionedModuleUrl("./buck-loss-entry-v2.js"));
    if (options.signal?.aborted) return;
    await initBuckLossEntryV2(root, options);
  }
  else {
    const { initBuckLossExplorerV2 } = await import(versionedModuleUrl("./buck-loss-ui-v2.js"));
    if (options.signal?.aborted) return;
    await initBuckLossExplorerV2(root, options);
  }
}

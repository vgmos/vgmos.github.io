const moduleVersion = new URL(import.meta.url).searchParams.get("v");

function versionedModuleUrl(path) {
  const url = new URL(path, import.meta.url);
  if (moduleVersion) url.searchParams.set("v", moduleVersion);
  return url.href;
}

const { detectBuckLossUrlVersion, serializeBuckLossUrlV2 } = await import(versionedModuleUrl("./buck-loss-url-v2.js"));

const IMPORT_MEMORY_KEY = "buck-loss-v1-import";
const DEVICE_MEMORY_KEY = "buck-loss-v2-device";

function legacyBanner(root) {
  let banner = root.querySelector("[data-blx-legacy-banner]");
  if (banner) return banner;
  banner = document.createElement("section");
  banner.className = "blx-legacy-banner";
  banner.dataset.blxLegacyBanner = "";
  banner.innerHTML = `<div><p class="blx-eyebrow">Legacy model v1 · Read-only</p><h2>This shared link uses the original forced-CCM model</h2><p>Its result is preserved exactly. Import compatible operating-point and passive inputs into v2 to add device choice, nonideal duty, diode-emulation DCM, and equation provenance.</p></div><button type="button" data-blx-import-v2>Import into v2</button>`;
  root.querySelector(".blx-workspace")?.before(banner);
  return banner;
}

function lockLegacyControls(root) {
  const lock = () => {
    root.querySelectorAll(".blx-input-disclosure input, .blx-input-disclosure select, .blx-input-disclosure button, [data-blx-cursor-input]").forEach((control) => {
      if (!control.disabled) control.disabled = true;
    });
  };
  lock();
  const observer = new MutationObserver(() => lock());
  observer.observe(root.querySelector(".blx-workspace") || root, { childList: true, subtree: true });
  root.blxLegacyLockObserver = observer;
}

async function importLegacyIntoV2(root) {
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
  const legacy = parseBuckLossUrl(window.location.search);
  const deviceId = await requestBuckLossDeviceV2(root, {
    title: "Choose a v2 device template",
    message: "The legacy link did not identify device technology. Compatible inputs will be retained and v2 will disclose the changed result.",
    vin: legacy.rawInputs.vin,
    allowCancel: true
  });
  if (!deviceId) return;
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
  window.location.assign(`${window.location.pathname}?${query}`);
}

async function initLegacy(root) {
  const { initBuckLossExplorer: initV1 } = await import(versionedModuleUrl("./buck-loss-ui-v1.js"));
  initV1(root);
  root.dataset.blxLegacy = "true";
  const eyebrow = root.querySelector(".blx-eyebrow");
  if (eyebrow) eyebrow.textContent = "Interactive tool · Legacy loss model v1";
  const deviceNote = root.querySelector(".blx-device-note");
  if (deviceNote) deviceNote.innerHTML = '<strong>Legacy v1 assumptions</strong><br>This preserved result uses the original EPC2090-anchored switch defaults from the shared link.';
  const caveat = root.querySelector(".blx-top-caveat");
  if (caveat) caveat.textContent = "Legacy v1 is preserved for shared-link fidelity. Import into v2 for device-aware CCM/DCM analysis and current equation provenance.";
  const equations = root.querySelector(".blx-equations");
  if (equations) equations.innerHTML = '<h2>Legacy v1 equations</h2><p>This read-only viewer preserves the original ideal-duty, forced-CCM loss kernel used by the shared link. Import the operating point into v2 for nonideal duty, diode-emulation DCM, and term-level textbook provenance.</p>';
  const caveats = root.querySelector(".blx-caveats");
  if (caveats) caveats.innerHTML = '<h2>Legacy scope</h2><p>V1 is retained only for result fidelity. Its controls are locked and its model assumptions are not being extended.</p>';
  legacyBanner(root).querySelector("[data-blx-import-v2]")?.addEventListener("click", () => importLegacyIntoV2(root));
  lockLegacyControls(root);
}

export async function initBuckLossExplorer(root) {
  if (!root) return;
  const route = detectBuckLossUrlVersion(typeof window === "undefined" ? "" : window.location.search).route;
  if (route === "legacy-v1") await initLegacy(root);
  else {
    const { initBuckLossExplorerV2 } = await import(versionedModuleUrl("./buck-loss-ui-v2.js"));
    await initBuckLossExplorerV2(root);
  }
}

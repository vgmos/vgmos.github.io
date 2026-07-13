const source = (equation, printedPage, pdfPage, note, relation = "direct") => Object.freeze({
  title: "Switched Inductor Power IC Design",
  chapter: 4,
  equation,
  printedPage,
  pdfPage,
  note,
  relation
});

const effectiveTransitionSource = Object.freeze({
  title: "Disclosed effective-overlap approximation",
  chapter: null,
  equation: null,
  printedPage: null,
  pdfPage: null,
  note: "Uses a triangular overlap approximation with an explicitly entered or assumed effective time.",
  relation: "adapted"
});

const characterizedEnergySource = Object.freeze({
  title: "Condition-matched switching-energy characterization",
  chapter: null,
  equation: null,
  printedPage: null,
  pdfPage: null,
  note: "Interpolates EON and EOFF only inside the declared voltage/current domain and at the declared temperature and gate-resistance conditions.",
  relation: "direct"
});

const analyticalTransitionSource = Object.freeze({
  title: "EPC AN030 — Hard Switching Losses Calculations",
  chapter: null,
  equation: "1–14",
  printedPage: "2–5",
  pdfPage: "2–5",
  url: "https://epc-co.com/epc/Portals/0/epc/documents/application-notes/AN030%20Hard%20Switching%20Losses%20Calculation.pdf",
  note: "Uses phase-specific gate current with QGS2(I), QGD(V), the Miller plateau, threshold voltage, and the complete source/sink gate-loop resistance; adapts Vbus to the buck hard-switch swing VIN + VSD.",
  relation: "adapted"
});

const unavailableTransitionSource = Object.freeze({
  title: "Automatic transition evidence hierarchy",
  chapter: null,
  equation: null,
  printedPage: null,
  pdfPage: null,
  note: "No condition-matched energy surface, complete gate-charge path, or complete effective-time fallback is available, so this term is omitted.",
  relation: "adapted"
});

export const BUCK_LOSS_FAMILIES_V2 = Object.freeze([
  Object.freeze({ id: "mosfetConduction", label: "MOSFET conduction", terms: ["highSideConduction", "lowSideConduction"] }),
  Object.freeze({ id: "magnetics", label: "Magnetics", terms: ["inductorDcCopper", "inductorAcCopper", "inductorCoreResidual"] }),
  Object.freeze({ id: "capacitors", label: "Capacitors", terms: ["inputCapEsr", "outputCapEsr"] }),
  Object.freeze({ id: "switchingTransitions", label: "Switching transitions", terms: ["turnOnOverlap", "turnOffOverlap"] }),
  Object.freeze({ id: "deadTimeRecovery", label: "Dead time & recovery", terms: ["deadTimeConduction", "reverseRecovery"] }),
  Object.freeze({ id: "gateDrive", label: "Gate drive", terms: ["gateDriveHigh", "gateDriveLow"] }),
  Object.freeze({ id: "nodeEnergy", label: "Switch-node energy", terms: ["nodeEnergy"] }),
  Object.freeze({ id: "controllerBias", label: "Controller bias", terms: ["controllerBias"] })
]);

export const BUCK_LOSS_TERM_METADATA_V2 = Object.freeze({
  highSideConduction: Object.freeze({
    label: "High-side channel",
    family: "mosfetConduction",
    formula: "RDS(on),HS · ∫HS iL² dt / TSW",
    source: source("4.21", 182, 196, "Duty-window resistor loss, evaluated here with exact interval moments.")
  }),
  lowSideConduction: Object.freeze({
    label: "Low-side channel",
    family: "mosfetConduction",
    formula: "RDS(on),LS · ∫LS iL² dt / TSW",
    source: source("4.22", 182, 196, "The low-side channel window excludes both dead-time intervals.")
  }),
  inductorDcCopper: Object.freeze({
    label: "Inductor DC copper",
    family: "magnetics",
    formula: "IO² · RDC",
    source: source("4.20", 180, 194, "The DC and ripple-frequency resistance components are kept separate.")
  }),
  inductorAcCopper: Object.freeze({
    label: "Inductor ripple AC copper",
    family: "magnetics",
    formula: "(IL,RMS² − IO²) · RAC",
    source: source("4.20", 180, 194, "Uses the exact mode-specific ripple-current moment.")
  }),
  inductorCoreResidual: Object.freeze({
    label: "Inductor characterized core residual",
    family: "magnetics",
    formula: "Characterized or entered residual beyond RMS copper",
    source: Object.freeze({ title: "Inductor characterization", chapter: null, equation: null, printedPage: null, pdfPage: null, note: "Catalog residual is added once; missing or out-of-domain data makes the result a subtotal.", relation: "direct" })
  }),
  inputCapEsr: Object.freeze({
    label: "Input-capacitor ESR",
    family: "capacitors",
    formula: "ICIN,RMS² · ESRIN",
    source: source("4.14", 178, 192, "General RMS resistor identity with the exact pulsed input-current waveform.")
  }),
  outputCapEsr: Object.freeze({
    label: "Output-capacitor ESR",
    family: "capacitors",
    formula: "ICOUT,RMS² · ESROUT",
    source: source("4.24", 186, 200, "Buck output capacitor carries the difference between inductor and load current.")
  }),
  turnOnOverlap: Object.freeze({
    label: "Turn-on overlap",
    family: "switchingTransitions",
    formula: "½ · VSW · ION · (tCR + tVF) · fSW",
    source: analyticalTransitionSource
  }),
  turnOffOverlap: Object.freeze({
    label: "Turn-off overlap",
    family: "switchingTransitions",
    formula: "½ · VSW · IOFF · (tCF + tVR) · fSW",
    source: analyticalTransitionSource
  }),
  deadTimeConduction: Object.freeze({
    label: "Reverse-path dead time",
    family: "deadTimeRecovery",
    formula: "Σedges [VSD,0 · ∫ |iL| dt + RSD · ∫ iL² dt] / TSW",
    source: Object.freeze({
      ...source("4.33, 4.35", 193, 207, "Exact interval integration covers CCM and the single material DCM dead-time interval. The entered reverse-path voltage is held constant across each window, a conservative first-order approximation."),
      references: Object.freeze([
        Object.freeze({ equation: "4.33", printedPage: 193, pdfPage: 207 }),
        Object.freeze({ equation: "4.35", printedPage: 194, pdfPage: 208 })
      ])
    })
  }),
  reverseRecovery: Object.freeze({
    label: "Reverse recovery",
    family: "deadTimeRecovery",
    formula: "VSW · QRR(IO) · [1 − e^(−tdlh/τF)] · fSW",
    source: source("4.57", 207, 221, "Adapted to a buck hard-switch event: silicon recovered charge is limited by the diffusion charge established during the LS→HS dead time, with τF = QRR,ref / Iref; buildup follows Eq. 4.49–4.50 and §4.5.3C. GaN suppresses this term.", "adapted")
  }),
  gateDriveHigh: Object.freeze({
    label: "High-side gate drive",
    family: "gateDrive",
    formula: "QG,HS · VDRV · fSW",
    source: source("4.62, 4.71", 217, 231, "Supply energy used to charge and discharge the switch gate each cycle.")
  }),
  gateDriveLow: Object.freeze({
    label: "Low-side gate drive",
    family: "gateDrive",
    formula: "QG,LS · VDRV · fSW",
    source: source("4.62, 4.71", 217, 231, "Supply energy used to charge and discharge the switch gate each cycle.")
  }),
  nodeEnergy: Object.freeze({
    label: "Switch-node EOSS",
    family: "nodeEnergy",
    formula: "(EOSS,HS + EOSS,LS) · fSW",
    source: source("4.72–4.73", 222, 236, "Adapted from topology-specific switch-node energy balance; characterized energy is not extrapolated beyond its declared voltage domain.", "adapted")
  }),
  controllerBias: Object.freeze({
    label: "Controller bias",
    family: "controllerBias",
    formula: "VBIAS · IQ",
    source: source(null, 236, 250, "Quiescent controller power is explicitly separated from switching-frequency terms.")
  })
});

export function resolveBuckLossTermMetadataV2(timingMode, transition = null) {
  const characterized = ["measured-energy-surface", "vendor-spice-energy-surface"].includes(transition?.method);
  if (characterized) return Object.freeze({
    ...BUCK_LOSS_TERM_METADATA_V2,
    turnOnOverlap: Object.freeze({
      ...BUCK_LOSS_TERM_METADATA_V2.turnOnOverlap,
      formula: "EON(VIN, ION, conditions) · fSW",
      source: characterizedEnergySource
    }),
    turnOffOverlap: Object.freeze({
      ...BUCK_LOSS_TERM_METADATA_V2.turnOffOverlap,
      formula: "EOFF(VIN, IOFF, conditions) · fSW",
      source: characterizedEnergySource
    })
  });
  if (timingMode === "auto" && transition?.available === false) return Object.freeze({
    ...BUCK_LOSS_TERM_METADATA_V2,
    turnOnOverlap: Object.freeze({
      ...BUCK_LOSS_TERM_METADATA_V2.turnOnOverlap,
      formula: "Automatic hierarchy · EON unavailable",
      source: unavailableTransitionSource
    }),
    turnOffOverlap: Object.freeze({
      ...BUCK_LOSS_TERM_METADATA_V2.turnOffOverlap,
      formula: "Automatic hierarchy · EOFF unavailable",
      source: unavailableTransitionSource
    })
  });
  const effective = ["effective-override", "effective-fallback"].includes(transition?.method) || (!transition?.method && timingMode === "effective");
  if (!effective) return BUCK_LOSS_TERM_METADATA_V2;
  return Object.freeze({
    ...BUCK_LOSS_TERM_METADATA_V2,
    turnOnOverlap: Object.freeze({
      ...BUCK_LOSS_TERM_METADATA_V2.turnOnOverlap,
      formula: "½ · VSW · ION · tEFF,ON · fSW",
      source: effectiveTransitionSource
    }),
    turnOffOverlap: Object.freeze({
      ...BUCK_LOSS_TERM_METADATA_V2.turnOffOverlap,
      formula: "½ · VSW · IOFF · tEFF,OFF · fSW",
      source: effectiveTransitionSource
    })
  });
}

export const BUCK_LOSS_ADVISORY_METADATA_V2 = Object.freeze({
  fetAreaOptimum: Object.freeze({
    formula: "area scale = √(channel conduction / gate-drive loss)",
    source: source("4.80–4.83", 226, 240, "Advisory balances channel resistance and gate charge only; EOSS and QRR are excluded.")
  })
});

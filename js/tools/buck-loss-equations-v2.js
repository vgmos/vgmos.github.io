const source = (equation, printedPage, pdfPage, note) => Object.freeze({
  title: "Switched Inductor Power IC Design, Chapter 4",
  equation,
  printedPage,
  pdfPage,
  note
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
    source: Object.freeze({ title: "Inductor characterization", equation: null, printedPage: null, pdfPage: null, note: "Catalog residual is added once; missing data makes the result a subtotal." })
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
    formula: "VSW · ION · fSW · (tI/3 + tV/2)",
    source: source("4.39", 197, 211, "Uses 1/3 current-transition and 1/2 voltage-transition coefficients when phase data is available.")
  }),
  turnOffOverlap: Object.freeze({
    label: "Turn-off overlap",
    family: "switchingTransitions",
    formula: "VSW · IOFF · fSW · (tV/2 + tI/3)",
    source: source("4.39", 197, 211, "Uses the peak current at turn-off and the technology-specific switch-node swing.")
  }),
  deadTimeConduction: Object.freeze({
    label: "Reverse-path dead time",
    family: "deadTimeRecovery",
    formula: "VSD · ∫dead |iL| dt / TSW",
    source: source("4.33, 4.35", 193, 207, "Exact interval integration covers CCM and the single material DCM dead-time interval.")
  }),
  reverseRecovery: Object.freeze({
    label: "Reverse recovery",
    family: "deadTimeRecovery",
    formula: "VSW · QRR(IO) · fSW",
    source: source("4.57", 207, 221, "Silicon QRR is scaled from its disclosed reference current; GaN suppresses this term.")
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
    source: source("4.72–4.73", 222, 236, "Characterized energy is not extrapolated beyond its declared voltage domain.")
  }),
  controllerBias: Object.freeze({
    label: "Controller bias",
    family: "controllerBias",
    formula: "VBIAS · IQ",
    source: source(null, 236, 250, "Quiescent controller power is explicitly separated from switching-frequency terms.")
  })
});

export const BUCK_LOSS_ADVISORY_METADATA_V2 = Object.freeze({
  fetAreaOptimum: Object.freeze({
    formula: "area scale = √(channel conduction / gate-drive loss)",
    source: source("4.80–4.83", 226, 240, "Advisory balances channel resistance and gate charge only; EOSS and QRR are excluded.")
  })
});

export function deviceName(template) {
  return template.partNumber || `${template.voltageClass} V MOSFET example`;
}

export function deviceSummary(template) {
  return template.catalogKind === "manufacturer"
    ? `${template.voltageClass} V ${template.technology === "gan" ? "GaN" : "MOSFET"} · high-side and low-side`
    : "Illustrative values, not a manufacturer part";
}

export function deviceModelNote(template) {
  if (template.id === "infineon-bsc010n04ls6-4v5") {
    return "25 °C data: on-resistance and gate charge use the 4.5 V gate-drive test; Miller charge and plateau use the 10 V test. QGS2 is estimated as QGS − QG(th). Recovery charge scales from the 10 A reference and is limited by charge buildup during dead time.";
  }
  if (template.id === "epc2090") {
    return "25 °C data: reference gate charges use the 50 V, 16 A test. Miller charge is adjusted with switch-node voltage; COSS(ER) is the energy-equivalent capacitance from 0 to 50 V.";
  }
  if (template.id === "vishay-si7860dp-tps40071evm") {
    return "25 °C Vishay model data and the TI TPS40071EVM design values. Switching times and reverse recovery use first-order approximations; COSS(ER) is not supplied.";
  }
  return "Illustrative 25 °C values for comparing loss mechanisms.";
}

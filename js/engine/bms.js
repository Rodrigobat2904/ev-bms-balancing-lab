/**
 * VoltGuard BMS — 4S1P Lithium-Ion EV Battery Management System & Cell Balancing Engine
 * Models NMC Li-Ion non-linear OCV-SoC curve, Coulomb counting, I^2R thermal dynamics,
 * MOSFET passive shunt cell balancing, and OVP/UVP/OCP/OTP main contactor protection.
 */

class EVBatteryBMS {
  constructor() {
    this.nominalCapacityAh = 5.0;
    this.ambientTempC = 26.0;
    this.shuntResistanceOhm = 6.8; // ~600mA bleed current at 4.1V

    // Operating mode: 'CHARGE' | 'DISCHARGE' | 'STANDBY'
    this.mode = 'CHARGE';
    this.packCurrentAmp = 12.0; // Positive = Charging, Negative = Discharging
    this.balancingEnabled = false;
    this.coolingFanEnabled = false;

    // Protection Matrix Status
    this.contactorClosed = true;
    this.faultCode = 'NONE'; // 'NONE' | 'OVP' | 'UVP' | 'OCP' | 'OTP'
    this.faultDetail = 'All 4 Series NMC Cells within safe operating envelope.';

    // 4 Series NMC Li-Ion Cells
    this.cells = [];
    this.loadScenario('unbalanced_pack');
  }

  /**
   * Non-linear NMC Lithium-Ion OCV(SoC) lookup function (SoC in 0..100%)
   */
  socToOcv(socPct) {
    const s = Math.max(0, Math.min(100, socPct)) / 100;
    // Realistic NMC 3.00V (0%) -> 3.68V (50%) -> 4.20V (100%) curve
    return Number((3.00 + 1.02 * s + 0.18 * Math.pow(s, 3) - 0.12 * Math.sin(Math.PI * s) * 0.25).toFixed(4));
  }

  loadScenario(scenarioId) {
    this.contactorClosed = true;
    this.faultCode = 'NONE';
    this.faultDetail = 'Pack operating normally.';

    if (scenarioId === 'unbalanced_pack') {
      // Cell 1 is much higher SoC (89%) while Cell 3 is lagging (68%) -> ~240 mV imbalance!
      this.mode = 'CHARGE';
      this.packCurrentAmp = 10.0;
      this.balancingEnabled = false;
      this.coolingFanEnabled = false;
      this.cells = [
        { id: 1, soc: 89.0, tempC: 31.2, rIntOhm: 0.018, shunting: false },
        { id: 2, soc: 78.5, tempC: 30.4, rIntOhm: 0.017, shunting: false },
        { id: 3, soc: 68.0, tempC: 29.8, rIntOhm: 0.019, shunting: false },
        { id: 4, soc: 79.0, tempC: 30.5, rIntOhm: 0.017, shunting: false }
      ];
    } else if (scenarioId === 'balanced_optimal') {
      this.mode = 'CHARGE';
      this.packCurrentAmp = 10.0;
      this.balancingEnabled = true;
      this.coolingFanEnabled = true;
      this.cells = [
        { id: 1, soc: 84.2, tempC: 28.5, rIntOhm: 0.017, shunting: false },
        { id: 2, soc: 84.0, tempC: 28.4, rIntOhm: 0.017, shunting: false },
        { id: 3, soc: 83.9, tempC: 28.6, rIntOhm: 0.017, shunting: false },
        { id: 4, soc: 84.1, tempC: 28.4, rIntOhm: 0.017, shunting: false }
      ];
    } else if (scenarioId === 'thermal_overtemp') {
      // Simulate Cell 3 thermal runaway warning (> 62°C -> triggers OTP cutoff!)
      this.mode = 'DISCHARGE';
      this.packCurrentAmp = -28.0;
      this.balancingEnabled = false;
      this.coolingFanEnabled = false;
      this.cells = [
        { id: 1, soc: 62.0, tempC: 44.0, rIntOhm: 0.018, shunting: false },
        { id: 2, soc: 61.5, tempC: 45.2, rIntOhm: 0.018, shunting: false },
        { id: 3, soc: 59.0, tempC: 63.5, rIntOhm: 0.038, shunting: false },
        { id: 4, soc: 61.8, tempC: 44.5, rIntOhm: 0.018, shunting: false }
      ];
    }

    return this.updateTelemetry(0);
  }

  /**
   * Instantaneously equalize cells when user clicks Auto-Balance & Stabilize Pack
   */
  equalizeCellsInstant() {
    this.balancingEnabled = true;
    this.coolingFanEnabled = true;
    this.contactorClosed = true;
    this.faultCode = 'NONE';
    const avgSoc = this.cells.reduce((acc, c) => acc + c.soc, 0) / this.cells.length;
    this.cells.forEach((c, idx) => {
      c.soc = Number((avgSoc + (idx - 1.5) * 0.08).toFixed(2));
      c.tempC = Number((29.0 + idx * 0.2).toFixed(1));
    });
    return this.updateTelemetry(0);
  }

  /**
   * Step BMS electro-thermal physics forward by dtSec (accelerated simulation time)
   */
  updateTelemetry(dtSec = 0.2) {
    // 1. Determine effective pack current
    let iPack = 0;
    if (this.contactorClosed) {
      if (this.mode === 'CHARGE') iPack = Math.abs(this.packCurrentAmp);
      else if (this.mode === 'DISCHARGE') iPack = -Math.abs(this.packCurrentAmp);
    }

    // Find minimum cell OCV for passive balancing threshold
    const ocvs = this.cells.map(c => this.socToOcv(c.soc));
    const minOcv = Math.min(...ocvs);

    let packVoltage = 0;
    let maxV = -Infinity;
    let minV = Infinity;
    let maxTemp = -Infinity;

    this.cells.forEach(c => {
      const ocv = this.socToOcv(c.soc);
      // Determine if MOSFET shunt bleed resistor is active for this cell
      // Bleed cells that exceed minOcv by more than 12 mV (0.012V)
      c.shunting = Boolean(this.balancingEnabled && (ocv - minOcv > 0.012));
      const iBleed = c.shunting ? (ocv / this.shuntResistanceOhm) * 6.5 : 0; // Accelerated balancing rate

      const netCellCurrent = iPack - iBleed;

      if (dtSec > 0) {
        // Coulomb counting: dSoC (%) = (I * dt_hours / Capacity_Ah) * 100
        // Accelerated factor (x25) so user sees real-time balancing on screen
        const dSoc = ((netCellCurrent * (dtSec * 25)) / (this.nominalCapacityAh * 3600)) * 100;
        c.soc = Math.max(2, Math.min(99.8, Number((c.soc + dSoc).toFixed(3))));

        // Thermal dynamics: Joule heating I^2 * R_int + Shunt heat - Cooling convection
        const jouleHeat = Math.pow(iPack, 2) * c.rIntOhm * 0.035 + (c.shunting ? 0.06 : 0);
        const coolingCoeff = this.coolingFanEnabled ? 0.35 : 0.07;
        const dTemp = (jouleHeat - coolingCoeff * (c.tempC - this.ambientTempC)) * dtSec;
        c.tempC = Number(Math.max(this.ambientTempC, c.tempC + dTemp).toFixed(2));
      }

      const newOcv = this.socToOcv(c.soc);
      const vTerm = Number((newOcv + iPack * c.rIntOhm).toFixed(3));
      c.ocv = newOcv;
      c.vTerm = vTerm;

      packVoltage += vTerm;
      if (vTerm > maxV) maxV = vTerm;
      if (vTerm < minV) minV = vTerm;
      if (c.tempC > maxTemp) maxTemp = c.tempC;
    });

    const deltaMV = Math.round((maxV - minV) * 1000);

    // Protection Matrix Evaluation (OVP > 4.23V, UVP < 2.95V, OCP > 40A, OTP > 60°C)
    if (maxTemp >= 60.0) {
      this.contactorClosed = false;
      this.faultCode = 'OTP (OVER-TEMP TRIP)';
      this.faultDetail = `CRITICAL: Cell temperature reached ${maxTemp.toFixed(1)}°C (> 60°C limit). Main MOSFET Contactor OPENED!`;
    } else if (Math.abs(iPack) > 40.0) {
      this.contactorClosed = false;
      this.faultCode = 'OCP (OVER-CURRENT TRIP)';
      this.faultDetail = `CRITICAL: Pack current ${Math.abs(iPack)}A exceeded 40A hardware limit. Main Contactor OPENED!`;
    } else if (maxV >= 4.24) {
      this.contactorClosed = false;
      this.faultCode = 'OVP (OVER-VOLTAGE TRIP)';
      this.faultDetail = `Cell Over-Voltage (${maxV.toFixed(3)}V >= 4.24V) triggered cutoff.`;
    } else if (minV <= 2.95) {
      this.contactorClosed = false;
      this.faultCode = 'UVP (UNDER-VOLTAGE TRIP)';
      this.faultDetail = `Cell Under-Voltage (${minV.toFixed(3)}V <= 2.95V) triggered cutoff.`;
    } else if (this.faultCode === 'NONE') {
      this.contactorClosed = true;
      this.faultDetail = deltaMV > 40
        ? `WARNING: High Cell Voltage Imbalance (ΔV = ${deltaMV} mV). Enable Active MOSFET Balancing!`
        : `OPTIMAL: Pack balanced (ΔV = ${deltaMV} mV <= 40 mV) and thermally stable.`;
    }

    const avgSoc = Number((this.cells.reduce((a, c) => a + c.soc, 0) / 4).toFixed(1));

    this.telemetry = {
      packVoltage: Number(packVoltage.toFixed(2)),
      packCurrent: this.contactorClosed ? iPack : 0,
      avgSoc,
      deltaMV,
      maxTemp: Number(maxTemp.toFixed(1)),
      contactorClosed: this.contactorClosed,
      faultCode: this.faultCode,
      faultDetail: this.faultDetail,
      isBalanced: deltaMV <= 35 && this.contactorClosed
    };

    return this.telemetry;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EVBatteryBMS };
}

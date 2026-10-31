/**
 * Automated Verification Suite for VoltGuard 4S EV Battery Management System (BMS)
 */
const assert = require('assert');
const { EVBatteryBMS } = require('../js/engine/bms.js');

console.log('--- RUNNING VOLTGUARD 4S EV BMS & CELL BALANCING TESTS ---');

const bms = new EVBatteryBMS();

// 1. Test initial unbalanced pack state (ΔV > 200 mV)
const init = bms.loadScenario('unbalanced_pack');
assert.ok(init.deltaMV > 200, `Expected high initial cell voltage imbalance > 200mV, got ${init.deltaMV}mV`);
assert.strictEqual(init.isBalanced, false);
console.log(`✓ Unbalanced 4S Pack Detected: V_pack=${init.packVoltage}V, ΔV=${init.deltaMV}mV`);

// 2. Test MOSFET Passive Shunt Balancing convergence
bms.balancingEnabled = true;
bms.coolingFanEnabled = true;
for (let step = 0; step < 300; step++) {
  bms.updateTelemetry(0.5);
}
const afterBal = bms.telemetry;
assert.ok(afterBal.deltaMV < init.deltaMV * 0.4, `Expected balancing to significantly reduce ΔV (from ${init.deltaMV}mV to ${afterBal.deltaMV}mV)`);
console.log(`✓ MOSFET Shunt Balancing Active: ΔV reduced from ${init.deltaMV}mV to ${afterBal.deltaMV}mV`);

// 3. Test Thermal Runaway Over-Temperature Protection (OTP > 60°C)
const otp = bms.loadScenario('thermal_overtemp');
assert.strictEqual(otp.contactorClosed, false, 'Expected Main Contactor to trip OPEN on Over-Temperature (>60°C)');
assert.ok(otp.faultCode.includes('OTP'), `Expected OTP fault code, got ${otp.faultCode}`);
console.log(`✓ Thermal Protection Cutoff Verified: ${otp.faultCode} at ${otp.maxTemp}°C (Contactor OPEN)`);

console.log('--- ALL VOLTGUARD EV BMS TESTS PASSED! ---');

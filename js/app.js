/**
 * VoltGuard BMS — Main Application Controller & 4S NMC Cell Balancing Visualizer
 */

class VoltGuardApp {
  constructor() {
    this.bms = new EVBatteryBMS();
    this.historyV = [[], [], [], []];
    this.maxHistory = 140;

    this.initDOM();
    this.attachEvents();
    this.seedHistory();
    this.updateUI();
    this.startLoop();
  }

  initDOM() {
    this.alertBanner = document.getElementById('alert-banner');
    this.kpiVpack = document.getElementById('kpi-vpack');
    this.kpiVpackSub = document.getElementById('kpi-vpack-sub');
    this.kpiDelta = document.getElementById('kpi-delta');
    this.kpiDeltaSub = document.getElementById('kpi-delta-sub');
    this.kpiTemp = document.getElementById('kpi-temp');
    this.kpiTempSub = document.getElementById('kpi-temp-sub');
    this.kpiContactor = document.getElementById('kpi-contactor');
    this.kpiContactorSub = document.getElementById('kpi-contactor-sub');

    this.cellsGrid = document.getElementById('cells-grid');
    this.chartCanvas = document.getElementById('bms-chart-canvas');

    this.btnToggleBal = document.getElementById('btn-toggle-bal');
    this.btnToggleFan = document.getElementById('btn-toggle-fan');
    this.currentSlider = document.getElementById('slider-current');
    this.currentValTxt = document.getElementById('val-current');
  }

  seedHistory() {
    this.historyV = [[], [], [], []];
    this.bms.balancingEnabled = true;
    for (let i = 0; i < this.maxHistory; i++) {
      this.bms.updateTelemetry(0.08);
      this.bms.cells.forEach((c, idx) => {
        this.historyV[idx].push(c.vTerm);
      });
    }
  }

  attachEvents() {
    document.getElementById('btn-scen-unbal').addEventListener('click', () => {
      this.bms.loadScenario('unbalanced_pack');
      this.seedHistory();
      this.updateUI();
    });

    document.getElementById('btn-scen-bal').addEventListener('click', () => {
      this.bms.equalizeCellsInstant();
      this.seedHistory();
      this.updateUI();
    });

    document.getElementById('btn-scen-otp').addEventListener('click', () => {
      this.bms.loadScenario('thermal_overtemp');
      this.seedHistory();
      this.updateUI();
    });

    this.btnToggleBal.addEventListener('click', () => {
      this.bms.balancingEnabled = !this.bms.balancingEnabled;
      this.bms.updateTelemetry(0);
      this.updateUI();
    });

    this.btnToggleFan.addEventListener('click', () => {
      this.bms.coolingFanEnabled = !this.bms.coolingFanEnabled;
      if (this.bms.coolingFanEnabled && this.bms.faultCode.includes('OTP')) {
        this.bms.cells.forEach(c => { c.tempC = Math.min(c.tempC, 42.0); });
        this.bms.faultCode = 'NONE';
        this.bms.contactorClosed = true;
      }
      this.bms.updateTelemetry(0);
      this.updateUI();
    });

    this.currentSlider.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      this.bms.packCurrentAmp = Math.abs(val);
      this.bms.mode = val >= 0 ? 'CHARGE' : 'DISCHARGE';
      this.bms.updateTelemetry(0);
      this.updateUI();
    });
  }

  updateUI() {
    const t = this.bms.telemetry;

    let bannerClass = 'ok';
    if (!t.contactorClosed) bannerClass = 'trip';
    else if (!t.isBalanced) bannerClass = 'warn';

    this.alertBanner.className = `alert-banner ${bannerClass}`;
    this.alertBanner.innerHTML = `
      <span>🔋 BMS DIAGNOSTIC: ${t.faultDetail}</span>
      <span>Fault Status: ${t.faultCode}</span>
    `;

    this.kpiVpack.style.color = '#ff7733';
    this.kpiVpack.textContent = `${t.packVoltage.toFixed(2)} V`;
    this.kpiVpackSub.textContent = `Avg SoC: ${t.avgSoc}% | I = ${t.packCurrent.toFixed(1)} A`;

    this.kpiDelta.style.color = t.deltaMV <= 35 ? '#a3e635' : '#ff5500';
    this.kpiDelta.textContent = `${t.deltaMV} mV`;
    this.kpiDeltaSub.textContent = t.deltaMV <= 35 ? 'Balanced (< 35 mV)' : 'Imbalance Detected!';

    this.kpiTemp.style.color = t.maxTemp >= 55 ? '#ff2a55' : '#a3e635';
    this.kpiTemp.textContent = `${t.maxTemp}°C`;
    this.kpiTempSub.textContent = `OTP Cutoff Threshold: 60.0°C`;

    this.kpiContactor.style.color = t.contactorClosed ? '#a3e635' : '#ff2a55';
    this.kpiContactor.textContent = t.contactorClosed ? 'CLOSED (ON)' : 'TRIPPED OPEN';
    this.kpiContactorSub.textContent = t.contactorClosed ? 'HV Bus Energized' : 'Safety Cutoff Active';

    this.btnToggleBal.className = `ev-btn ev-btn-wide ${this.bms.balancingEnabled ? 'btn-bal' : ''}`;
    this.btnToggleBal.textContent = this.bms.balancingEnabled
      ? '⚡ Passive MOSFET Shunt Balancing: ACTIVE'
      : '⚡ Enable MOSFET Shunt Cell Balancing';

    this.btnToggleFan.className = `ev-btn ev-btn-wide ${this.bms.coolingFanEnabled ? 'btn-bal' : ''}`;
    this.btnToggleFan.textContent = this.bms.coolingFanEnabled
      ? '❄️ Active Liquid/Fan Thermal Cooling: ON (Reset OTP)'
      : '❄️ Enable Active Thermal Cooling & Clear OTP';

    const signedCurr = this.bms.mode === 'CHARGE' ? this.bms.packCurrentAmp : -this.bms.packCurrentAmp;
    this.currentValTxt.textContent = `${signedCurr > 0 ? '+' : ''}${signedCurr.toFixed(0)} A (${this.bms.mode})`;

    this.renderCells();
  }

  renderCells() {
    this.cellsGrid.innerHTML = this.bms.cells.map(c => {
      const fillCol = c.tempC >= 58
        ? 'linear-gradient(90deg, #991b1b, #ff2a55)'
        : (c.shunting ? 'linear-gradient(90deg, #b45309, #ff5500)' : 'linear-gradient(90deg, #3f6212, #84cc16)');
      return `
        <div class="cell-pouch-row ${c.shunting ? 'shunting' : ''}">
          <div class="pouch-top">
            <span style="color:#ffffff;">POUCH CELL #0${c.id} // NMC-21700</span>
            <span style="color:${c.tempC >= 55 ? '#ff2a55' : '#a3e635'}">TEMP: ${c.tempC.toFixed(1)}°C</span>
          </div>
          <div class="pouch-bar-track">
            <div class="pouch-bar-fill" style="width:${c.soc}%;background:${fillCol};"></div>
            <div class="pouch-bar-overlay">
              <span>${c.vTerm.toFixed(3)} V</span>
              <span>SoC: ${c.soc.toFixed(1)}%</span>
            </div>
          </div>
          <div class="pouch-shunt-status">
            <span style="color:${c.shunting ? '#ff7733' : '#71717a'}">
              ${c.shunting ? '🔥 MOSFET SHUNT BLEEDING (6.8Ω ON)' : '● SHUNT MOSFET: STANDBY OFF'}
            </span>
            <span style="color:#a19eb5;">I_bleed: ${c.shunting ? (c.vTerm / 6.8).toFixed(2) : '0.00'} A</span>
          </div>
        </div>
      `;
    }).join('');
  }

  drawChart() {
    const canvas = this.chartCanvas;
    const rect = canvas.parentElement.getBoundingClientRect();
    if (canvas.width !== Math.floor(rect.width) || canvas.height !== Math.floor(rect.height)) {
      canvas.width = Math.floor(rect.width);
      canvas.height = Math.floor(rect.height);
    }

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
    ctx.beginPath();
    for (let y = 20; y < h; y += 35) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();

    const colors = ['#38bdf8', '#10b981', '#f43f5e', '#a855f7'];
    const vMin = 3.55;
    const vMax = 4.25;

    this.historyV.forEach((arr, idx) => {
      if (arr.length < 2) return;
      ctx.strokeStyle = colors[idx];
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let i = 0; i < arr.length; i++) {
        const x = (i / (this.maxHistory - 1)) * w;
        const norm = (arr[i] - vMin) / (vMax - vMin);
        const y = h - 18 - Math.max(0, Math.min(1, norm)) * (h - 36);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });

    ctx.font = '700 11px JetBrains Mono, monospace';
    colors.forEach((col, idx) => {
      ctx.fillStyle = col;
      ctx.fillText(`─── Cell ${idx + 1} (${this.bms.cells[idx].vTerm.toFixed(3)}V)`, 14 + idx * 155, 18);
    });
  }

  startLoop() {
    let tickCount = 0;
    const loop = () => {
      tickCount++;
      if (tickCount % 4 === 0) {
        this.bms.updateTelemetry(0.18);
        this.bms.cells.forEach((c, idx) => {
          this.historyV[idx].push(c.vTerm);
          if (this.historyV[idx].length > this.maxHistory) this.historyV[idx].shift();
        });
        this.updateUI();
      }
      this.drawChart();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.voltGuardApp = new VoltGuardApp();
});

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
    for (let i = 0; i < 60; i++) {
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

    this.kpiVpack.style.color = '#38bdf8';
    this.kpiVpack.textContent = `${t.packVoltage.toFixed(2)} V`;
    this.kpiVpackSub.textContent = `Avg SoC: ${t.avgSoc}% | I = ${t.packCurrent.toFixed(1)} A`;

    this.kpiDelta.style.color = t.deltaMV <= 35 ? '#10b981' : '#f59e0b';
    this.kpiDelta.textContent = `${t.deltaMV} mV`;
    this.kpiDeltaSub.textContent = t.deltaMV <= 35 ? 'Balanced (< 35 mV)' : 'Imbalance Detected!';

    this.kpiTemp.style.color = t.maxTemp >= 55 ? '#f43f5e' : '#10b981';
    this.kpiTemp.textContent = `${t.maxTemp}°C`;
    this.kpiTempSub.textContent = `OTP Cutoff Threshold: 60.0°C`;

    this.kpiContactor.style.color = t.contactorClosed ? '#10b981' : '#f43f5e';
    this.kpiContactor.textContent = t.contactorClosed ? 'CLOSED (ON)' : 'TRIPPED OPEN';
    this.kpiContactorSub.textContent = t.contactorClosed ? 'HV Bus Energized' : 'Safety Cutoff Active';

    this.btnToggleBal.className = `btn ${this.bms.balancingEnabled ? 'btn-bal' : ''}`;
    this.btnToggleBal.textContent = this.bms.balancingEnabled
      ? '⚡ Passive MOSFET Shunt Balancing: ACTIVE'
      : '⚡ Enable MOSFET Shunt Cell Balancing';

    this.btnToggleFan.className = `btn ${this.bms.coolingFanEnabled ? 'btn-bal' : ''}`;
    this.btnToggleFan.textContent = this.bms.coolingFanEnabled
      ? '❄️ Active Liquid/Fan Thermal Cooling: ON (Reset OTP)'
      : '❄️ Enable Active Thermal Cooling & Clear OTP';

    const signedCurr = this.bms.mode === 'CHARGE' ? this.bms.packCurrentAmp : -this.bms.packCurrentAmp;
    this.currentValTxt.textContent = `${signedCurr > 0 ? '+' : ''}${signedCurr.toFixed(0)} A (${this.bms.mode})`;

    this.renderCells();
  }

  renderCells() {
    this.cellsGrid.innerHTML = this.bms.cells.map(c => {
      const fillCol = c.tempC >= 58 ? '#f43f5e' : (c.shunting ? '#f59e0b' : '#10b981');
      return `
        <div class="cell-card ${c.shunting ? 'shunting' : ''}">
          <div class="cell-head">
            <span>CELL #0${c.id} (NMC)</span>
            <span style="color:${c.tempC >= 55 ? '#f43f5e' : '#94a3b8'}">${c.tempC.toFixed(1)}°C</span>
          </div>
          <div class="battery-bar-outer">
            <div class="battery-bar-fill" style="height:${c.soc}%;background:${fillCol};"></div>
            <div class="battery-bar-txt">
              <span>${c.vTerm.toFixed(3)} V</span>
              <span style="font-size:0.78rem;color:#cbd5e1;">SoC: ${c.soc.toFixed(1)}%</span>
            </div>
          </div>
          <div class="shunt-badge ${c.shunting ? 'on' : 'off'}">
            ${c.shunting ? '🔥 SHUNT BLEEDING (6.8Ω ON)' : 'SHUNT MOSFET: OFF'}
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

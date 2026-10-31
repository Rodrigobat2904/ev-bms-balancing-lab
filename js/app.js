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
    this.bms.packCurrentAmp = 4;
    this.currentSlider.value = 4;
    for (let i = 0; i < this.maxHistory; i++) {
      this.bms.updateTelemetry(0.05);
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
      <span>BMS Diagnostic: ${t.faultDetail}</span>
      <span>Fault Status: ${t.faultCode}</span>
    `;

    this.kpiVpack.style.color = '#18181b';
    this.kpiVpack.textContent = `${t.packVoltage.toFixed(2)} V`;
    this.kpiVpackSub.textContent = `Avg SoC: ${t.avgSoc}% | I = ${t.packCurrent.toFixed(1)} A`;

    this.kpiDelta.style.color = t.deltaMV <= 35 ? '#16a34a' : '#d97706';
    this.kpiDelta.textContent = `${t.deltaMV} mV`;
    this.kpiDeltaSub.textContent = t.deltaMV <= 35 ? 'Balanced (< 35 mV)' : 'Imbalance Detected';

    this.kpiTemp.style.color = t.maxTemp >= 55 ? '#e11d48' : '#16a34a';
    this.kpiTemp.textContent = `${t.maxTemp}°C`;
    this.kpiTempSub.textContent = `OTP Cutoff: 60.0°C`;

    this.kpiContactor.style.color = t.contactorClosed ? '#16a34a' : '#e11d48';
    this.kpiContactor.textContent = t.contactorClosed ? 'CLOSED (ON)' : 'TRIPPED OPEN';
    this.kpiContactorSub.textContent = t.contactorClosed ? 'HV Bus Energized' : 'Safety Cutoff Active';

    this.btnToggleBal.className = `btn-action ${this.bms.balancingEnabled ? 'btn-bal' : ''}`;
    this.btnToggleBal.textContent = this.bms.balancingEnabled
      ? 'Passive MOSFET Shunt Balancing: Active'
      : 'Enable MOSFET Shunt Cell Balancing';

    this.btnToggleFan.className = `btn-action ${this.bms.coolingFanEnabled ? 'btn-bal' : ''}`;
    this.btnToggleFan.textContent = this.bms.coolingFanEnabled
      ? 'Active Thermal Cooling: ON (Reset OTP)'
      : 'Enable Active Thermal Cooling & Reset OTP';

    const signedCurr = this.bms.mode === 'CHARGE' ? this.bms.packCurrentAmp : -this.bms.packCurrentAmp;
    this.currentValTxt.textContent = `${signedCurr > 0 ? '+' : ''}${signedCurr.toFixed(0)} A (${this.bms.mode})`;

    this.renderCells();
  }

  renderCells() {
    this.cellsGrid.innerHTML = this.bms.cells.map(c => {
      const fillCol = c.tempC >= 58 ? '#e11d48' : (c.shunting ? '#d97706' : '#16a34a');
      return `
        <div class="cell-card ${c.shunting ? 'shunting' : ''}">
          <div class="cell-top">
            <span class="cell-name">Cell 0${c.id} · NMC 21700</span>
            <span class="cell-temp" style="color:${c.tempC >= 55 ? '#e11d48' : '#52525b'}">${c.tempC.toFixed(1)}°C</span>
          </div>
          <div class="cell-main-readout">
            <span class="cell-volt">${c.vTerm.toFixed(3)} V</span>
            <span class="cell-soc">${c.soc.toFixed(1)}% SoC</span>
          </div>
          <div class="cell-progress-track">
            <div class="cell-progress-fill" style="width:${c.soc}%;background:${fillCol};"></div>
          </div>
          <div class="cell-foot">
            <span class="shunt-pill ${c.shunting ? 'on' : ''}">
              ${c.shunting ? '● Shunt Bleeding (6.8Ω)' : '○ Shunt Standby'}
            </span>
            <span>${c.shunting ? (c.vTerm / 6.8).toFixed(2) + ' A' : '0.00 A'}</span>
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

    ctx.strokeStyle = '#f4f4f5';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = 24; y < h; y += 36) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    for (let x = 0; x < w; x += 60) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    ctx.stroke();

    const colors = ['#2563eb', '#16a34a', '#d97706', '#7c3aed'];
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
        const y = h - 18 - Math.max(0, Math.min(1, norm)) * (h - 38);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });

    ctx.font = '600 11px Inter, sans-serif';
    colors.forEach((col, idx) => {
      ctx.fillStyle = col;
      ctx.fillText(`─── Cell 0${idx + 1} (${this.bms.cells[idx].vTerm.toFixed(3)}V)`, 14 + idx * 155, 20);
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

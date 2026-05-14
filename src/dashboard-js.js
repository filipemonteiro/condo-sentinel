// filepath: src/dashboard-js.js
/**
 * JavaScript logic for the dashboard
 */

export function dashboardJs(options) {
  const sessionTimeoutMinutes = Math.max(1, options.sessionTimeoutMinutes || 30);
  const userRole = options.userRole || 'viewer';

  return `
    const charts = {};
    const SESSION_TIMEOUT_MS = ${sessionTimeoutMinutes} * 60 * 1000;
    const TOKEN_STORAGE_KEY = 'condoSentinel.dashboardToken';
    const ACTIVITY_STORAGE_KEY = 'condoSentinel.lastActivityAt';
    let refreshTimer = null;
    let currentSection = 'dashboard';

    function escHtml(str) {
      if (str === null || str === undefined) return '-';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function getStoredToken() {
      return sessionStorage.getItem(TOKEN_STORAGE_KEY) || '';
    }

    function getLastActivityAt() {
      return Number(sessionStorage.getItem(ACTIVITY_STORAGE_KEY) || 0);
    }

    function hasActiveSession() {
      const token = getStoredToken();
      const lastActivityAt = getLastActivityAt();
      return !!token && !!lastActivityAt && Date.now() - lastActivityAt <= SESSION_TIMEOUT_MS;
    }

    function touchSession() {
      if (getStoredToken()) {
        sessionStorage.setItem(ACTIVITY_STORAGE_KEY, String(Date.now()));
      }
    }

    function clearSession() {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      sessionStorage.removeItem(ACTIVITY_STORAGE_KEY);
    }

    function showAuth(message) {
      clearSession();
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }

      document.getElementById('app-shell').classList.add('locked');
      document.getElementById('auth-screen').classList.add('active');

      const error = document.getElementById('auth-error');
      error.textContent = message || '';
      error.style.display = message ? 'block' : 'none';
      document.getElementById('dashboard-token').focus();
    }

    function showDashboard() {
      document.getElementById('auth-screen').classList.remove('active');
      document.getElementById('app-shell').classList.remove('locked');
      showSection('dashboard');
    }

    async function authenticatedFetch(url, options = {}) {
      if (!hasActiveSession()) {
        showAuth('Sessão expirada por inatividade.');
        throw new Error('Sessão expirada');
      }

      try {
        const res = await fetch(url, {
          ...options,
          headers: {
            Authorization: 'Bearer ' + getStoredToken(),
            ...options.headers
          }
        });

        if (res.status === 401 || res.status === 503) {
          showAuth(res.status === 503 ? 'Token não configurado no servidor.' : 'Token inválido ou sessão expirada.');
          throw new Error('Não autorizado');
        }

        if (!res.ok) {
          const errorText = await res.text().catch(() => 'unknown error');
          console.error('API error:', { status: res.status, url, error: errorText });
          throw new Error('Erro na requisição: ' + res.status);
        }

        touchSession();
        return res;
      } catch (err) {
        console.error('Fetch failed:', { url, error: err.message });
        throw err;
      }
    }

    function formatTs(ts) {
      if (!ts) return "-";
      return new Date(ts).toLocaleString("pt-BR");
    }

    function minutesAgo(ts) {
      if (!ts) return null;
      return Math.max(0, Math.floor((Date.now() - ts) / 60000));
    }

    function badge(label, cls) {
      return '<span class="badge ' + cls + '">' + label + '</span>';
    }

    function showSection(section) {
      document.querySelectorAll('.section').forEach(el => el.classList.remove('active'));
      document.getElementById(section).classList.add('active');
      document.querySelectorAll('.menu button').forEach(btn => btn.classList.remove('active'));
      document.querySelector('[data-section="' + section + '"]').classList.add('active');
      currentSection = section;
    }

    async function loadStatus() {
      const res = await authenticatedFetch('/api/status');
      return res.json();
    }

    async function loadHistory(deviceId) {
      const res = await authenticatedFetch('/api/history?device=' + encodeURIComponent(deviceId));
      return res.json();
    }

    async function loadConfig() {
      const res = await authenticatedFetch('/api/dashboard-context');
      return res.json();
    }

    async function saveConfig(config) {
      const res = await authenticatedFetch('/api/dashboard-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      return res.json();
    }

    function card(title, value) {
      return '<div class="card"><div class="muted">' + escHtml(title) + '</div><div style="font-size:28px;font-weight:bold;margin-top:8px;">' + escHtml(String(value)) + '</div></div>';
    }

    function renderSummary(summary) {
      const root = document.getElementById('summary');
      root.innerHTML = [
        card('Total de devices', summary.totalDevices),
        card('Online', summary.onlineDevices),
        card('Offline', summary.offlineDevices),
        card('Desatualizados', summary.staleDevices),
        card('Em alarme', summary.devicesInAlarm),
        card('Com falha', summary.devicesWithFault),
        card('Nível baixo', summary.devicesLowLevel),
      ].join('');
    }

    function deviceStatusBadges(device) {
      const items = [];

      items.push(device.online ? badge('Online', 'ok') : badge('Offline', 'bad'));

      if (device.stale) items.push(badge('Sem atualização recente', 'info'));
      if (device.batteryLowAlertActive) items.push(badge('Bateria baixa', 'warn'));
      if (device.lowLevelAlertActive) items.push(badge('Nível baixo', 'warn'));
      if (device.sensorFaultActive) items.push(badge('Leitura inválida', 'bad'));
      if (device.alarmActive) items.push(badge('Alarme', 'bad'));

      if (!device.stale && !device.lowLevelAlertActive && !device.sensorFaultActive && !device.alarmActive && !device.batteryLowAlertActive) {
        items.push(badge('Sem alerta ativo', 'neutral'));
      }

      return items.join('');
    }

    function getReadingFreshnessText(device) {
      const mins = minutesAgo(device.readingUpdatedAt);
      if (mins === null) return 'Sem leitura registrada';
      if (mins === 0) return 'Leitura atualizada há menos de 1 min';
      return 'Última leitura válida há ' + mins + ' min';
    }

    function renderDeviceCard(device) {
      let extra = '';

      if (device.type === 'water_level_sensor') {
        extra = \`
          <div><strong>Nível:</strong> \${escHtml(device.lastReading?.percent) ?? '-' }%</div>
          <div><strong>Estado:</strong> \${escHtml(device.lastReading?.liquidState) ?? '-'}</div>
          <div><strong>Bateria:</strong> \${escHtml(device.lastReading?.battery) ?? '-' }%</div>
          <div><strong>Breach count:</strong> \${escHtml(device.breachCount) ?? 0}</div>
          <div class="small" style="margin-top:6px;">\${escHtml(getReadingFreshnessText(device))}</div>
          <canvas id="chart-\${escHtml(device.id)}"></canvas>
        \`;
      } else if (device.type === 'gas_sensor' || device.type === 'water_leak_sensor') {
        extra = \`
          <div><strong>Alarme:</strong> \${escHtml(device.lastReading?.alarmValue) ?? '-'}</div>
          <div><strong>Bateria:</strong> \${escHtml(device.lastReading?.battery) ?? '-' }%</div>
          <div class="small" style="margin-top:6px;">\${escHtml(getReadingFreshnessText(device))}</div>
          <canvas id="chart-\${escHtml(device.id)}"></canvas>
        \`;
      } else if (device.type === 'valve') {
        extra = \`
          <div><strong>Status:</strong> \${escHtml(device.lastReading?.currentValue) ?? '-'}</div>
          <div class="small" style="margin-top:6px;">\${escHtml(getReadingFreshnessText(device))}</div>
        \`;
      } else {
        extra = '<div class="muted">Tipo ainda sem visual específico.</div>';
      }

      return \`
        <div class="card">
          <h3 style="margin-top:0;">\${escHtml(device.name)}</h3>
          <div class="muted">\${escHtml(device.role) || '-'} • \${escHtml(device.type)}</div>
          <div style="margin:10px 0;">\${deviceStatusBadges(device)}</div>
          <div><strong>Última checagem do worker:</strong> \${escHtml(formatTs(device.lastSeenAt))}</div>
          <div><strong>Leitura registrada:</strong> \${escHtml(formatTs(device.readingUpdatedAt))}</div>
          \${extra}
        </div>
      \`;
    }

    async function renderDevices(devices) {
      const root = document.getElementById('devices');
      root.innerHTML = devices.map(renderDeviceCard).join('');

      for (const device of devices) {
        if (device.type === 'water_level_sensor' || device.type === 'gas_sensor' || device.type === 'water_leak_sensor') {
          const historyPayload = await loadHistory(device.id);
          renderChart(device, historyPayload.points || []);
        }
      }
    }

    function buildWaterDataset(points) {
      const labels = points.map(p => new Date(p.ts).toLocaleTimeString('pt-BR'));
      const values = points.map(p => (typeof p.percent === 'number' ? p.percent : null));

      return {
        labels,
        datasets: [
          {
            label: 'Nível %',
            data: values,
            spanGaps: true,
            tension: 0.2
          }
        ]
      };
    }

    function buildBinaryDataset(points, label) {
      const labels = points.map(p => new Date(p.ts).toLocaleTimeString('pt-BR'));
      const values = points.map(p => p.alarm ? 1 : 0);

      return {
        labels,
        datasets: [
          {
            label,
            data: values,
            spanGaps: true,
            stepped: true
          }
        ]
      };
    }

    function buildPointStyles(points) {
      return points.map(p => p.online === false ? 6 : 3);
    }

    function buildPointRadius(points) {
      return points.map(p => p.online === false ? 5 : 2);
    }

    function renderChart(device, points) {
      const el = document.getElementById('chart-' + device.id);
      if (!el) return;

      let chartData;
      let yConfig = {};

      if (device.type === 'water_level_sensor') {
        chartData = buildWaterDataset(points);
        chartData.datasets[0].pointStyle = buildPointStyles(points);
        chartData.datasets[0].pointRadius = buildPointRadius(points);
        yConfig = {
          min: 0,
          max: 100
        };
      } else {
        chartData = buildBinaryDataset(points, 'Alarme');
        chartData.datasets[0].pointStyle = buildPointStyles(points);
        chartData.datasets[0].pointRadius = buildPointRadius(points);
        yConfig = {
          min: 0,
          max: 1,
          ticks: {
            stepSize: 1
          }
        };
      }

      if (charts[device.id]) {
        charts[device.id].destroy();
      }

      charts[device.id] = new Chart(el, {
        type: 'line',
        data: chartData,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: yConfig
          }
        }
      });
    }

    async function renderDashboard() {
      try {
        const status = await loadStatus();
        if (!status || !status.summary || !status.devices) {
          console.error('Invalid status response:', status);
          throw new Error('Invalid status response');
        }
        renderSummary(status.summary);
        await renderDevices(status.devices);
      } catch (err) {
        console.error('renderDashboard failed:', err);
        throw err;
      }
    }

    function renderConfigForm(config) {
      const form = document.getElementById('config-form');
      form.innerHTML = \`
        <label>Título do Dashboard:</label>
        <input type="text" id="config-title" value="\${escHtml(config.dashboardTitle || '')}">
        <button type="button" onclick="saveConfigForm()">Salvar</button>
      \`;
      document.getElementById('config-title').value = config.dashboardTitle || '';
    }

    async function loadAndRenderConfig() {
      const config = await loadConfig();
      renderConfigForm(config);
    }

    async function saveConfigForm() {
      try {
        const title = document.getElementById('config-title').value.trim();
        const result = await saveConfig({ dashboardTitle: title });
        if (result.success) {
          alert('Configuração salva!');
        } else {
          console.error('Save failed:', result);
          alert('Erro ao salvar: ' + (result.error || 'unknown error'));
        }
      } catch (err) {
        console.error('saveConfigForm failed:', err);
        alert('Erro ao salvar configuração.');
      }
    }

    async function init() {
      // Auth form
      document.getElementById('auth-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const token = document.getElementById('dashboard-token').value.trim();
        sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
        sessionStorage.setItem(ACTIVITY_STORAGE_KEY, String(Date.now()));
        try {
          await renderDashboard();
          showDashboard();
          refreshTimer = setInterval(() => {
            if (hasActiveSession()) {
              renderDashboard();
            } else {
              showAuth('Sessão expirada.');
            }
          }, 60000);
        } catch (err) {
          showAuth('Erro ao carregar dados.');
        }
      });

      // Menu
      document.querySelectorAll('.menu button').forEach(btn => {
        btn.addEventListener('click', () => {
          const section = btn.getAttribute('data-section');
          if (section === 'dashboard') {
            renderDashboard();
          } else if (section === 'config' && '${userRole}' === 'admin') {
            loadAndRenderConfig();
          }
          showSection(section);
        });
      });

      // Start with dashboard if logged in
      if (hasActiveSession()) {
        try {
          await renderDashboard();
          showDashboard();
          refreshTimer = setInterval(() => {
            if (hasActiveSession()) {
              renderDashboard();
            } else {
              showAuth('Sessão expirada.');
            }
          }, 60000);
        } catch (err) {
          showAuth('Erro ao carregar dados.');
        }
      } else {
        showAuth();
      }
    }

    init();
  `;
}
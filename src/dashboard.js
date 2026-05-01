// filepath: src/dashboard.js
/**
 * Dashboard HTML e construção de status
 */

import { toInt, parseJsonEnv, jsonResponse, htmlResponse } from './utils.js';
import { loadAllDeviceStates, createDefaultDeviceState } from './state.js';
import { getDeviceHistory } from './history.js';

/**
 * Constrói payload de status para o dashboard
 */
export async function buildDashboardStatus(env) {
  const devices = parseJsonEnv(env.DEVICE_REGISTRY_JSON, []);
  const automations = parseJsonEnv(env.AUTOMATIONS_JSON, []);
  const now = Date.now();
  const staleAfterMinutes = toInt(env.DASHBOARD_STALE_AFTER_MINUTES, 30);
  const staleAfterMs = staleAfterMinutes * 60 * 1000;

  // Carrega estados isolados por device
  const deviceStates = await loadAllDeviceStates(env, devices);

  const deviceViews = (Array.isArray(devices) ? devices : []).map(device => {
    const dState = deviceStates[device.id] || createDefaultDeviceState(device);
    const readingUpdatedAt = dState.lastReading?.readingUpdatedAt || null;
    const isStale =
      !!readingUpdatedAt && now - readingUpdatedAt > staleAfterMs;

    return {
      id: device.id,
      name: device.name || device.id,
      role: device.role || null,
      type: device.type,
      enabled: device.enabled !== false,
      online: dState.lastBatchIsOnline === true,
      stale: isStale,
      readingUpdatedAt,
      offlineAlertActive: !!dState.offlineAlertActive,
      sensorFaultActive: !!dState.sensorFaultActive,
      lowLevelAlertActive: !!dState.lowLevelAlertActive,
      alarmActive: !!dState.alarmActive,
      lastSeenAt: dState.lastSeenAt || null,
      lastReading: dState.lastReading || null,
      lastBatchInfo: dState.lastBatchInfo || null,
      breachCount: dState.breachCount || 0,
    };
  });

  const summary = {
    totalDevices: deviceViews.length,
    onlineDevices: deviceViews.filter(d => d.online).length,
    offlineDevices: deviceViews.filter(d => !d.online).length,
    staleDevices: deviceViews.filter(d => d.stale).length,
    devicesInAlarm: deviceViews.filter(d => d.alarmActive).length,
    devicesWithFault: deviceViews.filter(d => d.sensorFaultActive).length,
    devicesLowLevel: deviceViews.filter(d => d.lowLevelAlertActive).length,
    automationCount: Array.isArray(automations) ? automations.length : 0,
  };

  return {
    summary,
    devices: deviceViews,
    automations: {}, // TODO: carregar automations isoladamente
    generatedAt: now,
    staleAfterMinutes,
  };
}

/**
 * Retorna HTML do dashboard
 */
export function renderDashboardHtml(options = {}) {
  const sessionTimeoutMinutes = Math.max(1, toInt(options.sessionTimeoutMinutes, 30));
  const dashboardTitle = options.dashboardTitle || 'Condo Sentinel';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${dashboardTitle} - Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 0;
      background: #f4f6f8;
      color: #1f2937;
    }
    header {
      background: #0f172a;
      color: white;
      padding: 16px 20px;
    }
    main {
      padding: 20px;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .card {
      background: white;
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }
    .device-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: 16px;
    }
    .muted {
      color: #6b7280;
      font-size: 14px;
    }
    .small {
      font-size: 12px;
      color: #6b7280;
    }
    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: bold;
      margin-right: 6px;
      margin-bottom: 6px;
    }
    .ok { background: #dcfce7; color: #166534; }
    .warn { background: #fef3c7; color: #92400e; }
    .bad { background: #fee2e2; color: #991b1b; }
    .neutral { background: #e5e7eb; color: #374151; }
    .info { background: #dbeafe; color: #1d4ed8; }
    canvas {
      margin-top: 12px;
      max-height: 180px;
    }
    .auth-screen {
      align-items: center;
      background: #f4f6f8;
      display: none;
      inset: 0;
      justify-content: center;
      padding: 20px;
      position: fixed;
      z-index: 10;
    }
    .auth-screen.active {
      display: flex;
    }
    .auth-box {
      background: white;
      border-radius: 8px;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.14);
      max-width: 380px;
      padding: 24px;
      width: 100%;
    }
    .auth-box h2 {
      font-size: 20px;
      margin: 0 0 8px;
    }
    .auth-box input {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      box-sizing: border-box;
      font-size: 16px;
      margin-top: 16px;
      padding: 12px;
      width: 100%;
    }
    .auth-box button {
      background: #0f172a;
      border: 0;
      border-radius: 6px;
      color: white;
      cursor: pointer;
      font-size: 15px;
      font-weight: bold;
      margin-top: 12px;
      padding: 12px;
      width: 100%;
    }
    .auth-error {
      color: #991b1b;
      display: none;
      font-size: 14px;
      margin-top: 12px;
    }
    .app-shell.locked {
      display: none;
    }
  </style>
</head>
<body>
  <div id="auth-screen" class="auth-screen">
    <form id="auth-form" class="auth-box">
      <h2>Acesso ao dashboard</h2>
      <div class="muted">Informe o token configurado para visualizar os dados.</div>
      <input id="dashboard-token" type="password" autocomplete="current-password" placeholder="Token de acesso" />
      <button type="submit">Entrar</button>
      <div id="auth-error" class="auth-error"></div>
    </form>
  </div>

  <div id="app-shell" class="app-shell locked">
    <header>
      <h1>${dashboardTitle}</h1>
      <div class="muted" style="color:#cbd5e1;">Visão atual dos dispositivos e histórico recente</div>
    </header>

    <main>
      <section id="summary" class="summary"></section>
      <section id="devices" class="device-grid"></section>
    </main>
  </div>

  <script>
    const charts = {};
    const SESSION_TIMEOUT_MS = ${sessionTimeoutMinutes} * 60 * 1000;
    const TOKEN_STORAGE_KEY = 'condoSentinel.dashboardToken';
    const ACTIVITY_STORAGE_KEY = 'condoSentinel.lastActivityAt';
    let refreshTimer = null;

    function escHtml(str) {
      if (str === null || str === undefined) return '-';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
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
    }

    async function authenticatedFetch(url) {
      if (!hasActiveSession()) {
        showAuth('Sessão expirada por inatividade.');
        throw new Error('Sessão expirada');
      }

      const res = await fetch(url, {
        cache: 'no-store',
        headers: {
          Authorization: 'Bearer ' + getStoredToken()
        }
      });

      if (res.status === 401 || res.status === 503) {
        showAuth(res.status === 503 ? 'Token não configurado no servidor.' : 'Token inválido ou sessão expirada.');
        throw new Error('Não autorizado');
      }

      if (!res.ok) {
        throw new Error('Erro na requisição: ' + res.status);
      }

      touchSession();
      return res;
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

    async function loadStatus() {
      const res = await authenticatedFetch('/api/status');
      return res.json();
    }

    async function loadHistory(deviceId) {
      const res = await authenticatedFetch('/api/history?device=' + encodeURIComponent(deviceId));
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
      if (device.lowLevelAlertActive) items.push(badge('Nível baixo', 'warn'));
      if (device.sensorFaultActive) items.push(badge('Leitura inválida', 'bad'));
      if (device.alarmActive) items.push(badge('Alarme', 'bad'));

      if (!device.stale && !device.lowLevelAlertActive && !device.sensorFaultActive && !device.alarmActive) {
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
          <div class="small" style="margin-top:6px;">\${getReadingFreshnessText(device)}</div>
          <canvas id="chart-\${device.id}"></canvas>
        \`;
      } else if (device.type === 'gas_sensor' || device.type === 'water_leak_sensor') {
        extra = \`
          <div><strong>Alarme:</strong> \${escHtml(device.lastReading?.alarmValue) ?? '-'}</div>
          <div><strong>Bateria:</strong> \${escHtml(device.lastReading?.battery) ?? '-' }%</div>
          <div class="small" style="margin-top:6px;">\${getReadingFreshnessText(device)}</div>
          <canvas id="chart-\${device.id}"></canvas>
        \`;
      } else if (device.type === 'valve') {
        extra = \`
          <div><strong>Status:</strong> \${escHtml(device.lastReading?.currentValue) ?? '-'}</div>
          <div class="small" style="margin-top:6px;">\${getReadingFreshnessText(device)}</div>
        \`;
      } else {
        extra = '<div class="muted">Tipo ainda sem visual específico.</div>';
      }

      return \`
        <div class="card">
          <h3 style="margin-top:0;">\${escHtml(device.name)}</h3>
          <div class="muted">\${escHtml(device.role) || '-'} • \${escHtml(device.type)}</div>
          <div style="margin:10px 0;">\${deviceStatusBadges(device)}</div>
          <div><strong>Última checagem do worker:</strong> \${formatTs(device.lastSeenAt)}</div>
          <div><strong>Leitura registrada:</strong> \${formatTs(device.readingUpdatedAt)}</div>
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
          animation: false,
          plugins: {
            tooltip: {
              callbacks: {
                afterLabel: (ctx) => {
                  const point = points[ctx.dataIndex];
                  if (!point) return '';
                  const meta = [];
                  if (point.online === false) meta.push('Device offline neste ponto');
                  if (point.valid === false) meta.push('Leitura inválida');
                  return meta.join(' • ');
                }
              }
            }
          },
          scales: {
            y: yConfig
          }
        }
      });
    }

    async function refresh() {
      try {
        if (!hasActiveSession()) {
          showAuth('Sessão expirada por inatividade.');
          return;
        }

        const payload = await loadStatus();
        renderSummary(payload.summary);
        await renderDevices(payload.devices);
      } catch (err) {
        console.error('Erro ao atualizar dashboard:', err);
      }
    }

    async function startDashboard() {
      showDashboard();
      touchSession();
      await refresh();

      if (!refreshTimer) {
        refreshTimer = setInterval(refresh, 60000);
      }
    }

    document.getElementById('auth-form').addEventListener('submit', async (event) => {
      event.preventDefault();

      const input = document.getElementById('dashboard-token');
      const token = input.value.trim();
      const error = document.getElementById('auth-error');

      if (!token) {
        error.textContent = 'Informe o token de acesso.';
        error.style.display = 'block';
        return;
      }

      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
      sessionStorage.setItem(ACTIVITY_STORAGE_KEY, String(Date.now()));
      input.value = '';

      try {
        await startDashboard();
      } catch {
        showAuth('Token inválido ou indisponível.');
      }
    });

    ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'].forEach((eventName) => {
      window.addEventListener(eventName, () => {
        if (hasActiveSession()) touchSession();
      }, { passive: true });
    });

    if (hasActiveSession()) {
      startDashboard();
    } else {
      showAuth();
    }
  </script>
</body>
</html>`;
}

/**
 * Handler para API de status
 */
export async function handleApiStatus(env) {
  const payload = await buildDashboardStatus(env);
  return jsonResponse(payload);
}

/**
 * Handler para API de histórico
 */
export async function handleApiHistory(env, deviceId) {
  const history = await getDeviceHistory(env, deviceId);
  return jsonResponse({
    deviceId,
    points: history,
  });
}

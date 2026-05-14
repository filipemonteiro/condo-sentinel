// filepath: src/dashboard-js.js
/**
 * JavaScript logic for the dashboard
 */

export function dashboardJs(options) {
  const sessionTimeoutMinutes = Math.max(1, options.sessionTimeoutMinutes || 30);

  return `
    const charts = {};
    const SESSION_TIMEOUT_MS = ${sessionTimeoutMinutes} * 60 * 1000;
    const TOKEN_STORAGE_KEY = 'condoSentinel.dashboardToken';
    const ACTIVITY_STORAGE_KEY = 'condoSentinel.lastActivityAt';
    let refreshTimer = null;
    let currentSection = 'dashboard';
    let currentDashboardContext = null;

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
            ...(options.headers || {})
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

    function bindMenu() {
      document.querySelectorAll('.menu button').forEach(btn => {
        btn.addEventListener('click', () => {
          const section = btn.getAttribute('data-section');
          if (section === 'dashboard') {
            renderDashboard();
          } else if (section === 'config' && currentDashboardContext?.currentUser?.role === 'admin') {
            renderConfigForm(currentDashboardContext.config || {});
          }
          showSection(section);
        });
      });
    }

    function renderMenu(context) {
      const menu = document.querySelector('.menu');
      const isAdmin = context?.currentUser?.role === 'admin';
      menu.innerHTML = [
        '<button data-section="dashboard" class="active">Dashboard</button>',
        isAdmin ? '<button data-section="config">Configurações</button>' : ''
      ].join('');
      bindMenu();
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

    const CONFIG_FIELD_RULES = {
      DASHBOARD_STALE_AFTER_MINUTES: { min: 1, max: 1440, label: 'Dados desatualizados após (min)' },
      DASHBOARD_SESSION_TIMEOUT_MINUTES: { min: 1, max: 1440, label: 'Sessão expira após (min)' },
      COOLDOWN_MINUTES: { min: 1, max: 10080, label: 'Cooldown nível baixo (min)' },
      OFFLINE_COOLDOWN_MINUTES: { min: 1, max: 10080, label: 'Cooldown offline (min)' },
      SENSOR_COOLDOWN_MINUTES: { min: 1, max: 10080, label: 'Cooldown falha sensor/API (min)' },
      BATTERY_THRESHOLD_PERCENT: { min: 0, max: 100, label: 'Alerta bateria baixa (%)' },
      BATTERY_COOLDOWN_MINUTES: { min: 1, max: 10080, label: 'Cooldown bateria baixa (min)' },
      HISTORY_MAX_POINTS: { min: 1, max: 10080, label: 'Máximo de pontos por device' },
      HISTORY_MIN_INTERVAL_MINUTES: { min: 1, max: 1440, label: 'Intervalo mínimo entre pontos (min)' },
      HISTORY_MIN_DELTA_PERCENT: { min: 0, max: 100, label: 'Delta mínimo para salvar nível (%)' },
    };

    const DEVICE_FIELD_RULES = {
      thresholdPercent: { min: 0, max: 100, label: 'Alerta nível baixo (%)' },
      recoveryMarginPercent: { min: 0, max: 100, label: 'Margem recuperação (%)' },
      minConsecutiveBreaches: { min: 1, max: 100, label: 'Leituras para alerta' },
      cooldownMinutes: { min: 1, max: 10080, label: 'Cooldown nível baixo (min)' },
      offlineCooldownMinutes: { min: 1, max: 10080, label: 'Cooldown offline (min)' },
      faultCooldownMinutes: { min: 1, max: 10080, label: 'Cooldown falha/API (min)' },
      batteryThresholdPercent: { min: 0, max: 100, label: 'Alerta bateria baixa (%)' },
      batteryCooldownMinutes: { min: 1, max: 10080, label: 'Cooldown bateria baixa (min)' },
    };

    function configNumberField(name, value) {
      const rule = CONFIG_FIELD_RULES[name] || { min: 0, max: null, label: name };
      const safeValue = value === null || value === undefined ? '' : String(value);
      const maxAttr = rule.max === null || rule.max === undefined ? '' : ' max="' + escHtml(rule.max) + '"';
      return \`
        <div class="field">
          <label for="config-\${escHtml(name)}">\${escHtml(rule.label)}</label>
          <input type="number" id="config-\${escHtml(name)}" data-config-field="\${escHtml(name)}" min="\${escHtml(rule.min)}"\${maxAttr} step="1" value="\${escHtml(safeValue)}">
        </div>
      \`;
    }

    function deviceNumberField(deviceId, deviceName, name, value) {
      const rule = DEVICE_FIELD_RULES[name] || { min: 0, max: null, label: name };
      const safeValue = value === null || value === undefined ? '' : String(value);
      const maxAttr = rule.max === null || rule.max === undefined ? '' : ' max="' + escHtml(rule.max) + '"';
      return \`
        <div class="field">
          <label for="device-\${escHtml(deviceId)}-\${escHtml(name)}">\${escHtml(rule.label)}</label>
          <input type="number" id="device-\${escHtml(deviceId)}-\${escHtml(name)}" data-device-id="\${escHtml(deviceId)}" data-device-name="\${escHtml(deviceName || deviceId)}" data-device-field="\${escHtml(name)}" min="\${escHtml(rule.min)}"\${maxAttr} step="1" value="\${escHtml(safeValue)}">
        </div>
      \`;
    }

    function deviceFields(device) {
      const config = device.config || {};
      const deviceName = device.name || device.id;
      const common = [
        deviceNumberField(device.id, deviceName, 'offlineCooldownMinutes', config.offlineCooldownMinutes),
        deviceNumberField(device.id, deviceName, 'faultCooldownMinutes', config.faultCooldownMinutes),
      ];
      const battery = [
        deviceNumberField(device.id, deviceName, 'batteryThresholdPercent', config.batteryThresholdPercent),
        deviceNumberField(device.id, deviceName, 'batteryCooldownMinutes', config.batteryCooldownMinutes),
      ];

      if (device.type === 'water_level_sensor') {
        return [
          deviceNumberField(device.id, deviceName, 'thresholdPercent', config.thresholdPercent),
          deviceNumberField(device.id, deviceName, 'recoveryMarginPercent', config.recoveryMarginPercent),
          deviceNumberField(device.id, deviceName, 'minConsecutiveBreaches', config.minConsecutiveBreaches),
          deviceNumberField(device.id, deviceName, 'cooldownMinutes', config.cooldownMinutes),
          ...common,
          ...battery,
        ].join('');
      }

      if (device.type === 'gas_sensor' || device.type === 'water_leak_sensor') {
        return [...common, ...battery].join('');
      }

      return common.join('');
    }

    function readNumberInput(selector, rule, label, errors) {
      const el = document.querySelector(selector);
      if (!el) return null;
      if (String(el.value || '').trim() === '') return null;
      return readNumberInputFromElement(el, rule, label, errors);
    }

    function readNumberInputFromElement(el, rule, label, errors) {
      const value = Number(el.value);
      if (!Number.isInteger(value)) {
        errors.push(label + ' precisa ser um número inteiro.');
        return null;
      }
      if (rule && value < rule.min) {
        errors.push(label + ' precisa ser maior ou igual a ' + rule.min + '.');
        return null;
      }
      if (rule && rule.max !== null && rule.max !== undefined && value > rule.max) {
        errors.push(label + ' precisa ser menor ou igual a ' + rule.max + '.');
        return null;
      }
      return value;
    }

    function readConfigNumber(name, errors) {
      const rule = CONFIG_FIELD_RULES[name];
      return readNumberInput('[data-config-field="' + name + '"]', rule, rule.label, errors);
    }

    function readDeviceNumber(input, errors) {
      const field = input.getAttribute('data-device-field');
      const rule = DEVICE_FIELD_RULES[field];
      const deviceName = input.getAttribute('data-device-name') || input.getAttribute('data-device-id') || 'Device';
      if (String(input.value || '').trim() === '') return null;
      return readNumberInputFromElement(input, rule, deviceName + ' - ' + (rule?.label || field), errors);
    }

    function configsMatch(requested, saved) {
      const savedConfig = saved || {};
      for (const [key, value] of Object.entries(requested)) {
        if (key === 'devices') continue;
        if (value === null || value === undefined || value === '') continue;
        if (savedConfig[key] !== value) return false;
      }

      for (const [deviceId, fields] of Object.entries(requested.devices || {})) {
        const savedDevice = savedConfig.devices?.[deviceId] || {};
        for (const [field, value] of Object.entries(fields)) {
          if (savedDevice[field] !== value) return false;
        }
      }

      return true;
    }

    function renderConfigForm(config) {
      const form = document.getElementById('config-form');
      const title = config.DASHBOARD_TITLE || config.dashboardTitle || '';
      const devices = Array.isArray(currentDashboardContext?.devices) ? currentDashboardContext.devices : [];
      const deviceSections = devices.map(device => {
        return \`
          <div class="config-device">
            <div class="config-device-header">
              <div>
                <h3>\${escHtml(device.name)}</h3>
                <div class="muted">\${escHtml(device.role || '-')} • \${escHtml(device.type)}</div>
              </div>
            </div>
            <div class="config-grid">
              \${deviceFields(device)}
            </div>
          </div>
        \`;
      }).join('');

      form.innerHTML = \`
        <h2>Configurações</h2>
        <div class="config-section">
          <h3>Dashboard</h3>
          <div class="field field-wide">
            <label for="config-title">Título do dashboard</label>
            <input type="text" id="config-title" value="\${escHtml(title)}" maxlength="120">
          </div>
          <div class="config-grid">
            \${configNumberField('DASHBOARD_STALE_AFTER_MINUTES', config.DASHBOARD_STALE_AFTER_MINUTES)}
            \${configNumberField('DASHBOARD_SESSION_TIMEOUT_MINUTES', config.DASHBOARD_SESSION_TIMEOUT_MINUTES)}
          </div>
        </div>

        <div class="config-section">
          <h3>Alertas padrão</h3>
          <div class="config-grid">
            \${configNumberField('COOLDOWN_MINUTES', config.COOLDOWN_MINUTES)}
            \${configNumberField('OFFLINE_COOLDOWN_MINUTES', config.OFFLINE_COOLDOWN_MINUTES)}
            \${configNumberField('SENSOR_COOLDOWN_MINUTES', config.SENSOR_COOLDOWN_MINUTES)}
            \${configNumberField('BATTERY_THRESHOLD_PERCENT', config.BATTERY_THRESHOLD_PERCENT)}
            \${configNumberField('BATTERY_COOLDOWN_MINUTES', config.BATTERY_COOLDOWN_MINUTES)}
          </div>
        </div>

        <div class="config-section">
          <h3>Histórico</h3>
          <div class="config-grid">
            \${configNumberField('HISTORY_MAX_POINTS', config.HISTORY_MAX_POINTS)}
            \${configNumberField('HISTORY_MIN_INTERVAL_MINUTES', config.HISTORY_MIN_INTERVAL_MINUTES)}
            \${configNumberField('HISTORY_MIN_DELTA_PERCENT', config.HISTORY_MIN_DELTA_PERCENT)}
          </div>
        </div>

        <div class="config-section">
          <h3>Dispositivos</h3>
          \${deviceSections || '<div class="muted">Nenhum device configurável encontrado.</div>'}
        </div>

        <div class="config-actions">
          <button type="button" onclick="saveConfigForm()">Salvar</button>
        </div>
      \`;
      document.getElementById('config-title').value = title;
    }

    async function loadAndRenderConfig() {
      currentDashboardContext = await loadConfig();
      renderMenu(currentDashboardContext);
      renderConfigForm(currentDashboardContext.config || {});
    }

    async function saveConfigForm() {
      try {
        const errors = [];
        const nextConfig = {
          DASHBOARD_TITLE: document.getElementById('config-title').value.trim(),
          DASHBOARD_STALE_AFTER_MINUTES: readConfigNumber('DASHBOARD_STALE_AFTER_MINUTES', errors),
          DASHBOARD_SESSION_TIMEOUT_MINUTES: readConfigNumber('DASHBOARD_SESSION_TIMEOUT_MINUTES', errors),
          COOLDOWN_MINUTES: readConfigNumber('COOLDOWN_MINUTES', errors),
          OFFLINE_COOLDOWN_MINUTES: readConfigNumber('OFFLINE_COOLDOWN_MINUTES', errors),
          SENSOR_COOLDOWN_MINUTES: readConfigNumber('SENSOR_COOLDOWN_MINUTES', errors),
          BATTERY_THRESHOLD_PERCENT: readConfigNumber('BATTERY_THRESHOLD_PERCENT', errors),
          BATTERY_COOLDOWN_MINUTES: readConfigNumber('BATTERY_COOLDOWN_MINUTES', errors),
          HISTORY_MAX_POINTS: readConfigNumber('HISTORY_MAX_POINTS', errors),
          HISTORY_MIN_INTERVAL_MINUTES: readConfigNumber('HISTORY_MIN_INTERVAL_MINUTES', errors),
          HISTORY_MIN_DELTA_PERCENT: readConfigNumber('HISTORY_MIN_DELTA_PERCENT', errors),
          devices: {},
        };

        document.querySelectorAll('[data-device-id][data-device-field]').forEach(input => {
          const deviceId = input.getAttribute('data-device-id');
          const field = input.getAttribute('data-device-field');
          if (String(input.value || '').trim() === '') return;
          const value = readDeviceNumber(input, errors);
          if (!deviceId || !field || value === null) return;
          nextConfig.devices[deviceId] = {
            ...(nextConfig.devices[deviceId] || {}),
            [field]: value,
          };
        });

        if (errors.length > 0) {
          alert('Configuração não salva:\\n\\n' + errors.slice(0, 8).join('\\n'));
          return;
        }

        const result = await saveConfig({ config: nextConfig });
        if (result.success) {
          if (!configsMatch(nextConfig, result.config || {})) {
            alert('Configuração não salva por completo. Verifique os campos informados e tente novamente.');
            currentDashboardContext = await loadConfig();
            renderConfigForm(currentDashboardContext.config || {});
            return;
          }

          currentDashboardContext = {
            ...(currentDashboardContext || {}),
            config: result.config || {},
          };
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

    async function loadDashboardShell() {
      currentDashboardContext = await loadConfig();
      renderMenu(currentDashboardContext);
      await renderDashboard();
    }

    async function init() {
      // Auth form
      document.getElementById('auth-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const token = document.getElementById('dashboard-token').value.trim();

        if (!token) {
          showAuth('Token não pode estar vazio.');
          return;
        }

        sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
        sessionStorage.setItem(ACTIVITY_STORAGE_KEY, String(Date.now()));

        try {
          await loadDashboardShell();
          showDashboard();
          refreshTimer = setInterval(() => {
            if (hasActiveSession()) {
              renderDashboard().catch(err => {
                console.error('Auto-refresh failed:', err);
              });
            } else {
              showAuth('Sessão expirada.');
            }
          }, 60000);
        } catch (err) {
          console.error('Auth form error:', err);
          showAuth(err.message === 'Não autorizado' ? 'Token inválido ou sessão expirada.' : 'Erro ao carregar dados.');
        }
      });

      bindMenu();

      // Start with dashboard if logged in
      if (hasActiveSession()) {
        try {
          await loadDashboardShell();
          showDashboard();
          refreshTimer = setInterval(() => {
            if (hasActiveSession()) {
              renderDashboard().catch(err => {
                console.error('Auto-refresh failed:', err);
              });
            } else {
              showAuth('Sessão expirada.');
            }
          }, 60000);
        } catch (err) {
          console.error('Session load error:', err);
          showAuth(err.message === 'Não autorizado' ? 'Token inválido ou sessão expirada.' : 'Erro ao carregar dados.');
        }
      } else {
        showAuth();
      }
    }

    init();
  `;
}

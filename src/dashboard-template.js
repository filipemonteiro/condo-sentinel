// filepath: src/dashboard-template.js
/**
 * HTML template for the dashboard
 */

import { dashboardCss } from './dashboard-css.js';
import { dashboardJs } from './dashboard-js.js';
import { escapeHtmlText } from './dashboard.js';

export function renderDashboardHtml(options = {}) {
  const sessionTimeoutMinutes = Math.max(1, options.sessionTimeoutMinutes || 30);
  const dashboardTitle = options.dashboardTitle || 'Condo Sentinel';
  const safeDashboardTitle = escapeHtmlText(dashboardTitle);
  const css = dashboardCss;
  const js = dashboardJs({ sessionTimeoutMinutes });

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeDashboardTitle} - Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>${css}</style>
</head>
<body>
  <div id="auth-screen" class="auth-screen">
    <form id="auth-form" class="auth-box">
      <div class="auth-logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="22" height="22" aria-hidden="true">
          <path d="M12 2C8.5 5.5 5 9.5 5 14a7 7 0 0 0 14 0c0-4.5-3.5-8.5-7-12z" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <h2>Acesso ao dashboard</h2>
      <div class="auth-sub">Informe o token configurado para visualizar os dados.</div>
      <input id="dashboard-token" type="password" autocomplete="current-password" placeholder="Token de acesso" />
      <button type="submit">Entrar</button>
      <div id="auth-error" class="auth-error"></div>
    </form>
  </div>

  <div id="app-shell" class="app-shell locked">
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-logo-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16" aria-hidden="true">
            <path d="M12 2C8.5 5.5 5 9.5 5 14a7 7 0 0 0 14 0c0-4.5-3.5-8.5-7-12z" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="sidebar-header-text">
          <div class="sidebar-title">${safeDashboardTitle}</div>
          <div class="sidebar-subtitle">Monitoramento</div>
        </div>
      </div>
      <nav class="menu"></nav>
      <div class="sidebar-footer">
        <div class="sidebar-status">
          <span class="status-dot pulse"></span>
          <span>Sistema operacional</span>
        </div>
      </div>
    </aside>

    <div class="main-content">
      <header class="topbar">
        <div class="topbar-left">
          <div class="topbar-title">${safeDashboardTitle}</div>
          <div class="topbar-subtitle">Visão atual dos dispositivos e histórico recente</div>
        </div>
      </header>

      <main>
        <section id="dashboard" class="section active">
          <div id="summary" class="summary"></div>
          <div id="devices" class="device-grid"></div>
        </section>

        <section id="history" class="section">
          <div class="history-layout">
            <div class="history-toolbar card">
              <div class="history-field">
                <label for="history-device">Device</label>
                <select id="history-device"></select>
              </div>
              <div class="history-field">
                <label for="history-range">Período</label>
                <select id="history-range">
                  <option value="1h">1h</option>
                  <option value="6h">6h</option>
                  <option value="24h" selected>24h</option>
                  <option value="7d">7d</option>
                  <option value="all">Tudo</option>
                </select>
              </div>
              <div class="history-field">
                <label for="history-bucket">Granularidade</label>
                <select id="history-bucket">
                  <option value="raw">Pontos reais</option>
                  <option value="15m">15 min</option>
                  <option value="1h">1 h</option>
                  <option value="6h">6 h</option>
                </select>
              </div>
              <button id="history-refresh" type="button">Atualizar</button>
            </div>
            <div class="history-summary" id="history-summary"></div>
            <div class="card history-chart-card">
              <canvas id="history-chart"></canvas>
            </div>
          </div>
        </section>

        <section id="config" class="section">
          <div class="card config-form" id="config-form">
            <!-- Config form will be rendered here -->
          </div>
        </section>
      </main>
    </div>
  </div>

  <script>${js}</script>
</body>
</html>`;
}

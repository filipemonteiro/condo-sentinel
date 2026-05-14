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
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>${css}</style>
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
      <div>
        <h1>${safeDashboardTitle}</h1>
        <div class="header-info">Visão atual dos dispositivos e histórico recente</div>
      </div>
      <nav class="menu">
        <button data-section="dashboard" class="active">Dashboard</button>
      </nav>
    </header>

    <main>
      <section id="dashboard" class="section active">
        <div id="summary" class="summary"></div>
        <div id="devices" class="device-grid"></div>
      </section>

      <section id="config" class="section">
        <div class="card config-form" id="config-form">
          <!-- Config form will be rendered here -->
        </div>
      </section>
    </main>
  </div>

  <script>${js}</script>
</body>
</html>`;
}

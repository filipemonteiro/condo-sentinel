// filepath: src/dashboard-css.js
/**
 * CSS styles for the dashboard
 */

export const dashboardCss = `
  :root {
    --bg: oklch(0.08 0.005 260);
    --bg-hover: oklch(0.10 0.005 260);
    --card: oklch(0.12 0.005 260);
    --sidebar: oklch(0.06 0.005 260);
    --topbar: oklch(0.10 0.005 260);
    --fg: oklch(0.92 0 0);
    --fg-muted: oklch(0.55 0.01 260);
    --border: oklch(0.22 0.01 260);
    --input-bg: oklch(0.16 0.005 260);
    --primary: oklch(0.72 0.15 195);
    --primary-bg: oklch(0.72 0.15 195 / 0.12);
    --status-online: oklch(0.7 0.18 145);
    --status-online-bg: oklch(0.7 0.18 145 / 0.12);
    --status-offline: oklch(0.58 0.22 25);
    --status-offline-bg: oklch(0.58 0.22 25 / 0.12);
    --status-warning: oklch(0.75 0.18 85);
    --status-warning-bg: oklch(0.75 0.18 85 / 0.12);
    --status-info: oklch(0.6 0.15 250);
    --status-info-bg: oklch(0.6 0.15 250 / 0.12);
    --radius: 6px;
    --sidebar-w: 224px;
    --topbar-h: 52px;
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    background: var(--bg);
    color: var(--fg);
  }

  .mono { font-family: 'JetBrains Mono', ui-monospace, 'Cascadia Code', monospace; }

  /* ── Layout ── */
  .app-shell {
    display: flex;
    min-height: 100vh;
  }
  .app-shell.locked { display: none; }

  /* ── Sidebar ── */
  .sidebar {
    width: var(--sidebar-w);
    background: var(--sidebar);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    position: fixed;
    top: 0; left: 0;
    height: 100vh;
    z-index: 20;
  }

  .sidebar-header {
    padding: 16px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .sidebar-logo-icon {
    width: 32px;
    height: 32px;
    border-radius: var(--radius);
    background: var(--primary-bg);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--primary);
    flex-shrink: 0;
  }

  .sidebar-header-text { min-width: 0; }

  .sidebar-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--fg);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sidebar-subtitle {
    font-size: 10px;
    color: var(--fg-muted);
  }

  /* sidebar nav */
  .menu {
    flex: 1;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
  }

  .menu button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: var(--radius);
    background: none;
    border: none;
    color: var(--fg-muted);
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    font-family: inherit;
    text-align: left;
    transition: background 0.15s, color 0.15s;
  }

  .menu button:hover {
    background: oklch(0.14 0.008 260);
    color: var(--fg);
  }

  .menu button.active {
    background: oklch(0.16 0.008 260);
    color: var(--fg);
  }

  .sidebar-footer {
    padding: 14px 16px;
    border-top: 1px solid var(--border);
  }

  .sidebar-status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--fg-muted);
  }

  /* ── Main Content ── */
  .main-content {
    flex: 1;
    margin-left: var(--sidebar-w);
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  /* ── Topbar ── */
  .topbar {
    height: var(--topbar-h);
    background: var(--topbar);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .topbar-left {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .topbar-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--fg);
  }

  .topbar-subtitle {
    font-size: 11px;
    color: var(--fg-muted);
  }

  main { padding: 24px; }

  .section { display: none; }
  .section.active { display: block; }

  /* ── Status Dot ── */
  .status-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--status-online);
    flex-shrink: 0;
  }

  .status-dot.status-bad { background: var(--status-offline); }
  .status-dot.status-warn { background: var(--status-warning); }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  .status-dot.pulse { animation: pulse-dot 2s ease-in-out infinite; }

  /* ── Badges ── */
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
    margin-right: 4px;
    margin-bottom: 4px;
  }
  .ok      { background: var(--status-online-bg);  color: var(--status-online);  }
  .warn    { background: var(--status-warning-bg); color: var(--status-warning); }
  .bad     { background: var(--status-offline-bg); color: var(--status-offline); }
  .neutral { background: oklch(0.18 0.005 260);    color: var(--fg-muted);       }
  .info    { background: var(--status-info-bg);    color: var(--status-info);    }

  /* ── Cards ── */
  .card {
    background: var(--card);
    border-radius: var(--radius);
    border: 1px solid var(--border);
    padding: 16px;
  }

  /* ── Metric Cards (summary) ── */
  .summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
    margin-bottom: 20px;
  }

  .metric-card { padding: 14px 16px; }

  .metric-value {
    font-size: 26px;
    font-weight: 600;
    color: var(--fg);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    margin-bottom: 4px;
    line-height: 1.2;
  }

  .metric-label {
    font-size: 11px;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  /* ── Device Grid ── */
  .device-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 16px;
  }

  /* ── Device Card ── */
  .device-card { padding: 16px; }

  .device-card.device-offline { border-color: oklch(0.58 0.22 25 / 0.3); }
  .device-card.device-alert   { border-color: oklch(0.75 0.18 85 / 0.4); }

  .device-header { margin-bottom: 10px; }

  .device-name-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 3px;
  }

  .device-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--fg);
  }

  .device-meta {
    font-size: 11px;
    color: var(--fg-muted);
    padding-left: 16px;
  }

  .device-badges { margin: 8px 0; }

  /* ── Level Bar ── */
  .level-bar-wrap {
    height: 6px;
    background: oklch(0.18 0.005 260);
    border-radius: 999px;
    overflow: hidden;
    margin: 10px 0 4px;
  }

  .level-bar {
    height: 100%;
    border-radius: 999px;
    transition: width 0.8s ease-out;
  }

  .level-bar-label {
    font-size: 11px;
    color: var(--fg-muted);
    margin-bottom: 10px;
  }

  /* ── Device Stats ── */
  .device-stats {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px 12px;
    margin: 10px 0;
  }

  .device-stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .stat-label {
    font-size: 10px;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .stat-value {
    font-size: 13px;
    color: var(--fg);
    font-weight: 500;
  }

  .device-freshness {
    font-size: 11px;
    color: var(--fg-muted);
    margin-top: 4px;
  }

  .device-timestamps {
    border-top: 1px solid var(--border);
    margin-top: 10px;
    padding-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    color: var(--fg-muted);
  }

  .device-timestamps .mono {
    color: var(--fg);
    font-size: 11px;
  }

  /* ── History ── */
  .history-layout { display: grid; gap: 16px; }

  .history-toolbar {
    align-items: end;
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(220px, 2fr) repeat(2, minmax(140px, 1fr)) auto;
  }

  .history-field label {
    display: block;
    font-size: 11px;
    font-weight: 500;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 0 0 6px;
  }

  .history-field select {
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--fg);
    box-sizing: border-box;
    font-size: 13px;
    font-family: inherit;
    padding: 9px 12px;
    width: 100%;
    transition: border-color 0.15s;
  }

  .history-field select:focus {
    outline: none;
    border-color: var(--primary);
  }

  .history-toolbar button {
    background: var(--primary);
    border: none;
    border-radius: var(--radius);
    color: oklch(0.08 0.005 260);
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    padding: 10px 18px;
    transition: opacity 0.15s;
  }

  .history-toolbar button:hover { opacity: 0.85; }

  .history-summary {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  }

  .history-chart-card { min-height: 380px; }

  #history-chart { height: 340px; max-height: 340px; }

  canvas { margin-top: 12px; max-height: 180px; }

  /* ── Auth Screen ── */
  .auth-screen {
    align-items: center;
    background: var(--bg);
    display: none;
    inset: 0;
    justify-content: center;
    padding: 20px;
    position: fixed;
    z-index: 100;
  }

  .auth-screen.active { display: flex; }

  .auth-box {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
    max-width: 380px;
    padding: 28px;
    width: 100%;
  }

  .auth-logo {
    width: 44px;
    height: 44px;
    border-radius: 10px;
    background: var(--primary-bg);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--primary);
    margin-bottom: 16px;
  }

  .auth-box h2 {
    font-size: 18px;
    font-weight: 600;
    color: var(--fg);
    margin-bottom: 6px;
  }

  .auth-sub {
    font-size: 13px;
    color: var(--fg-muted);
    margin-bottom: 4px;
  }

  .auth-box input {
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--fg);
    box-sizing: border-box;
    font-size: 15px;
    font-family: inherit;
    margin-top: 16px;
    padding: 12px;
    width: 100%;
    transition: border-color 0.15s;
  }

  .auth-box input:focus {
    outline: none;
    border-color: var(--primary);
  }

  .auth-box input::placeholder { color: var(--fg-muted); }

  .auth-box button {
    background: var(--primary);
    border: 0;
    border-radius: var(--radius);
    color: oklch(0.08 0.005 260);
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    font-family: inherit;
    margin-top: 12px;
    padding: 12px;
    width: 100%;
    transition: opacity 0.15s;
  }

  .auth-box button:hover { opacity: 0.9; }

  .auth-error {
    color: var(--status-offline);
    display: none;
    font-size: 13px;
    margin-top: 12px;
  }

  /* ── Config Form ── */
  .config-form { margin: 0 auto; max-width: 1100px; }

  .config-form h2 {
    font-size: 20px;
    font-weight: 600;
    color: var(--fg);
    margin: 0 0 12px;
  }

  .config-form h3 {
    font-size: 14px;
    font-weight: 600;
    color: var(--fg);
    margin: 0 0 12px;
  }

  .config-form label {
    display: block;
    font-size: 11px;
    font-weight: 500;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 0 0 6px;
  }

  .field { min-width: 0; }
  .field-wide { margin-bottom: 12px; }

  .config-grid {
    display: grid;
    gap: 12px 16px;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  }

  .config-section {
    border-top: 1px solid var(--border);
    margin-top: 18px;
    padding-top: 18px;
  }

  .config-device {
    background: oklch(0.10 0.005 260);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    margin-top: 12px;
    padding: 14px;
  }

  .config-device-header {
    align-items: flex-start;
    display: flex;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .config-device h3 { margin-bottom: 4px; }

  .config-form input,
  .config-form textarea {
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--fg);
    box-sizing: border-box;
    font-size: 13px;
    font-family: inherit;
    padding: 9px 12px;
    width: 100%;
    transition: border-color 0.15s;
  }

  .config-form input:focus,
  .config-form textarea:focus {
    outline: none;
    border-color: var(--primary);
  }

  .config-actions {
    border-top: 1px solid var(--border);
    margin-top: 18px;
    padding-top: 18px;
  }

  .config-form button {
    background: var(--primary);
    border: none;
    border-radius: var(--radius);
    color: oklch(0.08 0.005 260);
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    padding: 10px 20px;
    transition: opacity 0.15s;
  }

  .config-form button:hover { opacity: 0.85; }

  /* legacy compat */
  .muted { color: var(--fg-muted); font-size: 13px; }
  .small { font-size: 11px; color: var(--fg-muted); }

  /* ── Media Queries ── */
  @media (max-width: 760px) {
    .sidebar {
      width: 100%;
      height: auto;
      position: relative;
      flex-direction: row;
      flex-wrap: wrap;
      border-right: none;
      border-bottom: 1px solid var(--border);
    }
    .sidebar-footer { display: none; }
    .sidebar-header { flex: 1; }
    .menu {
      flex-direction: row;
      flex-wrap: wrap;
      padding: 8px 12px;
      gap: 4px;
      width: 100%;
    }
    .menu button { width: auto; padding: 6px 12px; }
    .main-content { margin-left: 0; }
    .device-grid { grid-template-columns: 1fr; }
    .history-toolbar { grid-template-columns: 1fr; }
  }
`;

// filepath: src/dashboard-css.js
/**
 * CSS styles for the dashboard
 */

export const dashboardCss = `
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
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  header h1 {
    margin: 0;
    font-size: 24px;
  }
  .header-info {
    font-size: 14px;
    color: #cbd5e1;
  }
  .menu {
    display: flex;
    gap: 16px;
  }
  .menu button {
    background: none;
    border: none;
    color: #cbd5e1;
    cursor: pointer;
    padding: 8px 12px;
    border-radius: 4px;
    transition: background 0.2s;
  }
  .menu button:hover, .menu button.active {
    background: #1e293b;
    color: white;
  }
  main {
    padding: 20px;
  }
  .section {
    display: none;
  }
  .section.active {
    display: block;
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
  .history-layout {
    display: grid;
    gap: 16px;
  }
  .history-toolbar {
    align-items: end;
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(220px, 2fr) repeat(2, minmax(140px, 1fr)) auto;
  }
  .history-field label {
    display: block;
    font-size: 13px;
    font-weight: bold;
    margin: 0 0 6px;
  }
  .history-field select {
    background: white;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    box-sizing: border-box;
    font-size: 14px;
    padding: 10px;
    width: 100%;
  }
  .history-toolbar button {
    background: #0f172a;
    border: none;
    border-radius: 6px;
    color: white;
    cursor: pointer;
    font-size: 14px;
    font-weight: bold;
    padding: 11px 18px;
  }
  .history-summary {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }
  .history-chart-card {
    min-height: 380px;
  }
  #history-chart {
    height: 340px;
    max-height: 340px;
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
  .config-form {
    margin: 0 auto;
    max-width: 1100px;
  }
  .config-form h2,
  .config-form h3 {
    margin: 0 0 12px;
  }
  .config-form h2 {
    font-size: 22px;
  }
  .config-form h3 {
    font-size: 17px;
  }
  .config-form label {
    display: block;
    font-size: 13px;
    font-weight: bold;
    margin: 0 0 6px;
  }
  .field {
    min-width: 0;
  }
  .field-wide {
    margin-bottom: 12px;
  }
  .config-grid {
    display: grid;
    gap: 12px 16px;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  }
  .config-section {
    border-top: 1px solid #e5e7eb;
    margin-top: 18px;
    padding-top: 18px;
  }
  .config-device {
    background: #f8fafc;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    margin-top: 12px;
    padding: 14px;
  }
  .config-device-header {
    align-items: flex-start;
    display: flex;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .config-device h3 {
    margin-bottom: 4px;
  }
  .config-form input, .config-form textarea {
    box-sizing: border-box;
    width: 100%;
    padding: 10px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 14px;
  }
  .config-actions {
    border-top: 1px solid #e5e7eb;
    margin-top: 18px;
    padding-top: 18px;
  }
  .config-form button {
    padding: 10px 20px;
    background: #0f172a;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
  .config-form button:hover {
    background: #1e293b;
  }
  @media (max-width: 760px) {
    header {
      align-items: flex-start;
      flex-direction: column;
      gap: 12px;
    }
    .menu {
      flex-wrap: wrap;
      gap: 8px;
    }
    .device-grid {
      grid-template-columns: 1fr;
    }
    .history-toolbar {
      grid-template-columns: 1fr;
    }
  }
`;

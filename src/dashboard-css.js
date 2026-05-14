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
    max-width: 600px;
    margin: 0 auto;
  }
  .config-form label {
    display: block;
    margin-top: 16px;
    font-weight: bold;
  }
  .config-form input, .config-form textarea {
    width: 100%;
    padding: 8px;
    margin-top: 4px;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
  }
  .config-form button {
    margin-top: 16px;
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
`;
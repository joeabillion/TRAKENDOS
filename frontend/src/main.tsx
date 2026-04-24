import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Global error handler for debugging (shows errors on screen for Safari etc.)
window.onerror = (msg, src, line, col, err) => {
  const el = document.getElementById('root')
  if (el) {
    el.innerHTML = `<div style="color:#ff6b35;padding:2rem;font-family:monospace;background:#0a0a0a;min-height:100vh">
      <h2 style="color:#fff">Trakend OS - Load Error</h2>
      <p>${String(msg)}</p>
      <p style="color:#888">Source: ${src} (line ${line}:${col})</p>
      <pre style="color:#ff4444;white-space:pre-wrap">${err?.stack || 'No stack trace'}</pre>
      <p style="color:#888;margin-top:1rem">Browser: ${navigator.userAgent}</p>
    </div>`
  }
}

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled rejection:', e.reason)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

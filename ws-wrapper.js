/**
 * Trakend OS process wrapper.
 *
 * Defense-in-depth: the backend should never crash the entire service over a
 * transient error (a flaky child process, a websocket race, a systeminformation
 * spawn that hits E2BIG, etc). systemd will restart us on a real fatal error,
 * but every restart breaks active sessions and causes a Cloudflare 502 burst.
 *
 * Policy:
 *   - Log every uncaught exception / unhandled rejection
 *   - Suppress (log at low volume) ONLY the specific known-benign socket errors
 *     from clients that went away: EPIPE, ECONNRESET, "write after end".
 *     NOTE: 'handleUpgrade' is deliberately NOT suppressed any more — the
 *     WebSocket double-upgrade bug is fixed in source, and hiding it here would
 *     mask a regression.
 *   - Only exit for truly fatal conditions (out of memory)
 *
 * This is the single wrapper for the project. It must be launched from the repo
 * root (systemd: WorkingDirectory=/opt/trakend/os, ExecStart=/usr/bin/node
 * /opt/trakend/os/ws-wrapper.js). It resolves the backend relative to this file,
 * so the cwd does not actually matter.
 */

const path = require('path');

// Benign client-side socket failures that are safe to swallow for uncaughtException.
const UNCAUGHT_SUPPRESSED_PATTERNS = [
  'EPIPE',                  // broken pipe (client gone)
  'ECONNRESET',             // client closed connection mid-write
  'write after end',        // late write to closed socket
];

// unhandledRejection is less dangerous (no half-finished sync state), so a slightly
// wider benign list is acceptable there.
const REJECTION_SUPPRESSED_PATTERNS = [
  ...UNCAUGHT_SUPPRESSED_PATTERNS,
  'E2BIG',                  // systeminformation spawn with too many args
  'ECONNABORTED',           // client aborted
  'ETIMEDOUT',              // generic socket timeout
  'Premature close',        // request body cut short
];

function matches(err, patterns) {
  if (!err) return false;
  const msg = String(err.message || err);
  const code = err.code || '';
  return patterns.some((p) => msg.includes(p) || code === p);
}

process.on('uncaughtException', (err) => {
  if (matches(err, UNCAUGHT_SUPPRESSED_PATTERNS)) {
    console.error('[wrapper] suppressed uncaughtException:', err.code || err.message);
    return;
  }
  // Out-of-memory is the only thing we treat as fatal — restart will help.
  if (err && err.message && /out of memory|heap out of memory/i.test(err.message)) {
    console.error('[wrapper] FATAL out of memory — exiting for systemd restart');
    console.error(err);
    process.exit(1);
  }
  // Everything else is logged with a full stack so regressions are visible in
  // journalctl, but the process keeps running (systemd restarts cost sessions).
  console.error('[wrapper] uncaughtException (continuing):', err);
});

process.on('unhandledRejection', (reason) => {
  if (matches(reason, REJECTION_SUPPRESSED_PATTERNS)) {
    console.error('[wrapper] suppressed unhandledRejection:', (reason && (reason.code || reason.message)) || reason);
    return;
  }
  console.error('[wrapper] unhandledRejection (continuing):', reason);
});

// Surface warnings so we can spot memory leaks (MaxListenersExceededWarning, etc.)
process.on('warning', (w) => {
  console.warn('[wrapper] warning:', w.name, w.message);
});

const entry = path.join(__dirname, 'backend', 'dist', 'index.js');
try {
  require.resolve(entry);
} catch (e) {
  console.error(`[wrapper] FATAL: backend build missing at ${entry}. Run "npm run build" in backend/ (the updater normally guarantees this).`);
  process.exit(1);
}
require(entry);

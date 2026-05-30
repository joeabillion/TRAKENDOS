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
 *   - Suppress known-safe errors (WebSocket double-upgrade, E2BIG spawn errors,
 *     ECONNRESET / EPIPE from broken clients)
 *   - Only exit for truly fatal conditions (out of memory, kernel panics)
 */

const SUPPRESSED_PATTERNS = [
  'handleUpgrade',          // WebSocket double-upgrade race
  'E2BIG',                  // systeminformation spawn with too many args
  'ECONNRESET',             // client closed connection mid-write
  'EPIPE',                  // broken pipe (client gone)
  'ECONNABORTED',           // client aborted
  'ETIMEDOUT',              // generic socket timeout
  'write after end',        // late write to closed socket
  'Premature close',        // request body cut short
];

function isSuppressed(err) {
  if (!err) return false;
  const msg = String(err.message || err);
  const code = err.code || '';
  return SUPPRESSED_PATTERNS.some((p) => msg.includes(p) || code === p);
}

process.on('uncaughtException', (err) => {
  if (isSuppressed(err)) {
    console.error('[wrapper] suppressed uncaughtException:', err.code || err.message);
    return;
  }
  // Out-of-memory is the only thing we treat as fatal — restart will help.
  if (err && err.message && /out of memory|heap out of memory/i.test(err.message)) {
    console.error('[wrapper] FATAL out of memory — exiting for systemd restart');
    console.error(err);
    process.exit(1);
  }
  console.error('[wrapper] uncaughtException (continuing):', err);
});

process.on('unhandledRejection', (reason) => {
  if (isSuppressed(reason)) {
    console.error('[wrapper] suppressed unhandledRejection:', (reason && (reason.code || reason.message)) || reason);
    return;
  }
  console.error('[wrapper] unhandledRejection (continuing):', reason);
});

// Surface warnings so we can spot memory leaks (MaxListenersExceededWarning, etc.)
process.on('warning', (w) => {
  console.warn('[wrapper] warning:', w.name, w.message);
});

require('./backend/dist/index.js');

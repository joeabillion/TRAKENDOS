/**
 * Trakend OS process wrapper (backend-local copy — kept in sync with ../ws-wrapper.js).
 *
 * See ../ws-wrapper.js for the policy explanation. This copy is used when the
 * service is launched from inside the backend directory.
 */

const SUPPRESSED_PATTERNS = [
  'handleUpgrade',
  'E2BIG',
  'ECONNRESET',
  'EPIPE',
  'ECONNABORTED',
  'ETIMEDOUT',
  'write after end',
  'Premature close',
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

process.on('warning', (w) => {
  console.warn('[wrapper] warning:', w.name, w.message);
});

require('./dist/index.js');

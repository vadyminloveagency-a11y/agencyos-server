export function serverPlaywrightDisableReason() {
  const explicit = String(process.env.DISABLE_SERVER_PLAYWRIGHT || '').trim();
  if (explicit === '1') return 'env';
  if (explicit === '0') return '';
  if (String(process.env.RENDER || '').toLowerCase() === 'true') return 'render';
  return '';
}

export function isServerPlaywrightDisabled() {
  return Boolean(serverPlaywrightDisableReason());
}

export function assertServerPlaywrightAllowed(action = 'use Playwright on the server') {
  if (!isServerPlaywrightDisabled()) return;
  const error = new Error(
    `Cloud server cannot ${action}. Operators must use AgencyOS Desktop on their PC.`
  );
  error.status = 503;
  error.code = 'SERVER_PLAYWRIGHT_DISABLED';
  throw error;
}

export function isServerPlaywrightDisabled() {
  return String(process.env.DISABLE_SERVER_PLAYWRIGHT || '').trim() === '1';
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

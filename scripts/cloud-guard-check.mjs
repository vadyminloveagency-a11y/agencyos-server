import { assertServerPlaywrightAllowed, isServerPlaywrightDisabled } from '../server-capabilities.js';

process.env.DISABLE_SERVER_PLAYWRIGHT = '1';

if (!isServerPlaywrightDisabled()) {
  throw new Error('Expected DISABLE_SERVER_PLAYWRIGHT=1 to disable cloud Playwright');
}

try {
  assertServerPlaywrightAllowed('cloud guard test');
  throw new Error('assertServerPlaywrightAllowed should have thrown');
} catch (error) {
  if (error.code !== 'SERVER_PLAYWRIGHT_DISABLED') throw error;
}

delete process.env.DISABLE_SERVER_PLAYWRIGHT;
process.env.RENDER = 'true';
if (!isServerPlaywrightDisabled()) {
  throw new Error('Expected RENDER=true to auto-disable cloud Playwright');
}

console.log('cloud guard check passed');

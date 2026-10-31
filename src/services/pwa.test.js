// The install prompt and the banner rule (28-Oct, PWA).
import { watchInstall, canInstall, promptInstall, onInstallChange, installHint, installDismissed, dismissInstall, isIOS } from './pwa';

beforeEach(() => { try { localStorage.clear(); } catch (e) { /* ignore */ } });

test('the install prompt is captured, offered once, and consumed by prompting', async () => {
  watchInstall();
  const seen = [];
  onInstallChange(v => seen.push(v));
  expect(canInstall()).toBe(false);
  const ev = new Event('beforeinstallprompt', { cancelable: true });
  ev.prompt = jest.fn();
  ev.userChoice = Promise.resolve({ outcome: 'accepted' });
  window.dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(true);
  expect(canInstall()).toBe(true);
  expect(seen).toEqual([true]);
  await expect(promptInstall()).resolves.toBe('accepted');
  expect(ev.prompt).toHaveBeenCalled();
  expect(canInstall()).toBe(false);
  await expect(promptInstall()).resolves.toBe('unavailable');
});

test('the banner rule', () => {
  expect(installHint({ installable: true, standalone: false, ios: false, dismissed: false })).toBe('prompt');
  expect(installHint({ installable: false, standalone: false, ios: true, dismissed: false })).toBe('ios');
  expect(installHint({ installable: true, standalone: true, ios: false, dismissed: false })).toBe('');
  expect(installHint({ installable: true, standalone: false, ios: false, dismissed: true })).toBe('');
  expect(installHint({ installable: false, standalone: false, ios: false, dismissed: false })).toBe('');
});

test('"Not now" is remembered for a week', () => {
  expect(installDismissed()).toBe(false);
  dismissInstall(1000);
  expect(installDismissed(1000 + 6 * 24 * 3600 * 1000)).toBe(true);
  expect(installDismissed(1000 + 8 * 24 * 3600 * 1000)).toBe(false);
});

test('iOS is recognised by the user agent', () => {
  expect(isIOS('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15')).toBe(true);
  expect(isIOS('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120')).toBe(false);
});

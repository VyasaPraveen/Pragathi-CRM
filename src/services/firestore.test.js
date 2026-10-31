// Marking notifications read (Req 7, 27-Oct; QC round 2): a first login can
// have hundreds unread for one section, so they go a few at a time, with one
// refresh at the end and no activity-log line for each.
jest.mock('./api', () => ({ apiGet: jest.fn(), apiPost: jest.fn(), apiPatch: jest.fn(), apiDelete: jest.fn(), getMe: () => null }));
import { apiPatch, apiPost } from './api';
import { markNotificationsRead } from './firestore';

beforeEach(() => { apiPatch.mockReset(); apiPost.mockReset(); });

test('marks a few at a time, logs no activity, refreshes once', async () => {
  let inFlight = 0, peak = 0;
  apiPatch.mockImplementation(() => { inFlight++; peak = Math.max(peak, inFlight); return new Promise(r => setTimeout(() => { inFlight--; r({}); }, 1)); });
  const pings = [];
  const onPing = (e) => pings.push(e.detail.col);
  window.addEventListener('pps:refresh', onPing);
  await markNotificationsRead(Array.from({ length: 20 }, (_, i) => 'n' + i));
  window.removeEventListener('pps:refresh', onPing);
  expect(apiPatch).toHaveBeenCalledTimes(20);
  expect(apiPatch).toHaveBeenCalledWith('/collections/notifications/n7', { read: true });
  expect(peak).toBeLessThanOrEqual(6);
  expect(apiPost).not.toHaveBeenCalled();
  expect(pings).toEqual(['notifications']);
});

test('one failure does not stop the rest; nothing to do means no refresh', async () => {
  apiPatch.mockImplementation((url) => (url.endsWith('/bad') ? Promise.reject(new Error('500')) : Promise.resolve({})));
  const pings = [];
  const onPing = (e) => pings.push(e.detail.col);
  window.addEventListener('pps:refresh', onPing);
  await expect(markNotificationsRead(['a', 'bad', 'c'])).resolves.toBeUndefined();
  expect(apiPatch).toHaveBeenCalledTimes(3);
  await markNotificationsRead([]);
  window.removeEventListener('pps:refresh', onPing);
  expect(pings).toEqual(['notifications']);
});

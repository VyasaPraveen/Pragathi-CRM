// The login screen (28-Oct): each mode renders with its fields, the brand
// panel carries the animated pieces, and the error message shows when the
// sign-in is refused.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

let mockAuth = {};
jest.mock('../context/AuthContext', () => ({ useAuth: () => mockAuth }));
const Login = require('./Login').default;

function mount(element) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(element); });
  return { host, unmount: () => { act(() => { root.unmount(); }); host.remove(); } };
}
const click = (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

beforeEach(() => { mockAuth = { login: jest.fn(), signup: jest.fn(), resetPassword: jest.fn() }; });

test('sign-in mode: the brand panel, the fields and the shining button', () => {
  const { host, unmount } = mount(<Login />);
  const text = host.textContent;
  expect(text).toContain('Pragathi Power Solutions');
  expect(text).toContain('Welcome back');
  expect(host.querySelector('.lg-bolt')).not.toBeNull();
  expect(host.querySelectorAll('.lg-ripple').length).toBe(3);
  expect(host.querySelectorAll('.lg-orb').length).toBe(3);
  expect(host.querySelector('.lg-emblem-wrap img').getAttribute('src')).toBe('/icon-192.png');
  expect(host.querySelectorAll('.lg-feats li').length).toBe(3);
  expect(host.querySelector('input[type="email"]')).not.toBeNull();
  expect(host.querySelector('input[type="password"]')).not.toBeNull();
  expect(host.querySelector('button[type="submit"].lg-shine').textContent).toContain('Sign In');
  expect(host.querySelectorAll('.lg-ic .lg-icon').length).toBe(2);
  unmount();
});

test('switching to sign-up and reset keeps every field', () => {
  const { host, unmount } = mount(<Login />);
  const link = (label) => [...host.querySelectorAll('button.lg-link')].find(b => b.textContent.trim().startsWith(label));
  click(link('Sign Up'));
  expect(host.textContent).toContain('Create your account');
  expect(host.querySelector('input[type="tel"]')).not.toBeNull();
  expect(host.querySelector('select')).not.toBeNull();
  expect(host.querySelectorAll('input[type="password"]').length).toBe(2);
  click(link('Sign In'));
  click(link('Forgot password?'));
  expect(host.textContent).toContain('Reset your password');
  expect(host.querySelector('button[type="submit"]').textContent).toContain('Send Reset Request');
  unmount();
});

test('a refused sign-in shows the message with the shake', async () => {
  mockAuth.login = jest.fn(() => Promise.reject({ message: 'Invalid email or password' }));
  const { host, unmount } = mount(<Login />);
  const set = (sel, value) => act(() => {
    const el = host.querySelector(sel);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  set('input[type="email"]', 'x@y.com');
  set('input[type="password"]', 'secret');
  await act(async () => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(mockAuth.login).toHaveBeenCalledWith('x@y.com', 'secret');
  expect(host.querySelector('.aerr.lg-shake').textContent).toContain('Invalid email or password');
  unmount();
});

test('typing in the email field keeps the focus (the field wrapper is stable)', () => {
  const { host, unmount } = mount(<Login />);
  const input = host.querySelector('input[type="email"]');
  act(() => { input.focus(); });
  expect(document.activeElement).toBe(input);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'a');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(document.activeElement).toBe(host.querySelector('input[type="email"]'));
  expect(host.querySelector('input[type="email"]')).toBe(input);
  unmount();
});

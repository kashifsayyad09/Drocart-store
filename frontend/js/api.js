'use strict';
// Backend runs as a separate service. Set via window.DROCART_API_BASE
// (injected in index.html / auth.html) — falls back to localhost:5000 for dev.
const API_BASE = "/api";
const API = (() => {
  const request = async (method, url, body = null) => {
    const cfg = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include' };
    if (body) cfg.body = JSON.stringify(body);
    try {
      const res = await fetch(API_BASE + url, cfg);
      const data = await res.json();
      if (!res.ok && !data.success) throw new APIError(data.error || 'Request failed', res.status);
      return data;
    } catch (e) { if (e instanceof APIError) throw e; throw new APIError('Network error — please try again', 0); }
  };
  return { get: u => request('GET',u), post: (u,b) => request('POST',u,b), put: (u,b) => request('PUT',u,b), patch: (u,b) => request('PATCH',u,b), delete: u => request('DELETE',u) };
})();
class APIError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
const AuthAPI = { me: () => API.get('/auth/me'), register: d => API.post('/auth/register', d), login: d => API.post('/auth/login', d), logout: () => API.post('/auth/logout'), otpSend: d => API.post('/auth/otp/send', d), otpVerify: d => API.post('/auth/otp/verify', d), forgotPassword: d => API.post('/auth/forgot-password', d), resetPassword: d => API.post('/auth/reset-password', d), googleUrl: () => API.get('/auth/google'), googleCallback: d => API.post('/auth/google/callback', d), totpSetup: () => API.get('/auth/totp/setup'), totpEnable: d => API.post('/auth/totp/enable', d), totpVerify: d => API.post('/auth/totp/verify', d) };
const ProductAPI = { list: p => API.get('/products?' + new URLSearchParams(p || {})), detail: s => API.get(`/products/${s}`), suggest: q => API.get(`/products/search/suggest?q=${encodeURIComponent(q)}`), categories: () => API.get('/categories') };
const CartAPI = { get: () => API.get('/cart'), add: (pid, qty) => API.post('/cart', { product_id: pid, qty }), update: (id, qty) => API.put(`/cart/${id}`, { qty }), remove: id => API.delete(`/cart/${id}`), clear: () => API.delete('/cart/clear') };
const WishAPI = { get: () => API.get('/wishlist'), toggle: pid => API.post(`/wishlist/${pid}`) };
const OrderAPI = { list: () => API.get('/orders'), detail: id => API.get(`/orders/${id}`), place: d => API.post('/orders', d), cancel: (id, reason) => API.post(`/orders/${id}/cancel`, { reason }), track: num => API.get(`/track/${num}`) };
const PaymentAPI = { initiate: d => API.post('/payments/initiate', d), confirm: d => API.post('/payments/confirm', d), coupon: d => API.post('/coupons/apply', d) };
const ChatAPI = { createSession: d => API.post('/chat/sessions', d), sessions: () => API.get('/chat/sessions'), messages: sid => API.get(`/chat/sessions/${sid}/messages`), send: (sid, body) => API.post(`/chat/sessions/${sid}/messages`, { body }), rate: (sid, d) => API.post(`/chat/sessions/${sid}/rate`, d) };
const NotifAPI = { get: () => API.get('/notifications'), markRead: id => API.post('/notifications/read', id ? { id } : {}) };
const ProfileAPI = { get: () => API.get('/profile'), update: d => API.put('/profile', d), addAddress: d => API.post('/addresses', d), deleteAddress: id => API.delete(`/addresses/${id}`) };
const AdminAPI = { stats: () => API.get('/admin/stats'), orders: () => API.get('/admin/orders'), updateOrder: (id, d) => API.patch(`/admin/orders/${id}`, d), addProduct: d => API.post('/admin/products', d), deleteProduct: id => API.delete(`/admin/products/${id}`), advanceTrack: (id, d) => API.post(`/admin/orders/${id}/advance`, d), users: () => API.get('/admin/users'), coupons: () => API.get('/admin/coupons'), addCoupon: d => API.post('/admin/coupons', d), agentSessions: () => API.get('/admin/agent/sessions'), assignSession: sid => API.post(`/admin/agent/sessions/${sid}/assign`) };
window.addEventListener('unhandledrejection', e => { if (e.reason instanceof APIError && e.reason.status === 401) { if (!location.pathname.startsWith('/login') && !location.pathname.startsWith('/signup')) { sessionStorage.setItem('redir', location.pathname + location.search); location.href = '/login'; } e.preventDefault(); } });

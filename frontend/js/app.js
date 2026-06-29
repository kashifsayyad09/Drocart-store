'use strict';
const Store = (() => {
  const state = { user: null, cartCount: 0, notifCount: 0 };
  const listeners = {};
  const get = k => state[k];
  const set = (k, v) => { state[k] = v; (listeners[k] || []).forEach(fn => fn(v)); };
  const on = (k, fn) => { (listeners[k] = listeners[k] || []).push(fn); };
  return { get, set, on };
})();

const Toast = (() => {
  const container = () => document.getElementById('toast-container');
  const show = (msg, type = 'info', duration = 3500) => {
    const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span class="toast-icon">${icons[type] || '✦'}</span><span>${msg}</span>`;
    container()?.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, duration);
  };
  return { show, success: (m,d) => show(m,'success',d), error: (m,d) => show(m,'error',d), info: (m,d) => show(m,'info',d) };
})();

const Modal = (() => {
  let stack = [];
  const show = (html, opts = {}) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = `<div class="modal-box ${opts.wide ? 'modal-wide' : ''}">${opts.title ? `<div class="modal-header"><h3 class="modal-title">${opts.title}</h3><button class="modal-close-btn" onclick="Modal.close()">✕</button></div>` : ''}<div class="modal-body">${html}</div></div>`;
    if (!opts.persistent) overlay.addEventListener('click', e => { if (e.target === overlay) Modal.close(); });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
    stack.push(overlay);
    return overlay;
  };
  const close = () => { const top = stack.pop(); if (top) { top.classList.remove('open'); setTimeout(() => top.remove(), 300); } };
  const closeAll = () => { while (stack.length) close(); };
  return { show, close, closeAll };
})();

const fmt = {
  price: v => `₹${Number(v).toLocaleString('en-IN')}`,
  date: v => v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
  time: v => v ? new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—',
  stars: r => '★'.repeat(Math.floor(r || 0)) + '☆'.repeat(5 - Math.floor(r || 0)),
  status: s => s ? s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—',
};

const statusColor = { pending: 'status-yellow', confirmed: 'status-blue', processing: 'status-blue', packed: 'status-blue', shipped: 'status-purple', out_for_delivery: 'status-orange', delivered: 'status-green', cancelled: 'status-red', returned: 'status-red', refunded: 'status-gray' };

function buildOTPInputs(containerId, length = 6) {
  const c = document.getElementById(containerId);
  if (!c) return;
  c.innerHTML = [...Array(length)].map((_, i) => `<input type="text" maxlength="1" class="otp-box" data-idx="${i}" inputmode="numeric">`).join('');
  c.querySelectorAll('.otp-box').forEach((box, i, all) => {
    box.addEventListener('input', e => { if (e.target.value && i < length - 1) all[i+1].focus(); });
    box.addEventListener('keydown', e => { if (e.key === 'Backspace' && !e.target.value && i > 0) all[i-1].focus(); });
    box.addEventListener('paste', e => { const t = e.clipboardData.getData('text').replace(/\D/g,'').slice(0,length); t.split('').forEach((ch,j) => { if(all[j]) all[j].value=ch; }); if(all[t.length-1]) all[t.length-1].focus(); e.preventDefault(); });
  });
}
function getOTPValue(containerId) { return [...document.getElementById(containerId).querySelectorAll('.otp-box')].map(b => b.value).join(''); }

const Reveal = (() => {
  let obs = null;
  const observe = () => {
    if (!obs) obs = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } }), { threshold: 0.08 });
    document.querySelectorAll('.reveal:not(.visible)').forEach(el => obs.observe(el));
  };
  return { observe };
})();

const App = {
  async init() {
    try { const r = await AuthAPI.me(); if (r.logged_in) { Store.set('user', r); this.updateNav(r); this.syncCart(); this.syncNotifs(); } } catch (_) {}
    const si = document.getElementById('nav-search-input');
    if (si) {
      let debounce;
      si.addEventListener('input', e => { clearTimeout(debounce); debounce = setTimeout(async () => { const q = e.target.value.trim(); if (q.length >= 2) { try { const r = await ProductAPI.suggest(q); this.showSearchDD(r.data || []); } catch(_) {} } else this.hideSearchDD(); }, 280); });
      si.addEventListener('keydown', e => { if (e.key === 'Enter') { this.hideSearchDD(); location.href = `/products?q=${encodeURIComponent(si.value.trim())}`; } });
      document.addEventListener('click', e => { if (!e.target.closest('.nav-search-wrap')) this.hideSearchDD(); });
    }
    this.mountPage();
    Reveal.observe();
  },
  updateNav(user) {
    const authBtn=document.getElementById('nav-auth-btn'), userMenu=document.getElementById('nav-user-menu'), nameEl=document.getElementById('nav-user-name'), initialEl=document.getElementById('nav-user-initial'), notifBtn=document.getElementById('nav-notif-btn');
    if (authBtn) authBtn.style.display = user ? 'none' : 'flex';
    if (userMenu) userMenu.style.display = user ? 'flex' : 'none';
    if (user) { if(nameEl) nameEl.textContent=user.name.split(' ')[0]; if(initialEl) initialEl.textContent=user.name.charAt(0).toUpperCase(); if(notifBtn) notifBtn.style.display='flex'; }
  },
  async syncCart() { if (!Store.get('user')) return; try { const r = await CartAPI.get(); if (r.success) Store.set('cartCount', r.data.count || 0); } catch(_) {} },
  async syncNotifs() { if (!Store.get('user')) return; try { const r = await NotifAPI.get(); if (r.success) Store.set('notifCount', r.data.unread || 0); } catch(_) {} },
  showSearchDD(products) {
    const dd = document.getElementById('search-dropdown');
    if (!dd) return;
    if (!products.length) { this.hideSearchDD(); return; }
    dd.innerHTML = products.map(p => `<a href="/product/${p.slug}" class="search-item"><span class="search-item-emoji">${p.emoji}</span><div class="search-item-info"><span class="search-item-name">${p.name}</span><span class="search-item-cat">${p.category_name}</span></div><span class="search-item-price">${fmt.price(p.price)}</span></a>`).join('');
    dd.classList.add('active');
  },
  hideSearchDD() { document.getElementById('search-dropdown')?.classList.remove('active'); },
  mountPage() {
    const cfg = window.DROCART_CONFIG || {}; const page = cfg.page || 'home';
    document.getElementById('page-loading-init')?.remove();
    const content = document.getElementById('app-content'); if (!content) return;
    const map = { home: () => PageHome.mount(content), products: () => PageProducts.mount(content, cfg), product: () => PageProduct.mount(content, cfg), cart: () => PageCart.mount(content), checkout: () => PageCheckout.mount(content), payment: () => PagePayment.mount(content, cfg), orders: () => PageOrders.mount(content), order: () => PageOrder.mount(content, cfg), tracking: () => PageTracking.mount(content, cfg), account: () => PageAccount.mount(content), wishlist: () => PageWishlist.mount(content), chat: () => PageChat.mount(content), google_callback: () => this.handleGoogleCb(), not_found: () => PageNotFound.mount(content), admin: () => PageAdmin.mount(content) };
    const fn = map[page]; if (fn) fn(); else PageHome.mount(content);
  },
  async handleGoogleCb() {
    const code = new URLSearchParams(location.search).get('code');
    if (!code) { location.href='/login'; return; }
    try { const r = await AuthAPI.googleCallback({ code }); if (r.success) { Store.set('user',r.data); this.updateNav(r.data); this.syncCart(); this.syncNotifs(); Toast.success(`Welcome, ${r.data.name.split(' ')[0]}! 🎉`); setTimeout(() => location.href = sessionStorage.getItem('redir') || '/', 800); } else { Toast.error(r.error || 'Google login failed'); setTimeout(() => location.href='/login',1500); } } catch(e) { Toast.error(e.message); setTimeout(() => location.href='/login',1500); }
  },
};

const ProductCard = {
  _BG: ['bg-purple','bg-teal','bg-rose','bg-gold','bg-pink','bg-blue'], _idx: 0,
  render(p) {
    const bg=this._BG[this._idx++%this._BG.length], badge=p.badge?`<span class="product-badge badge-${p.badge}">${p.badge==='new'?'✦ New':p.badge==='sale'?'◈ Sale':'🔥 Hot'}</span>`:'', oldP=p.old_price?`<span class="product-old-price">${fmt.price(p.old_price)}</span>`:'', disc=p.old_price?`<span class="disc-pct">-${Math.round((1-p.price/p.old_price)*100)}%</span>`:'';
    return `<div class="product-card reveal" onclick="location.href='/product/${p.slug}'"><div class="product-img-wrap ${bg}">${badge}<button class="product-wishlist" data-pid="${p.id}" onclick="event.stopPropagation()">♡</button><div class="product-emoji">${p.emoji}</div></div><div class="product-info"><div class="product-category">${p.category_name||''}</div><div class="product-name">${p.name}</div><div class="product-rating"><span class="stars">${fmt.stars(p.rating)}</span><span class="rating-count">${p.rating} (${Number(p.review_count||0).toLocaleString()})</span></div><div class="product-footer"><div class="price-wrap"><span class="product-price">${fmt.price(p.price)}</span>${oldP}${disc}</div><button class="btn-add" data-pid="${p.id}" onclick="event.stopPropagation()">+</button></div></div></div>`;
  },
  bindAll(container) {
    container.querySelectorAll('.btn-add').forEach(btn => { btn.addEventListener('click', async e => { e.stopPropagation(); if (!Store.get('user')) { location.href='/login'; return; } try { const r=await CartAPI.add(parseInt(btn.dataset.pid),1); if(r.success){App.syncCart();Toast.success('Added to cart! 🛒');}else Toast.error(r.error); } catch(err){Toast.error(err.message);} }); });
    container.querySelectorAll('.product-wishlist').forEach(btn => { btn.addEventListener('click', async e => { e.stopPropagation(); if(!Store.get('user')){location.href='/login';return;} try { const r=await WishAPI.toggle(parseInt(btn.dataset.pid)); if(r.success){const w=r.data.wishlisted;btn.textContent=w?'♥':'♡';btn.style.color=w?'var(--rose)':'';Toast.info(w?'♥ Wishlisted':'♡ Removed');} } catch(err){Toast.error(err.message);} }); });
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());

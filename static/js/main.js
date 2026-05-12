/* ============================================================
   DROCART — Main JavaScript
   main.js
   ============================================================ */

'use strict';

/* ────────────────────────────────────────────
   CURSOR
──────────────────────────────────────────── */
const CursorManager = (() => {
  const cursor = document.getElementById('cursor');
  const ring   = document.getElementById('cursor-ring');
  if (!cursor) return;
  let mx = 0, my = 0, rx = 0, ry = 0;
  document.addEventListener('mousemove', e => {
    mx = e.clientX; my = e.clientY;
    cursor.style.left = mx + 'px';
    cursor.style.top  = my + 'px';
  });
  const tick = () => {
    rx += (mx - rx) * 0.1;
    ry += (my - ry) * 0.1;
    ring.style.left = rx + 'px';
    ring.style.top  = ry + 'px';
    requestAnimationFrame(tick);
  };
  tick();
})();

/* ────────────────────────────────────────────
   BACKGROUND PARTICLE CANVAS
──────────────────────────────────────────── */
const BGCanvas = (() => {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, particles = [];

  const resize = () => {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  };
  resize();
  window.addEventListener('resize', resize);

  const COLORS = ['255,200,66','124,111,255','0,229,196','255,95,126'];
  class Particle {
    constructor() { this.reset(); }
    reset() {
      this.x     = Math.random() * W;
      this.y     = Math.random() * H;
      this.r     = Math.random() * 1.4 + 0.3;
      this.vx    = (Math.random() - 0.5) * 0.28;
      this.vy    = (Math.random() - 0.5) * 0.28;
      this.alpha = Math.random() * 0.38 + 0.05;
      this.col   = COLORS[Math.floor(Math.random() * COLORS.length)];
    }
    update() {
      this.x += this.vx; this.y += this.vy;
      if (this.x < 0 || this.x > W || this.y < 0 || this.y > H) this.reset();
    }
    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${this.col},${this.alpha})`;
      ctx.fill();
    }
  }

  for (let i = 0; i < 160; i++) particles.push(new Particle());

  const loop = () => {
    ctx.clearRect(0, 0, W, H);
    // connections
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const d  = Math.hypot(dx, dy);
        if (d < 110) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(124,111,255,${0.04 * (1 - d / 110)})`;
          ctx.lineWidth   = 0.5;
          ctx.stroke();
        }
      }
    }
    particles.forEach(p => { p.update(); p.draw(); });
    requestAnimationFrame(loop);
  };
  loop();
})();

/* ────────────────────────────────────────────
   HERO THREE.JS SCENE
──────────────────────────────────────────── */
const HeroScene = (() => {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas || typeof THREE === 'undefined') return;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.offsetWidth || 500, canvas.offsetHeight || 500);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 5);

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const dLight1 = new THREE.DirectionalLight(0xf5c842, 2.2);
  dLight1.position.set(3, 5, 5);
  scene.add(dLight1);
  const dLight2 = new THREE.DirectionalLight(0x7c6fff, 1.6);
  dLight2.position.set(-3, -2, 3);
  scene.add(dLight2);
  const dLight3 = new THREE.DirectionalLight(0x00e5c4, 1.0);
  dLight3.position.set(0, -5, 0);
  scene.add(dLight3);

  const group = new THREE.Group();
  scene.add(group);

  // TorusKnot centerpiece
  const knotGeo = new THREE.TorusKnotGeometry(1.2, 0.38, 180, 20, 2, 3);
  const knotMat = new THREE.MeshPhongMaterial({
    color: 0x1a1040, shininess: 220,
    specular: 0x7c6fff, emissive: 0x0a0520,
  });
  group.add(new THREE.Mesh(knotGeo, knotMat));

  // Wireframe overlay
  const wireGeo = new THREE.TorusKnotGeometry(1.22, 0.39, 60, 10, 2, 3);
  const wireMat = new THREE.MeshBasicMaterial({ color: 0x7c6fff, wireframe: true, transparent: true, opacity: 0.16 });
  group.add(new THREE.Mesh(wireGeo, wireMat));

  // Orbiting spheres
  const orbitConfigs = [
    { r: 0.18, dist: 2.2, speed:  1.3, color: 0xf5c842, y:  0.3 },
    { r: 0.12, dist: 1.8, speed: -2.1, color: 0xff5f7e, y: -0.5 },
    { r: 0.10, dist: 2.6, speed:  0.9, color: 0x00e5c4, y:  0.8 },
  ];
  const orbiters = orbitConfigs.map(cfg => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(cfg.r, 16, 16),
      new THREE.MeshPhongMaterial({ color: cfg.color, shininess: 300, specular: 0xffffff })
    );
    scene.add(mesh);
    return { mesh, ...cfg, angle: Math.random() * Math.PI * 2 };
  });

  // Floating point cloud
  const ptCount = 120;
  const ptPos   = new Float32Array(ptCount * 3);
  for (let i = 0; i < ptCount; i++) {
    const t = Math.random() * Math.PI * 2;
    const p = Math.random() * Math.PI;
    const r = 1.8 + Math.random() * 1.4;
    ptPos[i*3]   = r * Math.sin(p) * Math.cos(t);
    ptPos[i*3+1] = r * Math.sin(p) * Math.sin(t);
    ptPos[i*3+2] = r * Math.cos(p);
  }
  const ptGeo = new THREE.BufferGeometry();
  ptGeo.setAttribute('position', new THREE.BufferAttribute(ptPos, 3));
  const pts = new THREE.Points(ptGeo, new THREE.PointsMaterial({
    color: 0xf5c842, size: 0.04, transparent: true, opacity: 0.7
  }));
  scene.add(pts);

  let t = 0;
  let mox = 0, moy = 0;
  document.addEventListener('mousemove', e => {
    mox = (e.clientX / window.innerWidth  - 0.5) * 0.55;
    moy = -(e.clientY / window.innerHeight - 0.5) * 0.55;
  });

  const animate = () => {
    requestAnimationFrame(animate);
    t += 0.01;
    group.rotation.x += (moy * 0.5 - group.rotation.x) * 0.05;
    group.rotation.y += (mox * 0.5 + t * 0.28 - group.rotation.y) * 0.05;
    orbiters.forEach(o => {
      o.angle += 0.01 * o.speed;
      o.mesh.position.set(
        Math.cos(o.angle) * o.dist,
        o.y + Math.sin(t * 0.5) * 0.28,
        Math.sin(o.angle) * o.dist
      );
    });
    pts.rotation.y += 0.003;
    renderer.render(scene, camera);
  };
  animate();

  new ResizeObserver(() => {
    const w = canvas.offsetWidth, h = canvas.offsetHeight;
    renderer.setSize(w, h);
  }).observe(canvas);
})();

/* ────────────────────────────────────────────
   MARQUEE
──────────────────────────────────────────── */
const MarqueeInit = (() => {
  const track = document.getElementById('marquee-track');
  if (!track) return;
  const items = [
    'Free Shipping Over ₹999', 'New Drops Weekly', 'Certified Authentic',
    '30-Day Returns', 'Premium Quality', 'Secure Checkout',
    '48,000+ Happy Customers', 'Top Rated Seller', 'Express Delivery',
  ];
  const doubled = [...items, ...items];
  track.innerHTML = doubled.map(t =>
    `<span class="marquee-item"><span class="marquee-dot" aria-hidden="true"></span>${t}</span>`
  ).join('');
})();

/* ────────────────────────────────────────────
   SCROLL REVEAL
──────────────────────────────────────────── */
const RevealObserver = (() => {
  const observe = () => {
    const els = document.querySelectorAll('.reveal:not(.visible)');
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); }
      });
    }, { threshold: 0.08 });
    els.forEach(el => obs.observe(el));
  };
  observe();
  return { observe };
})();

/* ────────────────────────────────────────────
   TOAST
──────────────────────────────────────────── */
const Toast = (() => {
  const el  = document.getElementById('toast');
  const msg = document.getElementById('toast-msg');
  let timer;
  const show = (text, duration = 3000) => {
    if (!el) return;
    msg.textContent = text;
    el.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove('show'), duration);
  };
  return { show };
})();

/* ────────────────────────────────────────────
   UI UTILITIES
──────────────────────────────────────────── */
const UI = (() => {
  const openOverlay  = () => document.getElementById('overlay').classList.add('visible');
  const closeOverlay = () => document.getElementById('overlay').classList.remove('visible');

  const openModal  = id => {
    document.getElementById(id).classList.add('open');
    openOverlay();
  };
  const closeModal = id => document.getElementById(id).classList.remove('open');

  const closeAll = () => {
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
    document.getElementById('cart-sidebar').classList.remove('open');
    closeOverlay();
  };

  return { openModal, closeModal, closeAll, openOverlay, closeOverlay };
})();

/* ────────────────────────────────────────────
   API HELPER
──────────────────────────────────────────── */
const API = (() => {
  const request = async (method, url, body = null) => {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    };
    if (body) opts.body = JSON.stringify(body);
    const res  = await fetch(url, opts);
    const data = await res.json();
    return data;
  };
  return {
    get:    url       => request('GET',    url),
    post:   (url, b)  => request('POST',   url, b),
    put:    (url, b)  => request('PUT',    url, b),
    patch:  (url, b)  => request('PATCH',  url, b),
    delete: url       => request('DELETE', url),
  };
})();

/* ────────────────────────────────────────────
   AUTH
──────────────────────────────────────────── */
const Auth = (() => {
  let currentUser = null;

  const init = async () => {
    const data = await API.get('/api/auth/me');
    if (data.logged_in) {
      currentUser = data;
      updateNavUI(data);
    }
  };

  const updateNavUI = user => {
    const btn   = document.getElementById('auth-btn');
    const label = document.getElementById('auth-label');
    if (!btn) return;
    if (user) {
      label.textContent = user.name.split(' ')[0];
      btn.onclick = () => {
        if (confirm('Log out?')) logout();
      };
    } else {
      label.textContent = 'Login';
      btn.onclick = openModal;
    }
  };

  const openModal = () => UI.openModal('auth-modal');

  const switchTab = tab => {
    document.querySelectorAll('.auth-tab').forEach((t, i) => {
      t.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'register'));
    });
    document.getElementById('login-form').style.display    = tab === 'login'    ? 'block' : 'none';
    document.getElementById('register-form').style.display = tab === 'register' ? 'block' : 'none';
  };

  const login = async () => {
    const email = document.getElementById('login-email').value.trim();
    const pass  = document.getElementById('login-pass').value;
    if (!email || !pass) { Toast.show('Please fill in all fields'); return; }
    const data = await API.post('/api/auth/login', { email, password: pass });
    if (data.success) {
      currentUser = data.data;
      updateNavUI(data.data);
      UI.closeAll();
      Toast.show(`✦ Welcome back, ${data.data.name.split(' ')[0]}!`);
      Cart.sync();
    } else {
      Toast.show('❌ ' + data.error);
    }
  };

  const register = async () => {
    const name  = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const pass  = document.getElementById('reg-pass').value;
    if (!name || !email || !pass) { Toast.show('Please fill in all fields'); return; }
    const data = await API.post('/api/auth/register', { name, email, password: pass });
    if (data.success) {
      currentUser = data.data;
      updateNavUI(data.data);
      UI.closeAll();
      Toast.show(`🎉 Welcome to Drocart, ${name.split(' ')[0]}!`);
      Cart.sync();
    } else {
      Toast.show('❌ ' + data.error);
    }
  };

  const logout = async () => {
    await API.post('/api/auth/logout');
    currentUser = null;
    updateNavUI(null);
    Cart.clear();
    Toast.show('Logged out successfully');
  };

  const getUser = () => currentUser;

  init();
  return { openModal, switchTab, login, register, logout, getUser };
})();

/* ────────────────────────────────────────────
   WISHLIST (local + server)
──────────────────────────────────────────── */
const Wishlist = (() => {
  let wishSet = new Set();

  const toggle = async (productId, btn) => {
    if (!Auth.getUser()) { Auth.openModal(); return; }
    const data = await API.post(`/api/wishlist/${productId}`);
    if (data.success) {
      const wishlisted = data.data.wishlisted;
      wishSet[wishlisted ? 'add' : 'delete'](productId);
      if (btn) {
        btn.classList.toggle('active', wishlisted);
        btn.textContent = wishlisted ? '♥' : '♡';
        btn.style.color = wishlisted ? 'var(--rose)' : '';
      }
      Toast.show(wishlisted ? '♥ Added to wishlist' : '♡ Removed from wishlist');
    }
  };

  return { toggle, has: id => wishSet.has(id) };
})();

/* ────────────────────────────────────────────
   CART
──────────────────────────────────────────── */
const Cart = (() => {
  let items    = [];
  let subtotal = 0;
  let shipping = 0;
  let total    = 0;
  let discount = 0;
  let appliedCoupon = null;

  const sync = async () => {
    if (!Auth.getUser()) { renderLocalEmpty(); return; }
    const data = await API.get('/api/cart');
    if (data.success) {
      items    = data.data.items;
      subtotal = data.data.subtotal;
      shipping = data.data.shipping;
      total    = data.data.total;
      renderSidebar();
    }
  };

  const renderLocalEmpty = () => {
    updateBadges(0);
    const body   = document.getElementById('cart-body');
    const footer = document.getElementById('cart-footer');
    if (body) body.innerHTML = `<div class="empty-state"><div class="empty-icon">🛒</div><p>Your cart is empty</p><a href="#featured" class="btn-sm" onclick="UI.closeAll()">Start Shopping →</a></div>`;
    if (footer) footer.style.display = 'none';
  };

  const renderSidebar = () => {
    const body     = document.getElementById('cart-body');
    const footer   = document.getElementById('cart-footer');
    const badge    = document.getElementById('cart-count-badge');
    const navBadge = document.getElementById('nav-cart-count');
    if (!body) return;

    const count = items.reduce((s, i) => s + i.qty, 0);
    updateBadges(count);

    if (items.length === 0) { renderLocalEmpty(); return; }
    if (footer) footer.style.display = 'block';

    body.innerHTML = items.map(item => `
      <div class="cart-item">
        <div class="cart-item-img">${item.emoji}</div>
        <div class="cart-item-info">
          <div class="cart-item-name">${item.name}</div>
          <div class="cart-item-price">₹${Number(item.price).toLocaleString()}</div>
          <div class="cart-item-qty">
            <button class="qty-btn" onclick="Cart.changeQty(${item.id}, ${item.qty - 1})">−</button>
            <span class="qty-num">${item.qty}</span>
            <button class="qty-btn" onclick="Cart.changeQty(${item.id}, ${item.qty + 1})">+</button>
            <button class="cart-item-remove" onclick="Cart.removeItem(${item.id})" aria-label="Remove">✕</button>
          </div>
        </div>
      </div>
    `).join('');

    const finalTotal = Math.max(0, total - discount);
    document.getElementById('cart-subtotal').textContent = `₹${subtotal.toLocaleString()}`;
    document.getElementById('cart-shipping').textContent = shipping === 0 ? 'Free' : `₹${shipping}`;
    document.getElementById('cart-total').textContent    = `₹${finalTotal.toLocaleString()}`;
  };

  const updateBadges = count => {
    ['cart-count-badge', 'nav-cart-count'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = count;
    });
  };

  const add = async (productId) => {
    if (!Auth.getUser()) { Auth.openModal(); return; }
    const data = await API.post('/api/cart', { product_id: productId, qty: 1 });
    if (data.success) {
      await sync();
      Toast.show('✦ Added to cart!');
    } else {
      Toast.show('❌ ' + data.error);
    }
  };

  const changeQty = async (itemId, newQty) => {
    const data = await API.put(`/api/cart/${itemId}`, { qty: newQty });
    if (data.success) await sync();
  };

  const removeItem = async (itemId) => {
    const data = await API.delete(`/api/cart/${itemId}`);
    if (data.success) { await sync(); Toast.show('Item removed'); }
  };

  const clear = () => {
    items = []; subtotal = 0; shipping = 0; total = 0;
    renderLocalEmpty();
  };

  const openSidebar = () => {
    document.getElementById('cart-sidebar').classList.add('open');
    UI.openOverlay();
    sync();
  };

  const applyCoupon = async () => {
    const code = document.getElementById('coupon-input').value.trim();
    if (!code) return;
    const data = await API.post('/api/coupons/apply', { code, subtotal });
    if (data.success) {
      discount       = data.data.discount;
      appliedCoupon  = code;
      renderSidebar();
      Toast.show(`🎉 ${data.message}`);
    } else {
      Toast.show('❌ ' + data.error);
    }
  };

  const checkout = () => {
    if (!Auth.getUser()) { Auth.openModal(); return; }
    if (items.length === 0) { Toast.show('Cart is empty'); return; }
    UI.closeAll();
    openCheckoutModal();
  };

  const openCheckoutModal = () => {
    // populate checkout summary
    const checkoutItems = document.getElementById('checkout-items');
    if (checkoutItems) {
      checkoutItems.innerHTML = items.map(i => `
        <div class="checkout-item">
          <span class="checkout-item-emoji">${i.emoji}</span>
          <span style="flex:1">${i.name}</span>
          <span>×${i.qty}</span>
          <span style="color:var(--gold)">₹${(Number(i.price) * i.qty).toLocaleString()}</span>
        </div>
      `).join('');
    }
    const finalTotal = Math.max(0, total - discount);
    const setSafe = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setSafe('ch-subtotal', `₹${subtotal.toLocaleString()}`);
    setSafe('ch-shipping',  shipping === 0 ? 'Free' : `₹${shipping}`);
    setSafe('ch-total',     `₹${finalTotal.toLocaleString()}`);

    UI.openModal('checkout-modal');
  };

  const placeOrder = async () => {
    const address = {
      full_name: document.getElementById('ch-name').value.trim(),
      line1:     document.getElementById('ch-line1').value.trim(),
      line2:     document.getElementById('ch-line2').value.trim(),
      city:      document.getElementById('ch-city').value.trim(),
      state:     document.getElementById('ch-state').value.trim(),
      pincode:   document.getElementById('ch-pin').value.trim(),
      phone:     document.getElementById('ch-phone').value.trim(),
    };
    if (!address.full_name || !address.line1 || !address.city || !address.state || !address.pincode) {
      Toast.show('Please fill in all required address fields'); return;
    }
    const paymentEl = document.querySelector('input[name="payment"]:checked');
    const payment   = paymentEl ? paymentEl.value : 'cod';

    const data = await API.post('/api/orders', { address, payment_method: payment });
    if (data.success) {
      UI.closeAll();
      clear();
      Toast.show(`🎉 Order #${data.data.order_number} placed! Total ₹${data.data.total.toLocaleString()}`, 5000);
    } else {
      Toast.show('❌ ' + data.error);
    }
  };

  // sync on load if user is logged in
  document.addEventListener('DOMContentLoaded', () => setTimeout(sync, 500));

  return { add, changeQty, removeItem, clear, openSidebar, applyCoupon, checkout, placeOrder, sync };
})();

/* ────────────────────────────────────────────
   PRODUCTS
──────────────────────────────────────────── */
const Products = (() => {
  let currentCategory = '';
  let currentPage     = 1;
  let totalPages      = 1;

  const BG_CLASSES = ['bg-purple','bg-teal','bg-rose','bg-gold','bg-pink','bg-blue'];

  const load = async (reset = true) => {
    if (reset) { currentPage = 1; }
    const params = new URLSearchParams({
      featured: '1',
      category: currentCategory,
      page:     currentPage,
      limit:    8,
    });

    const data = await API.get(`/api/products?${params}`);
    if (!data.success) return;

    const grid = document.getElementById('products-grid');
    if (!grid) return;

    const products = data.data.products;
    totalPages     = data.data.pages;

    const btn = document.getElementById('load-more-btn');
    if (btn) btn.style.display = currentPage < totalPages ? 'inline-flex' : 'none';

    if (reset) {
      grid.innerHTML = '';
    }

    if (products.length === 0 && reset) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--mute)">No products found</div>';
      return;
    }

    products.forEach((p, idx) => {
      const bg     = BG_CLASSES[idx % BG_CLASSES.length];
      const badge  = p.badge ? `<span class="product-badge badge-${p.badge}">${badgeLabel(p.badge)}</span>` : '';
      const oldPr  = p.old_price ? `<span class="product-old-price">₹${Number(p.old_price).toLocaleString()}</span>` : '';
      const stars  = '★'.repeat(Math.floor(p.rating)) + '☆'.repeat(5 - Math.floor(p.rating));

      const card = document.createElement('div');
      card.className = 'product-card reveal';
      card.dataset.id = p.id;
      card.innerHTML = `
        <div class="product-img-wrap ${bg}">
          ${badge}
          <button class="product-wishlist" onclick="event.stopPropagation(); Wishlist.toggle(${p.id}, this)" aria-label="Wishlist">♡</button>
          <div class="product-emoji" aria-hidden="true">${p.emoji}</div>
        </div>
        <div class="product-info">
          <div class="product-category">${p.category_name}</div>
          <div class="product-name">${p.name}</div>
          <div class="product-rating">
            <span class="stars" aria-label="${p.rating} stars">${stars}</span>
            <span class="rating-count">${p.rating} (${Number(p.review_count).toLocaleString()})</span>
          </div>
          <div class="product-footer">
            <div class="product-price-wrap">
              <span class="product-price">₹${Number(p.price).toLocaleString()}</span>
              ${oldPr}
            </div>
            <button class="btn-add" onclick="event.stopPropagation(); Cart.add(${p.id})" aria-label="Add to cart" title="Add to cart">+</button>
          </div>
        </div>
      `;
      grid.appendChild(card);
    });

    RevealObserver.observe();
  };

  const badgeLabel = b =>
    b === 'new' ? '✦ New' : b === 'sale' ? '◈ Sale' : '🔥 Hot';

  const filter = (btn, category) => {
    if (btn) {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
    }
    currentCategory = category;
    load(true);
  };

  const loadMore = async () => {
    currentPage++;
    await load(false);
  };

  // Search
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    let debounce;
    searchInput.addEventListener('input', e => {
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        const q = e.target.value.trim();
        if (!q) { load(true); return; }
        const data = await API.get(`/api/products?q=${encodeURIComponent(q)}&limit=12`);
        if (data.success) {
          const grid = document.getElementById('products-grid');
          if (!grid) return;
          grid.innerHTML = '';
          if (data.data.products.length === 0) {
            grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--mute)">No results found</div>';
            return;
          }
          data.data.products.forEach((p, idx) => {
            const bg    = BG_CLASSES[idx % BG_CLASSES.length];
            const badge = p.badge ? `<span class="product-badge badge-${p.badge}">${badgeLabel(p.badge)}</span>` : '';
            const oldPr = p.old_price ? `<span class="product-old-price">₹${Number(p.old_price).toLocaleString()}</span>` : '';
            const stars = '★'.repeat(Math.floor(p.rating)) + '☆'.repeat(5 - Math.floor(p.rating));
            const card  = document.createElement('div');
            card.className = 'product-card reveal';
            card.innerHTML = `
              <div class="product-img-wrap ${bg}">
                ${badge}
                <button class="product-wishlist" onclick="event.stopPropagation(); Wishlist.toggle(${p.id}, this)">♡</button>
                <div class="product-emoji">${p.emoji}</div>
              </div>
              <div class="product-info">
                <div class="product-category">${p.category_name}</div>
                <div class="product-name">${p.name}</div>
                <div class="product-rating">
                  <span class="stars">${stars}</span>
                  <span class="rating-count">${p.rating} (${Number(p.review_count).toLocaleString()})</span>
                </div>
                <div class="product-footer">
                  <div class="product-price-wrap">
                    <span class="product-price">₹${Number(p.price).toLocaleString()}</span>${oldPr}
                  </div>
                  <button class="btn-add" onclick="event.stopPropagation(); Cart.add(${p.id})">+</button>
                </div>
              </div>
            `;
            grid.appendChild(card);
          });
          RevealObserver.observe();
        }
      }, 400);
    });
  }

  load(true);
  return { filter, loadMore };
})();

/* ────────────────────────────────────────────
   CATEGORIES
──────────────────────────────────────────── */
const Categories = (() => {
  const BG_MAP = {
    'electronics': 'linear-gradient(145deg,#1a0a2e,#2d1060,#0a0a1f)',
    'fashion':     'linear-gradient(145deg,#0a1a10,#0d3020,#051510)',
    'jewelry':     'linear-gradient(145deg,#1a0a0a,#3d1020,#0f050a)',
    'home-living': 'linear-gradient(145deg,#0a0f1a,#102040,#05080f)',
    'beauty':      'linear-gradient(145deg,#1a100a,#3d2010,#0f0805)',
    'sports':      'linear-gradient(145deg,#0a1a0a,#103010,#050f05)',
  };

  const load = async () => {
    const data = await API.get('/api/categories');
    if (!data.success) return;
    const grid = document.getElementById('categories-grid');
    if (!grid) return;
    grid.innerHTML = data.data.map((cat, i) => `
      <a href="#featured" class="cat-card reveal reveal-delay-${(i % 4) + 1}"
         onclick="Products.filter(null, '${cat.slug}')" style="text-decoration:none">
        <div class="cat-bg" style="background:${BG_MAP[cat.slug] || BG_MAP['sports']}"></div>
        <div class="cat-card-inner">
          <span class="cat-icon" aria-hidden="true">${cat.icon}</span>
          <div class="cat-name">${cat.name}</div>
          <div class="cat-count">${cat.product_count.toLocaleString()}+ items</div>
        </div>
      </a>
    `).join('');
    RevealObserver.observe();
  };

  load();
})();

/* ────────────────────────────────────────────
   TRENDING
──────────────────────────────────────────── */
const TrendingInit = (() => {
  const TRENDING = [
    { name: 'Pro Audio Headphones X1', price: '₹18,999', emoji: '🎧', bg: 'bg-purple', slug: 'pro-audio-headphones-x1' },
    { name: 'Air Max Signature',        price: '₹12,999', emoji: '👟', bg: 'bg-rose',   slug: 'air-max-signature' },
    { name: 'Smart Watch Series 9',     price: '₹32,499', emoji: '⌚', bg: 'bg-teal',   slug: 'smart-watch-series-9' },
    { name: 'UltraBook Pro 15',         price: '₹1,24,999',emoji:'💻', bg: 'bg-blue',  slug: 'ultrabook-pro-15' },
    { name: 'Luxe Perfume Collection',  price: '₹7,499',  emoji: '🌹', bg: 'bg-pink',   slug: 'luxe-perfume-collection' },
    { name: 'Mirrorless Camera Pro',    price: '₹89,999', emoji: '📷', bg: 'bg-gold',   slug: 'mirrorless-camera-pro' },
  ];

  const row = document.getElementById('trending-row');
  if (!row) return;

  row.innerHTML = TRENDING.map(t => `
    <div class="trending-card" role="listitem">
      <div class="trending-img ${t.bg}" aria-hidden="true">
        <span style="font-size:3.5rem;display:block;animation:float 4s ease-in-out infinite">${t.emoji}</span>
      </div>
      <div class="trending-info">
        <div class="trending-name">${t.name}</div>
        <div class="trending-price">${t.price}</div>
      </div>
    </div>
  `).join('');
})();

/* ────────────────────────────────────────────
   NEWSLETTER
──────────────────────────────────────────── */
const Newsletter = (() => {
  const subscribe = async () => {
    const email = document.getElementById('nl-email').value.trim();
    if (!email) { Toast.show('Please enter your email'); return; }
    const data = await API.post('/api/newsletter', { email });
    if (data.success) {
      document.getElementById('nl-email').value = '';
      Toast.show('🎉 Subscribed! Welcome to Drocart.', 4000);
    } else {
      Toast.show('❌ ' + data.error);
    }
  };
  return { subscribe };
})();

/* ────────────────────────────────────────────
   NAVBAR SCROLL EFFECT
──────────────────────────────────────────── */
const NavScroll = (() => {
  const nav = document.getElementById('navbar');
  if (!nav) return;
  window.addEventListener('scroll', () => {
    nav.style.background = window.scrollY > 60
      ? 'rgba(10,10,15,0.92)'
      : 'rgba(10,10,15,0.65)';
  });
})();

/* ────────────────────────────────────────────
   PAYMENT OPTION TOGGLE
──────────────────────────────────────────── */
document.querySelectorAll('.pay-opt input[type="radio"]').forEach(radio => {
  radio.addEventListener('change', () => {
    document.querySelectorAll('.pay-opt').forEach(o => o.classList.remove('active'));
    radio.closest('.pay-opt').classList.add('active');
  });
});

'use strict';
const PageHome = {
  async mount(el) {
    el.innerHTML = `
      <section class="hero">
        <div class="hero-content">
          <div class="hero-tag"><span class="pulse-dot"></span>New Collection 2025</div>
          <h1 class="hero-h1">Shop the<br><em>Future</em><br>Today</h1>
          <p class="hero-sub">Curated products. Lightning delivery. Real-time tracking from warehouse to door.</p>
          <div class="hero-actions"><a href="/products" class="btn-primary">Explore Collection →</a><a href="/products?category=electronics" class="btn-ghost">Electronics ↗</a></div>
          <div class="hero-stats"><div><div class="stat-n">48K+</div><div class="stat-l">Customers</div></div><div><div class="stat-n">12K+</div><div class="stat-l">Products</div></div><div><div class="stat-n">4.9★</div><div class="stat-l">Avg Rating</div></div></div>
        </div>
      </section>
      <div class="marquee-strip"><div class="marquee-track" id="marquee-track"></div></div>
      <section class="section"><div class="section-header reveal"><div class="section-tag">Browse</div><h2 class="section-h2">Shop by Category</h2></div><div class="categories-grid" id="cat-grid">${[...Array(6)].map(()=>`<div class="skeleton-cat"></div>`).join('')}</div></section>
      <section class="section" id="featured">
        <div class="products-header"><div class="section-header reveal" style="margin:0"><div class="section-tag">Curated</div><h2 class="section-h2">Featured Products</h2></div>
          <div class="filter-tabs" id="filter-tabs"><button class="filter-tab active" data-cat="">All</button><button class="filter-tab" data-cat="electronics">Electronics</button><button class="filter-tab" data-cat="fashion">Fashion</button><button class="filter-tab" data-cat="beauty">Beauty</button></div>
        </div>
        <div class="products-grid" id="products-grid">${[...Array(8)].map(()=>`<div class="skeleton-product"></div>`).join('')}</div>
        <div class="load-more-row"><button class="btn-outline" id="load-more-btn" style="display:none">Load More</button></div>
      </section>
      <section class="newsletter-section"><div class="newsletter-inner reveal"><h2 class="nl-h2">Get Exclusive Deals First</h2><p class="nl-sub">Join 48,000+ subscribers for early access.</p><div class="nl-form"><input type="email" id="nl-email" class="input-field nl-input" placeholder="Enter your email"><button class="btn-primary" onclick="PageHome.subscribe()">Subscribe</button></div></div></section>`;
    this._cat=''; this._page=1; this._pages=1;
    this.loadCategories(); this.loadProducts('',1); this.initMarquee(); this.bindFilters();
    Reveal.observe();
  },
  async loadCategories() {
    try { const r = await ProductAPI.categories(); if (!r.success) return;
      const BG=['bg-c1','bg-c2','bg-c3','bg-c4','bg-c5','bg-c6'];
      document.getElementById('cat-grid').innerHTML = r.data.map((c,i)=>`<a href="/products?category=${c.slug}" class="cat-card reveal"><div class="cat-bg ${BG[i%BG.length]}"></div><div class="cat-inner"><span class="cat-icon">${c.icon}</span><div class="cat-name">${c.name}</div><div class="cat-count">${c.product_count}+ items</div></div></a>`).join('');
      Reveal.observe();
    } catch(_) {}
  },
  async loadProducts(cat='', page=1, append=false) {
    try { const r = await ProductAPI.list({featured:1, category:cat, page, limit:8}); if (!r.success) return;
      this._pages = r.data.pages;
      const grid = document.getElementById('products-grid'); const lmb = document.getElementById('load-more-btn');
      if (!append) grid.innerHTML = '';
      if (!r.data.products.length && !append) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--mute)">No products found</div>'; return; }
      grid.insertAdjacentHTML('beforeend', r.data.products.map(p => ProductCard.render(p)).join(''));
      ProductCard.bindAll(grid);
      if (lmb) lmb.style.display = page < this._pages ? 'inline-flex' : 'none';
      Reveal.observe();
    } catch(_) {}
  },
  bindFilters() {
    const tabs = document.getElementById('filter-tabs'); if (!tabs) return;
    tabs.addEventListener('click', e => { const tab = e.target.closest('.filter-tab'); if (!tab) return; tabs.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active')); tab.classList.add('active'); this._cat = tab.dataset.cat; this._page = 1; this.loadProducts(this._cat, 1, false); });
    document.getElementById('load-more-btn')?.addEventListener('click', () => { this._page++; this.loadProducts(this._cat, this._page, true); });
  },
  initMarquee() {
    const t = document.getElementById('marquee-track'); if (!t) return;
    const items = ['Free Shipping Over ₹999','New Drops Weekly','Certified Authentic','30-Day Returns','Real-Time Tracking','Secure Checkout','Live Chat 24/7'];
    t.innerHTML = [...items,...items].map(x => `<span class="marquee-item"><span class="m-dot"></span>${x}</span>`).join('');
  },
  async subscribe() {
    const email = document.getElementById('nl-email')?.value.trim(); if (!email) { Toast.error('Enter your email'); return; }
    try { const r = await API.post('/newsletter',{email}); if (r.success) { Toast.success('🎉 Subscribed!'); document.getElementById('nl-email').value=''; } else Toast.error(r.error); } catch(e) { Toast.error(e.message); }
  },
};

const PageProducts = {
  _page:1, _pages:0, _total:0, _filters:{category:'',sort:'newest',min_price:'',max_price:'',q:''},
  async mount(el, cfg={}) {
    const params = new URLSearchParams(location.search);
    this._filters.category = cfg.category || params.get('category') || '';
    this._filters.q = cfg.search_q || params.get('q') || '';
    this._filters.sort = params.get('sort') || 'newest';
    this._page = 1;
    el.innerHTML = `
      <div class="products-page">
        <aside class="products-sidebar">
          <div class="sidebar-section"><h4>Categories</h4><div id="sidebar-cats"></div></div>
          <div class="sidebar-section"><h4>Price Range</h4><div class="price-range"><input type="number" id="f-min" class="input-field" placeholder="Min ₹"><input type="number" id="f-max" class="input-field" placeholder="Max ₹"></div><button class="btn-outline" style="width:100%;margin-top:.6rem" onclick="PageProducts.applyPrice()">Apply</button></div>
          <div class="sidebar-section"><h4>Sort By</h4><select id="f-sort" class="input-field" onchange="PageProducts.applySort(this.value)"><option value="newest">Newest First</option><option value="popular">Most Popular</option><option value="price_asc">Price: Low → High</option><option value="price_desc">Price: High → Low</option><option value="rating">Top Rated</option></select></div>
        </aside>
        <main class="products-main">
          <div class="products-toolbar"><h2 class="products-title">All Products</h2><span class="products-count" id="prod-count"></span></div>
          ${this._filters.q ? `<div class="search-banner">Results for: <strong>"${this._filters.q}"</strong></div>` : ''}
          <div class="products-grid" id="products-grid">${[...Array(12)].map(()=>`<div class="skeleton-product"></div>`).join('')}</div>
          <div class="pagination" id="pagination"></div>
        </main>
      </div>`;
    this.loadCategories(); this.load();
  },
  async loadCategories() {
    try { const r = await ProductAPI.categories(); if (!r.success) return;
      const el = document.getElementById('sidebar-cats');
      el.innerHTML = `<label class="sidebar-cat ${!this._filters.category?'active':''}"><input type="radio" name="cat" value=""> All</label>` + r.data.map(c=>`<label class="sidebar-cat ${this._filters.category===c.slug?'active':''}"><input type="radio" name="cat" value="${c.slug}" ${this._filters.category===c.slug?'checked':''}> ${c.icon} ${c.name} <span class="cat-cnt">${c.product_count}</span></label>`).join('');
      el.querySelectorAll('input[name=cat]').forEach(radio=>{ radio.addEventListener('change',()=>{ this._filters.category=radio.value; this._page=1; this.load(); el.querySelectorAll('.sidebar-cat').forEach(l=>l.classList.remove('active')); radio.closest('.sidebar-cat').classList.add('active'); }); });
    } catch(_) {}
  },
  async load(append=false) {
    try { const r = await ProductAPI.list({...this._filters, page:this._page, limit:16}); if (!r.success) return;
      this._total=r.data.total; this._pages=r.data.pages;
      const grid = document.getElementById('products-grid'); const count = document.getElementById('prod-count');
      if (count) count.textContent = `${this._total.toLocaleString()} products`;
      if (!append) grid.innerHTML = '';
      if (!r.data.products.length && !append) { grid.innerHTML = '<div class="empty-state"><p>No products found</p></div>'; return; }
      grid.insertAdjacentHTML('beforeend', r.data.products.map(p=>ProductCard.render(p)).join(''));
      ProductCard.bindAll(grid); this.renderPagination(); Reveal.observe();
    } catch(_) {}
  },
  renderPagination() {
    const el = document.getElementById('pagination'); if (!el || this._pages<=1) { if(el) el.innerHTML=''; return; }
    let html = `<button class="pg-btn" ${this._page===1?'disabled':''} onclick="PageProducts.goPage(${this._page-1})">← Prev</button>`;
    for (let i=1;i<=this._pages;i++) { if (i===1||i===this._pages||Math.abs(i-this._page)<=2) html+=`<button class="pg-btn ${i===this._page?'pg-active':''}" onclick="PageProducts.goPage(${i})">${i}</button>`; else if (Math.abs(i-this._page)===3) html+=`<span class="pg-dots">…</span>`; }
    html+=`<button class="pg-btn" ${this._page===this._pages?'disabled':''} onclick="PageProducts.goPage(${this._page+1})">Next →</button>`;
    el.innerHTML=html;
  },
  goPage(p) { this._page=p; this.load(); window.scrollTo({top:0,behavior:'smooth'}); },
  applyPrice() { this._filters.min_price=document.getElementById('f-min').value; this._filters.max_price=document.getElementById('f-max').value; this._page=1; this.load(); },
  applySort(v) { this._filters.sort=v; this._page=1; this.load(); },
};

const PageProduct = {
  _qty:1, _pid:null,
  async mount(el, cfg={}) {
    const slug = cfg.slug || location.pathname.split('/').pop();
    el.innerHTML = '<div class="page-loading">Loading product…</div>';
    try {
      const r = await ProductAPI.detail(slug); if (!r.success) { el.innerHTML='<div class="page-error">Product not found</div>'; return; }
      const p = r.data; this._pid = p.id; this._qty = 1;
      const disc = p.old_price ? Math.round((1-p.price/p.old_price)*100) : 0;
      el.innerHTML = `
        <div class="product-detail">
          <nav class="breadcrumb"><a href="/">Home</a> › <a href="/products?category=${p.category_slug}">${p.category_name}</a> › <span>${p.name}</span></nav>
          <div class="pd-layout">
            <div class="pd-gallery"><div class="pd-main-img">${p.emoji}</div><div class="pd-badge-row">${p.badge?`<span class="product-badge badge-${p.badge}">${p.badge}</span>`:''}${disc?`<span class="badge-discount">-${disc}%</span>`:''}</div></div>
            <div class="pd-info">
              <div class="pd-cat">${p.category_name}</div>
              <h1 class="pd-name">${p.name}</h1>
              <div class="pd-rating-row"><span class="stars">${fmt.stars(p.rating)}</span><span class="pd-rating">${p.rating}</span><span class="pd-reviews">(${Number(p.review_count).toLocaleString()} reviews)</span></div>
              <div class="pd-price-row"><span class="pd-price">${fmt.price(p.price)}</span>${p.old_price?`<span class="pd-old-price">${fmt.price(p.old_price)}</span>`:''}</div>
              <div class="pd-stock ${p.stock>10?'in-stock':p.stock>0?'low-stock':'out-of-stock'}">${p.stock>10?'✓ In Stock':p.stock>0?`⚠ Only ${p.stock} left`:'✕ Out of Stock'}</div>
              <div class="pd-actions"><div class="qty-selector"><button onclick="PageProduct.changeQty(-1)">−</button><span id="pd-qty">1</span><button onclick="PageProduct.changeQty(1)">+</button></div><button class="btn-add-cart" onclick="PageProduct.addCart()">Add to Cart</button><button class="btn-buy-now" onclick="PageProduct.buyNow()">Buy Now</button><button class="btn-wish" id="wish-btn" onclick="PageProduct.toggleWish()">♡</button></div>
              <div class="pd-desc"><h4>About this product</h4><p>${p.description||'No description available.'}</p></div>
            </div>
          </div>
          <div class="pd-section"><h3 class="pd-section-title">Customer Reviews</h3><div class="reviews-list">${p.reviews&&p.reviews.length ? p.reviews.map(rev=>`<div class="review-card"><div class="rev-header"><div class="rev-av">${rev.user_name.charAt(0)}</div><div><div class="rev-name">${rev.user_name}</div><div class="rev-stars">${fmt.stars(rev.rating)}</div></div></div>${rev.title?`<div class="rev-title">${rev.title}</div>`:''}<div class="rev-body">${rev.body||''}</div></div>`).join('') : '<div class="no-reviews">No reviews yet.</div>'}</div></div>
          ${p.related&&p.related.length?`<div class="pd-section"><h3 class="pd-section-title">Related Products</h3><div class="products-grid" id="related-grid"></div></div>`:''}
        </div>`;
      if (p.related && p.related.length) { const rg = document.getElementById('related-grid'); rg.innerHTML = p.related.map(rp=>ProductCard.render(rp)).join(''); ProductCard.bindAll(rg); }
      Reveal.observe();
    } catch(e) { el.innerHTML=`<div class="page-error">${e.message}</div>`; }
  },
  changeQty(d) { this._qty = Math.max(1, this._qty+d); const el = document.getElementById('pd-qty'); if (el) el.textContent = this._qty; },
  async addCart() { if (!Store.get('user')) { sessionStorage.setItem('redir',location.pathname); location.href='/login'; return; } try { const r = await CartAPI.add(this._pid, this._qty); if (r.success) { App.syncCart(); Toast.success('Added to cart! 🛒'); } else Toast.error(r.error); } catch(e) { Toast.error(e.message); } },
  async buyNow() { await this.addCart(); location.href='/cart'; },
  async toggleWish() { if (!Store.get('user')) { location.href='/login'; return; } try { const r = await WishAPI.toggle(this._pid); const btn = document.getElementById('wish-btn'); if (r.success && btn) { const w = r.data.wishlisted; btn.textContent = w ? '♥' : '♡'; btn.style.color = w ? 'var(--rose)' : ''; Toast.info(w ? '♥ Added' : '♡ Removed'); } } catch(e) { Toast.error(e.message); } },
};

const PageCart = {
  async mount(el) { if (!Store.get('user')) { location.href='/login'; return; } await this.load(el); },
  async load(el) {
    el = el || document.getElementById('app-content');
    el.innerHTML = '<div class="page-loading">Loading cart…</div>';
    try {
      const r = await CartAPI.get(); if (!r.success) { el.innerHTML=`<div class="page-error">${r.error}</div>`; return; }
      const {items,subtotal,shipping,total,count} = r.data;
      if (!items.length) { el.innerHTML=`<div class="cart-page"><h1 class="page-title">Shopping Cart</h1><div class="empty-cart"><div class="empty-cart-icon">🛒</div><h3>Your cart is empty</h3><a href="/products" class="btn-primary">Start Shopping →</a></div></div>`; return; }
      el.innerHTML=`
        <div class="cart-page">
          <h1 class="page-title">Shopping Cart <span class="cart-count-badge">${count} items</span></h1>
          <div class="cart-layout">
            <div class="cart-items-col">
              ${items.map(i=>`<div class="cart-item"><div class="ci-img">${i.emoji}</div><div class="ci-info"><a href="/product/${i.slug}" class="ci-name">${i.name}</a><div class="ci-price">${fmt.price(i.price)}</div><div class="ci-controls"><div class="qty-ctrl"><button onclick="PageCart.updateQty(${i.id},${i.qty-1})">−</button><span>${i.qty}</span><button onclick="PageCart.updateQty(${i.id},${i.qty+1})">+</button></div><span class="ci-subtotal">${fmt.price(parseFloat(i.price)*i.qty)}</span><button class="ci-remove" onclick="PageCart.remove(${i.id})">🗑 Remove</button></div></div></div>`).join('')}
              <div class="cart-actions-bar"><button class="btn-outline" onclick="PageCart.clear()">Clear Cart</button><a href="/products" class="btn-ghost">← Continue Shopping</a></div>
            </div>
            <div class="cart-summary-card"><h3>Order Summary</h3><div class="coupon-row"><input type="text" id="coupon-input" class="input-field" placeholder="Coupon code" style="flex:1"><button class="btn-outline" onclick="PageCart.applyCoupon()">Apply</button></div><div id="coupon-msg"></div><div class="summary-row"><span>Subtotal</span><span>${fmt.price(subtotal)}</span></div><div class="summary-row"><span>Shipping</span><span>${shipping===0?'Free':fmt.price(shipping)}</span></div><div class="summary-row summary-total"><span>Total</span><span id="cart-total">${fmt.price(total)}</span></div><a href="/checkout" class="btn-primary full-w" style="margin-top:1rem">Proceed to Checkout →</a></div>
          </div>
        </div>`;
      this._subtotal=subtotal; this._total=total; this._shipping=shipping; this._discount=0;
    } catch(e) { el.innerHTML=`<div class="page-error">${e.message}</div>`; }
  },
  async updateQty(id,qty) { try { await CartAPI.update(id,qty); App.syncCart(); await this.load(); } catch(e) { Toast.error(e.message); } },
  async remove(id) { try { await CartAPI.remove(id); App.syncCart(); Toast.info('Item removed'); await this.load(); } catch(e) { Toast.error(e.message); } },
  async clear() { if (!confirm('Clear all items?')) return; try { await CartAPI.clear(); App.syncCart(); await this.load(); } catch(e) { Toast.error(e.message); } },
  async applyCoupon() { const code = document.getElementById('coupon-input')?.value.trim().toUpperCase(); if (!code) return; try { const r = await PaymentAPI.coupon({code, subtotal:this._subtotal}); const msg = document.getElementById('coupon-msg'); if (r.success) { this._discount = r.data.discount; document.getElementById('cart-total').textContent = fmt.price(Math.max(0,this._total-this._discount)); if (msg) msg.innerHTML = `<span class="coupon-success">✓ ${r.message}</span>`; } else if (msg) msg.innerHTML = `<span class="coupon-error">✕ ${r.error}</span>`; } catch(e) { Toast.error(e.message); } },
};

const PageCheckout = {
  _cart:null, _discount:0, _coupon:'',
  async mount(el) {
    if (!Store.get('user')) { location.href='/login'; return; }
    try { const r = await CartAPI.get(); if (!r.success || !r.data.items.length) { location.href='/cart'; return; } this._cart = r.data; } catch(e) { location.href='/cart'; return; }
    const {items,subtotal,shipping,total} = this._cart;
    el.innerHTML=`
      <div class="checkout-page"><h1 class="page-title">Checkout</h1>
        <div class="checkout-layout">
          <div class="checkout-form-col">
            <div class="checkout-card"><h3 class="cc-title">📍 Delivery Address</h3><div class="form-row"><div class="form-group"><label>Full Name *</label><input type="text" id="ch-name" class="input-field" value="${Store.get('user')?.name||''}"></div><div class="form-group"><label>Phone *</label><input type="text" id="ch-phone" class="input-field"></div></div><div class="form-group"><label>Address Line 1 *</label><input type="text" id="ch-line1" class="input-field"></div><div class="form-group"><label>Address Line 2</label><input type="text" id="ch-line2" class="input-field"></div><div class="form-row"><div class="form-group"><label>City *</label><input type="text" id="ch-city" class="input-field"></div><div class="form-group"><label>State *</label><input type="text" id="ch-state" class="input-field"></div><div class="form-group"><label>Pincode *</label><input type="text" id="ch-pin" class="input-field" maxlength="6"></div></div></div>
            <div class="checkout-card"><h3 class="cc-title">💳 Payment Method</h3><div class="payment-grid"><label class="pay-option active"><input type="radio" name="pm" value="cod" checked><span class="po-icon">💵</span><span class="po-label">Cash on Delivery</span></label><label class="pay-option"><input type="radio" name="pm" value="upi"><span class="po-icon">📱</span><span class="po-label">UPI</span></label><label class="pay-option"><input type="radio" name="pm" value="card"><span class="po-icon">💳</span><span class="po-label">Card</span></label><label class="pay-option"><input type="radio" name="pm" value="netbanking"><span class="po-icon">🏦</span><span class="po-label">Net Banking</span></label></div></div>
            <div class="checkout-card"><h3 class="cc-title">🎟 Coupon Code</h3><div class="coupon-row"><input type="text" id="ch-coupon" class="input-field"><button class="btn-outline" onclick="PageCheckout.applyCoupon()">Apply</button></div><div id="ch-coupon-msg"></div></div>
          </div>
          <div class="checkout-summary-col"><div class="checkout-summary-card"><h3>Order Summary</h3><div class="co-items">${items.map(i=>`<div class="co-item"><span class="co-emoji">${i.emoji}</span><span class="co-name">${i.name}</span><span class="co-qty">×${i.qty}</span><span class="co-price">${fmt.price(parseFloat(i.price)*i.qty)}</span></div>`).join('')}</div><div class="co-divider"></div><div class="summary-row"><span>Subtotal</span><span>${fmt.price(subtotal)}</span></div><div class="summary-row"><span>Shipping</span><span>${shipping===0?'Free':fmt.price(shipping)}</span></div><div class="summary-row" id="co-disc-row" style="display:none;color:var(--green)"><span>Discount</span><span id="co-disc-amt"></span></div><div class="summary-row summary-total"><span>Total</span><span id="co-total">${fmt.price(total)}</span></div><button class="btn-primary full-w" style="margin-top:1.4rem" id="btn-place" onclick="PageCheckout.placeOrder()">Place Order →</button></div></div>
        </div>
      </div>`;
    document.querySelectorAll('input[name=pm]').forEach(r=>{ r.addEventListener('change',()=>{ document.querySelectorAll('.pay-option').forEach(o=>o.classList.remove('active')); r.closest('.pay-option').classList.add('active'); }); });
  },
  async applyCoupon() { const code = document.getElementById('ch-coupon')?.value.trim().toUpperCase(); if (!code) return; try { const r = await PaymentAPI.coupon({code, subtotal:this._cart.subtotal}); const msg = document.getElementById('ch-coupon-msg'); if (r.success) { this._discount=r.data.discount; this._coupon=code; document.getElementById('co-total').textContent = fmt.price(Math.max(0,this._cart.total-this._discount)); document.getElementById('co-disc-row').style.display='flex'; document.getElementById('co-disc-amt').textContent=`-${fmt.price(this._discount)}`; if (msg) msg.innerHTML=`<span class="coupon-success">✓ ${r.message}</span>`; } else if (msg) msg.innerHTML=`<span class="coupon-error">✕ ${r.error}</span>`; } catch(e) { Toast.error(e.message); } },
  async placeOrder() {
    const addr = { full_name: document.getElementById('ch-name')?.value.trim(), line1: document.getElementById('ch-line1')?.value.trim(), line2: document.getElementById('ch-line2')?.value.trim(), city: document.getElementById('ch-city')?.value.trim(), state: document.getElementById('ch-state')?.value.trim(), pincode: document.getElementById('ch-pin')?.value.trim(), phone: document.getElementById('ch-phone')?.value.trim() };
    if (!addr.full_name||!addr.line1||!addr.city||!addr.state||!addr.pincode||!addr.phone) { Toast.error('Please fill all required fields'); return; }
    const pm = document.querySelector('input[name=pm]:checked')?.value || 'cod';
    const btn = document.getElementById('btn-place'); if (btn) { btn.disabled=true; btn.textContent='Placing…'; }
    try { const r = await OrderAPI.place({address:addr, payment_method:pm, coupon_code:this._coupon}); if (r.success) { App.syncCart(); if (pm !== 'cod') location.href = `/payment?order=${r.data.order_id}&total=${r.data.total}&method=${pm}`; else { Toast.success(`🎉 Order #${r.data.order_number} placed!`); location.href = `/order/${r.data.order_id}`; } } else { Toast.error(r.error); if (btn) { btn.disabled=false; btn.textContent='Place Order →'; } } } catch(e) { Toast.error(e.message); if(btn){btn.disabled=false;btn.textContent='Place Order →';} }
  },
};

const PagePayment = {
  async mount(el, cfg={}) {
    const params = new URLSearchParams(location.search);
    const oid = cfg.order_id || params.get('order'); const total = params.get('total'); const method = params.get('method') || 'upi';
    const icons = {upi:'📱',card:'💳',netbanking:'🏦'};
    el.innerHTML=`<div class="payment-page"><div class="payment-card">
      <div class="payment-header"><div class="payment-icon">${icons[method]||'💳'}</div><h2>Complete Payment</h2><div class="payment-amount">${total?fmt.price(total):''}</div></div>
      ${method==='upi'?`<div class="upi-section"><div class="upi-qr"><div class="qr-placeholder" id="upi-qr"></div></div><div class="upi-divider"><span>or pay with UPI ID</span></div><div class="upi-id-row"><input type="text" id="upi-id" class="input-field" placeholder="yourname@upi" style="flex:1"><button class="btn-primary" onclick="PagePayment.pay('${oid}','${total}','upi')">Pay</button></div></div>`:method==='card'?`<div class="card-form"><div class="form-group"><label>Card Number</label><input type="text" id="card-num" class="input-field" placeholder="1234 5678 9012 3456" maxlength="19"></div><div class="form-row"><div class="form-group"><label>Expiry</label><input type="text" class="input-field" placeholder="MM/YY"></div><div class="form-group"><label>CVV</label><input type="password" class="input-field" maxlength="3"></div></div><button class="btn-primary full-w" onclick="PagePayment.pay('${oid}','${total}','card')">Pay ${total?fmt.price(total):''}</button></div>`:`<div class="nb-banks">${['SBI','HDFC','ICICI','Axis','Kotak','Yes Bank'].map(b=>`<button class="nb-btn" onclick="PagePayment.pay('${oid}','${total}','${b}')">${b}</button>`).join('')}</div>`}
      <div class="payment-footer"><p class="payment-secure">🔒 256-bit SSL secured</p><p class="payment-note">Order ID: #${oid||''}</p></div>
    </div></div>`;
    if (method==='upi') this.genQR();
  },
  genQR() { const qr = document.getElementById('upi-qr'); if (!qr) return; qr.style.cssText='display:grid;grid-template-columns:repeat(10,8px);gap:1px;width:fit-content'; for (let i=0;i<100;i++){const c=document.createElement('div');c.style.cssText=`width:8px;height:8px;background:${Math.random()>.35?'#0a0a0f':'#fff'}`;qr.appendChild(c);} },
  async pay(oid, total, method) {
    const btn = document.querySelector('.payment-card .btn-primary'); if (btn) { btn.disabled=true; btn.textContent='Processing…'; }
    try { const initR = await PaymentAPI.initiate({amount:total,method,order_id:oid}); if (!initR.success) { Toast.error('Payment initiation failed'); return; } await new Promise(r=>setTimeout(r,2000)); const confR = await PaymentAPI.confirm({payment_ref:initR.data.payment_ref,order_id:oid}); if (confR.success) { Toast.success('Payment successful! ✅'); location.href=`/order/${oid}`; } else Toast.error('Payment failed.'); } catch(e) { Toast.error(e.message); } finally { if (btn) { btn.disabled=false; btn.textContent='Pay'; } }
  },
};

const PageOrders = {
  async mount(el) {
    if (!Store.get('user')) { location.href='/login'; return; }
    el.innerHTML = '<div class="page-loading">Loading orders…</div>';
    try { const r = await OrderAPI.list(); if (!r.success) { el.innerHTML=`<div class="page-error">${r.error}</div>`; return; } const orders = r.data;
      el.innerHTML=`<div class="orders-page"><h1 class="page-title">My Orders</h1>${!orders.length?`<div class="empty-orders"><div style="font-size:3.5rem;margin-bottom:1rem">📦</div><h3>No orders yet</h3><a href="/products" class="btn-primary">Shop Now →</a></div>`:`<div class="orders-list">${orders.map(o=>`<div class="order-card" onclick="location.href='/order/${o.id}'"><div class="oc-header"><div class="oc-num">Order #${o.order_number}</div><span class="status-badge ${statusColor[o.status]||'status-gray'}">${fmt.status(o.status)}</span></div><div class="oc-meta"><span>📅 ${fmt.date(o.created_at)}</span><span>📦 ${o.item_count} item(s)</span><span>💰 ${fmt.price(o.total)}</span></div><div class="oc-actions"><button class="btn-outline btn-sm" onclick="event.stopPropagation();location.href='/track/${o.order_number}'">🗺 Track</button>${o.status==='pending'||o.status==='confirmed'?`<button class="btn-danger-outline btn-sm" onclick="event.stopPropagation();PageOrders.cancel(${o.id})">Cancel</button>`:''}</div></div>`).join('')}</div>`}</div>`;
    } catch(e) { el.innerHTML=`<div class="page-error">${e.message}</div>`; }
  },
  async cancel(id) { const reason = prompt('Reason for cancellation:'); if (!reason) return; try { const r = await OrderAPI.cancel(id,reason); if (r.success) { Toast.success('Order cancelled'); this.mount(document.getElementById('app-content')); } else Toast.error(r.error); } catch(e) { Toast.error(e.message); } },
};

const PageOrder = {
  async mount(el, cfg={}) {
    if (!Store.get('user')) { location.href='/login'; return; }
    const oid = cfg.order_id || location.pathname.split('/').pop();
    el.innerHTML='<div class="page-loading">Loading order…</div>';
    try { const r = await OrderAPI.detail(oid); if (!r.success) { el.innerHTML=`<div class="page-error">${r.error}</div>`; return; } const o = r.data;
      el.innerHTML=`<div class="order-detail-page">
        <div class="od-header"><div><h1 class="page-title">Order #${o.order_number}</h1><div class="od-date">Placed ${fmt.date(o.created_at)}</div></div><span class="status-badge status-lg ${statusColor[o.status]||'status-gray'}">${fmt.status(o.status)}</span></div>
        <div class="od-layout">
          <div class="od-main"><div class="od-card"><h3>Items Ordered</h3>${o.items.map(i=>`<div class="od-item"><div class="odi-img">${i.emoji}</div><div class="odi-info"><div class="odi-name">${i.name}</div><div class="odi-qty">Qty: ${i.qty} × ${fmt.price(i.price)}</div></div><div class="odi-total">${fmt.price(i.subtotal)}</div></div>`).join('')}</div><div class="od-card"><h3>Order Timeline</h3><div class="order-timeline">${(o.history||[]).map((h,idx,arr)=>`<div class="ot-step ${idx===arr.length-1?'ot-current':'ot-done'}"><div class="ot-dot"></div><div class="ot-info"><div class="ot-status">${fmt.status(h.status)}</div><div class="ot-note">${h.note||''}</div><div class="ot-time">${fmt.date(h.created_at)} ${fmt.time(h.created_at)}</div></div></div>`).join('')}</div></div></div>
          <div class="od-side"><div class="od-card"><h3>Payment Summary</h3><div class="summary-row"><span>Subtotal</span><span>${fmt.price(o.subtotal)}</span></div>${o.discount>0?`<div class="summary-row"><span>Discount</span><span>−${fmt.price(o.discount)}</span></div>`:''}<div class="summary-row"><span>Shipping</span><span>${o.shipping_fee==0?'Free':fmt.price(o.shipping_fee)}</span></div><div class="summary-row summary-total"><span>Total</span><span>${fmt.price(o.total)}</span></div><div class="pay-method-badge">${o.payment_method.toUpperCase()} — <span class="status-badge ${o.payment_status==='paid'?'status-green':'status-yellow'}">${o.payment_status}</span></div></div><a href="/track/${o.order_number}" class="od-track-btn">🗺 Live Tracking →</a>${o.status==='pending'||o.status==='confirmed'?`<button class="btn-danger-outline full-w" onclick="PageOrders.cancel(${o.id})">Cancel Order</button>`:''}</div>
        </div>
      </div>`;
    } catch(e) { el.innerHTML=`<div class="page-error">${e.message}</div>`; }
  },
};

const PageTracking = {
  async mount(el, cfg={}) {
    const num = cfg.order_number || location.pathname.split('/').pop();
    el.innerHTML='<div class="page-loading">Loading tracking…</div>';
    try { const r = await OrderAPI.track(num); if (!r.success) { el.innerHTML='<div class="page-error">Order not found</div>'; return; } const o = r.data;
      const reached = (o.checkpoints||[]).filter(c=>c.is_reached).length; const total = (o.checkpoints||[]).length; const pct = total ? Math.round(reached/total*100) : 0;
      const current = (o.checkpoints||[]).find(c=>c.is_current);
      el.innerHTML=`<div class="tracking-page">
        <div class="tracking-header"><div><h1 class="page-title">Live Tracking</h1><div class="tracking-num">Order #${o.order_number} · ${o.tracking_number||'—'}</div></div><span class="status-badge status-lg ${statusColor[o.status]||'status-gray'}">${fmt.status(o.status)}</span></div>
        <div class="track-progress-wrap"><div class="track-progress-bar"><div class="track-progress-fill" style="width:${pct}%"></div></div><div class="track-progress-label">${pct}% complete — ${current?.title||'Processing'}</div></div>
        <div class="tracking-layout">
          <div class="track-card"><h3>Shipment Journey</h3><div class="track-timeline">${(o.checkpoints||[]).map(cp=>`<div class="track-step ${cp.is_current?'track-current':cp.is_reached?'track-done':'track-pending'}"><div class="ts-dot">${cp.is_reached?'✓':cp.is_current?'●':'○'}</div><div class="ts-info"><div class="ts-title">${cp.title}</div><div class="ts-desc">${cp.description||''}</div><div class="ts-loc">📍 ${cp.location||''}, ${cp.city||''}</div></div></div>`).join('')}</div></div>
          <div>${o.agent?`<div class="track-card"><h3>Delivery Agent</h3><div class="agent-info"><div class="agent-avatar">${o.agent.agent_name?.charAt(0)||'A'}</div><div><div class="agent-name">${o.agent.agent_name}</div><div class="agent-rating">★ ${o.agent.agent_rating}</div></div><a href="tel:${o.agent.agent_phone}" class="agent-call-btn">📞</a></div></div>`:''}<div class="track-card"><h3>Items</h3>${(o.items||[]).map(i=>`<div class="track-item"><span>${i.emoji}</span><span>${i.name}</span><span>×${i.qty}</span></div>`).join('')}</div></div>
        </div>
      </div>`;
    } catch(e) { el.innerHTML=`<div class="page-error">${e.message}</div>`; }
  },
};

const PageAccount = {
  _profile: null,
  async mount(el) {
    if (!Store.get('user')) { location.href='/login'; return; }
    el.innerHTML=`<div class="account-page">
      <div class="account-sidebar"><div class="account-user-card"><div class="au-avatar">👤</div><div class="au-name" id="au-name">…</div><div class="au-email" id="au-email"></div></div>
        <nav class="account-nav"><button class="an-link active" onclick="PageAccount.tab('profile',this)">👤 Profile</button><button class="an-link" onclick="PageAccount.tab('addresses',this)">📍 Addresses</button><button class="an-link" onclick="PageAccount.tab('orders',this)">📦 Orders</button><button class="an-link" onclick="PageAccount.tab('security',this)">🔐 Security</button><button class="an-link an-logout" onclick="PageAccount.logout()">← Logout</button></nav>
      </div>
      <div class="account-content" id="acc-content"><div class="page-loading">Loading…</div></div>
    </div>`;
    await this.loadProfile(); this.tab('profile');
  },
  async loadProfile() { try { const r = await ProfileAPI.get(); if (!r.success) return; this._profile = r.data; document.getElementById('au-name').textContent = r.data.name; document.getElementById('au-email').textContent = r.data.email; } catch(_) {} },
  tab(name, btn) { document.querySelectorAll('.an-link').forEach(b=>b.classList.remove('active')); if (btn) btn.classList.add('active'); const c = document.getElementById('acc-content'); if (!c) return; const map = { profile: ()=>this.renderProfile(c), addresses: ()=>this.renderAddresses(c), orders: ()=>PageOrders.mount(c), security: ()=>this.renderSecurity(c) }; if (map[name]) map[name](); },
  renderProfile(c) { const u = this._profile || {}; c.innerHTML=`<div class="tab-content"><h2 class="tab-title">My Profile</h2><div class="form-group"><label>Full Name</label><input type="text" id="p-name" class="input-field" value="${u.name||''}"></div><div class="form-group"><label>Email</label><input type="email" class="input-field" value="${u.email||''}" disabled></div><div class="form-group"><label>Phone</label><input type="text" id="p-phone" class="input-field" value="${u.phone||''}"></div><button class="btn-primary" onclick="PageAccount.saveProfile()">Save Changes</button></div>`; },
  async saveProfile() { try { const r = await ProfileAPI.update({name:document.getElementById('p-name')?.value.trim(), phone:document.getElementById('p-phone')?.value.trim()}); if (r.success) { Toast.success('Profile updated!'); await this.loadProfile(); } else Toast.error(r.error); } catch(e) { Toast.error(e.message); } },
  async renderAddresses(c) { try { const r = await ProfileAPI.get(); c.innerHTML=`<div class="tab-content"><div style="display:flex;justify-content:space-between;margin-bottom:1.4rem"><h2 class="tab-title" style="margin:0">My Addresses</h2><button class="btn-primary" onclick="PageAccount.showAddAddress()">+ Add New</button></div>${(r.data?.addresses||[]).length ? r.data.addresses.map(a=>`<div class="address-card"><div class="ac-label">${a.label||'Home'}</div><div class="ac-name">${a.full_name}</div><div class="ac-addr">${a.line1}, ${a.city}, ${a.state} — ${a.pincode}</div><button class="btn-danger-outline btn-sm" onclick="PageAccount.deleteAddr(${a.id})">Delete</button></div>`).join('') : '<div class="empty-state"><p>No addresses saved.</p></div>'}</div>`; } catch(_) {} },
  showAddAddress() { Modal.show(`<div class="form-row"><div class="form-group"><label>Label</label><select id="a-label" class="input-field"><option>Home</option><option>Work</option></select></div><div class="form-group"><label>Full Name</label><input type="text" id="a-name" class="input-field"></div></div><div class="form-group"><label>Line 1 *</label><input type="text" id="a-l1" class="input-field"></div><div class="form-row"><div class="form-group"><label>City *</label><input type="text" id="a-city" class="input-field"></div><div class="form-group"><label>State *</label><input type="text" id="a-state" class="input-field"></div><div class="form-group"><label>Pincode *</label><input type="text" id="a-pin" class="input-field" maxlength="6"></div></div><div class="form-group"><label>Phone</label><input type="text" id="a-phone" class="input-field"></div><button class="btn-primary full-w" onclick="PageAccount.saveAddr()">Save Address</button>`, {title:'Add Address'}); },
  async saveAddr() { const d={label:document.getElementById('a-label')?.value,full_name:document.getElementById('a-name')?.value,line1:document.getElementById('a-l1')?.value,city:document.getElementById('a-city')?.value,state:document.getElementById('a-state')?.value,pincode:document.getElementById('a-pin')?.value,phone:document.getElementById('a-phone')?.value}; try { const r=await ProfileAPI.addAddress(d); if(r.success){Modal.close();Toast.success('Address saved!');this.renderAddresses(document.getElementById('acc-content'));} else Toast.error(r.error); } catch(e){Toast.error(e.message);} },
  async deleteAddr(id) { if(!confirm('Delete?'))return; try{await ProfileAPI.deleteAddress(id);Toast.info('Deleted');this.renderAddresses(document.getElementById('acc-content'));}catch(e){Toast.error(e.message);} },
  renderSecurity(c) { c.innerHTML=`<div class="tab-content"><h2 class="tab-title">Security</h2><div class="security-card"><div class="sc-header"><div class="sc-icon">🔐</div><div><h4>Google Authenticator</h4><p>Add a second factor.</p></div><button class="btn-primary btn-sm" onclick="PageAccount.setupTOTP()">Set Up</button></div></div><div class="security-card"><div class="sc-header"><div class="sc-icon">📱</div><div><h4>OTP Login</h4><p>Email one-time codes.</p></div><span class="status-badge status-green">Enabled</span></div></div></div>`; },
  async setupTOTP() { try { const r = await AuthAPI.totpSetup(); if (!r.success){Toast.error('Could not load');return;} Modal.show(`<div style="text-align:center;margin:1rem 0"><img src="${r.data.qr_code}" style="width:170px;border-radius:8px"><div style="font-size:.78rem;color:var(--mute);margin-top:.5rem">Key: <code>${r.data.secret}</code></div></div><div class="form-group"><label>Enter 6-digit code</label><div id="setup-totp-mount"></div></div>`,{title:'Google Authenticator'}); OTPModule.build({containerId:'setup-totp-mount', digits:6, target:'authenticator app', kind:'2fa', onSuccess: async (code) => { try { const vr = await AuthAPI.totpEnable({code}); if (vr.success) { Modal.close(); Toast.success('2FA enabled! 🔐'); } else OTPModule.showError(vr.error); } catch(e) { OTPModule.showError(e.message); } }}); } catch(e){Toast.error(e.message);} },
  async logout() { try{await AuthAPI.logout();}catch(_){} Store.set('user',null); App.updateNav(null); Toast.info('Logged out'); location.href='/'; },
};

const PageChat = {
  _session: null, _socket: null,
  async mount(el) {
    if (!Store.get('user')) { location.href='/login'; return; }
    el.innerHTML=`<div class="chat-page"><div class="chat-sidebar"><div class="chat-sidebar-header"><h3>Support Chats</h3><button class="btn-primary btn-sm" onclick="PageChat.newChat()">+ New</button></div><div class="chat-sessions-list" id="chat-sl"><div class="page-loading">Loading…</div></div></div><div class="chat-main" id="chat-main"><div class="chat-empty-state"><div class="ce-icon">💬</div><h3>Drocart Support</h3><p>Start a new chat</p><button class="btn-primary" onclick="PageChat.newChat()">Start Chat →</button></div></div></div>`;
    this.loadSessions(); this.connectSocket();
  },
  async loadSessions() { try { const r = await ChatAPI.sessions(); const el = document.getElementById('chat-sl'); if (!el) return; if (!r.success||!r.data.length) { el.innerHTML='<div style="padding:1.5rem;text-align:center;color:var(--mute)">No chats yet</div>'; return; } el.innerHTML = r.data.map(s=>`<div class="csl-item" onclick="PageChat.openSession(${s.id},'${s.subject||'Support'}')"><div class="csl-icon">💬</div><div class="csl-info"><div class="csl-subject">${s.subject||'General'}</div><div class="csl-last">${s.last_message||'…'}</div></div>${s.unread>0?`<span class="csl-badge">${s.unread}</span>`:''}</div>`).join(''); } catch(_) {} },
  connectSocket() { if (typeof io==='undefined') return; this._socket = io({transports:['websocket']}); this._socket.on('new_message', msg => { if (this._session && msg.session_id===this._session.id) { this.appendMsg(msg); this.scrollBottom(); } this.loadSessions(); }); },
  async newChat() { Modal.show(`<div class="form-group"><label>What do you need help with?</label><input type="text" id="chat-sub" class="input-field" placeholder="Type your question…"></div><button class="btn-primary full-w" onclick="PageChat.createChat()">Start Chat →</button>`,{title:'Start a Chat'}); },
  async createChat() { const subject = document.getElementById('chat-sub')?.value.trim() || 'General Enquiry'; try { const r = await ChatAPI.createSession({subject}); if (r.success){ Modal.close(); await this.loadSessions(); this.openSession(r.data.session_id, subject); } } catch(e){ Toast.error(e.message); } },
  async openSession(sid, subject) { this._session = {id:sid, subject}; if (this._socket) this._socket.emit('join_chat',{session_id:sid}); const main = document.getElementById('chat-main'); if (!main) return; main.innerHTML=`<div class="chat-window"><div class="chat-win-header"><div class="cwh-info"><div class="cwh-icon">🤖</div><div><div class="cwh-name">Drocart Support</div></div></div></div><div class="chat-messages" id="chat-msgs"><div class="page-loading">Loading…</div></div><div class="chat-input-bar"><div class="chat-input-row"><input type="text" id="chat-input" class="chat-input" placeholder="Type your message…" onkeydown="if(event.key==='Enter')PageChat.sendMsg(${sid})"><button class="chat-send-btn" onclick="PageChat.sendMsg(${sid})">➤</button></div></div></div>`; this.loadMsgs(sid); },
  async loadMsgs(sid) { try { const r = await ChatAPI.messages(sid); const el = document.getElementById('chat-msgs'); if (!el||!r.success) return; el.innerHTML = r.data.map(m=>this.renderMsg(m)).join(''); this.scrollBottom(); } catch(_) {} },
  renderMsg(m) { const uid = Store.get('user')?.id; const isUser = m.sender_id && m.sender_id===uid; const isBot = m.type==='bot'||m.type==='system'||!m.sender_id; const body = (m.body||'').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\[(.+?)\]\((.+?)\)/g,`<a href="$2">$1</a>`).replace(/\n/g,'<br>'); return `<div class="chat-msg ${isUser?'msg-user':isBot?'msg-bot':'msg-agent'}">${!isUser?`<div class="msg-av">${isBot?'🤖':'👤'}</div>`:''}<div class="msg-bubble"><div class="msg-body">${body}</div></div></div>`; },
  appendMsg(m) { document.getElementById('chat-msgs')?.insertAdjacentHTML('beforeend', this.renderMsg(m)); },
  scrollBottom() { const el = document.getElementById('chat-msgs'); if (el) el.scrollTop = el.scrollHeight; },
  async sendMsg(sid) { const input = document.getElementById('chat-input'); const body = input?.value.trim(); if (!body) return; input.value = ''; try { const r = await ChatAPI.send(sid, body); if (r.success) { this.appendMsg(r.data); this.scrollBottom(); } } catch(e) { Toast.error(e.message); } },
};

const PageWishlist = {
  async mount(el) {
    if (!Store.get('user')) { location.href='/login'; return; }
    el.innerHTML='<div class="page-loading">Loading wishlist…</div>';
    try { const r = await WishAPI.get();
      el.innerHTML=`<div class="wishlist-page"><h1 class="page-title">My Wishlist</h1>${!r.data?.length?`<div class="empty-wishlist"><div style="font-size:3.5rem;margin-bottom:1rem">♡</div><h3>Your wishlist is empty</h3><a href="/products" class="btn-primary">Explore →</a></div>`:`<div class="products-grid" id="wish-grid"></div>`}</div>`;
      if (r.data?.length) { const wg = document.getElementById('wish-grid'); wg.innerHTML = r.data.map(p=>ProductCard.render(p)).join(''); ProductCard.bindAll(wg); }
    } catch(e) { el.innerHTML=`<div class="page-error">${e.message}</div>`; }
  },
};

const PageAdmin = {
  async mount(el) {
    const user = Store.get('user'); if (!user||!['admin','support'].includes(user.role)){ location.href='/'; return; }
    el.innerHTML=`<div class="admin-shell"><aside class="admin-sidebar"><div class="admin-logo">Drocart Admin</div><nav class="admin-nav"><button class="adm-link active" onclick="PageAdmin.tab('dashboard',this)">📊 Dashboard</button><button class="adm-link" onclick="PageAdmin.tab('orders',this)">📦 Orders</button><button class="adm-link" onclick="PageAdmin.tab('products',this)">🛍 Products</button><a href="/" class="adm-link">← Back to Store</a></nav></aside><main class="admin-main" id="admin-main"><div class="page-loading">Loading…</div></main></div>`;
    this.tab('dashboard');
  },
  tab(name, btn) { document.querySelectorAll('.adm-link').forEach(b=>b.classList.remove('active')); if (btn) btn.classList.add('active'); const main = document.getElementById('admin-main'); if (!main) return; const tabs = { dashboard: ()=>this.dashboard(main), orders: ()=>this.orders(main), products: ()=>this.products(main) }; if (tabs[name]) tabs[name](); },
  async dashboard(el) { el.innerHTML='<div class="page-loading">Loading stats…</div>'; try { const r = await AdminAPI.stats(); if (!r.success){ el.innerHTML='<div class="page-error">Admin access required</div>'; return; } const s=r.data;
    el.innerHTML=`<div class="admin-content"><h1 class="admin-page-title">Dashboard</h1><div class="stats-grid"><div class="stat-card"><div class="sc-icon">👥</div><div class="sc-val">${s.users.toLocaleString()}</div><div class="sc-label">Customers</div></div><div class="stat-card"><div class="sc-icon">📦</div><div class="sc-val">${s.orders.toLocaleString()}</div><div class="sc-label">Orders</div></div><div class="stat-card sc-gold"><div class="sc-icon">💰</div><div class="sc-val">₹${Number(s.revenue).toLocaleString()}</div><div class="sc-label">Revenue</div></div></div><div class="admin-card"><div class="admin-card-header"><h3>Recent Orders</h3></div><table class="admin-table"><thead><tr><th>Order #</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead><tbody>${(s.recent_orders||[]).map(o=>`<tr><td><strong>${o.order_number}</strong></td><td>${o.customer}</td><td style="color:var(--gold)">${fmt.price(o.total)}</td><td><span class="status-badge ${statusColor[o.status]||'status-gray'}">${fmt.status(o.status)}</span></td></tr>`).join('')}</tbody></table></div></div>`;
  } catch(e){ el.innerHTML=`<div class="page-error">${e.message}</div>`; } },
  async orders(el) { el.innerHTML='<div class="page-loading">Loading orders…</div>'; try { const r = await AdminAPI.orders();
    el.innerHTML=`<div class="admin-content"><h1 class="admin-page-title">All Orders</h1><div class="admin-card"><table class="admin-table"><thead><tr><th>Order #</th><th>Customer</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead><tbody>${(r.data||[]).map(o=>`<tr><td><strong>${o.order_number}</strong></td><td>${o.customer}</td><td style="color:var(--gold)">${fmt.price(o.total)}</td><td><select class="status-select" onchange="PageAdmin.updateOrder(${o.id},this.value)">${['pending','confirmed','processing','packed','shipped','out_for_delivery','delivered','cancelled'].map(s=>`<option value="${s}" ${s===o.status?'selected':''}>${fmt.status(s)}</option>`).join('')}</select></td><td><button class="btn-action" onclick="PageAdmin.advance(${o.id})">▶ Advance</button></td></tr>`).join('')}</tbody></table></div></div>`;
  } catch(e){ el.innerHTML=`<div class="page-error">${e.message}</div>`; } },
  async updateOrder(id, status) { try{ const r=await AdminAPI.updateOrder(id,{status}); if(r.success) Toast.success('Updated'); else Toast.error(r.error); }catch(e){ Toast.error(e.message); } },
  async advance(id) { const note = prompt('Note (optional):') || ''; try{ const r=await AdminAPI.advanceTrack(id,{note,location:'Drocart Hub'}); if(r.success) Toast.success(`Advanced: ${r.data.title}`); else Toast.error(r.error); }catch(e){ Toast.error(e.message); } },
  async products(el) { el.innerHTML='<div class="page-loading">Loading products…</div>'; try { const pr = await ProductAPI.list({limit:50});
    el.innerHTML=`<div class="admin-content"><h1 class="admin-page-title">Products</h1><div class="admin-card"><table class="admin-table"><thead><tr><th></th><th>Name</th><th>Price</th><th>Stock</th><th>Actions</th></tr></thead><tbody>${(pr.data?.products||[]).map(p=>`<tr><td style="font-size:1.5rem">${p.emoji}</td><td>${p.name}</td><td style="color:var(--gold)">${fmt.price(p.price)}</td><td>${p.stock}</td><td><button class="btn-action btn-danger" onclick="PageAdmin.delProd(${p.id})">Delete</button></td></tr>`).join('')}</tbody></table></div></div>`;
  } catch(e){ el.innerHTML=`<div class="page-error">${e.message}</div>`; } },
  async delProd(id) { if (!confirm('Delete this product?')) return; try{ const r=await AdminAPI.deleteProduct(id); if(r.success){ Toast.success('Deleted'); this.products(document.getElementById('admin-main')); } }catch(e){ Toast.error(e.message); } },
};

const PageNotFound = { mount(el) { el.innerHTML=`<div class="not-found-page"><div class="nf-code">404</div><h2>Page Not Found</h2><a href="/" class="btn-primary">Go Home →</a></div>`; } };

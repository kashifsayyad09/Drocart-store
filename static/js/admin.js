/* ============================================================
   DROCART — Admin JavaScript
   admin.js
   ============================================================ */

'use strict';

const Admin = (() => {

  /* ── Section Navigation ── */
  const showSection = (name, linkEl) => {
    document.querySelectorAll('.admin-section').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.admin-nav-link').forEach(l => l.classList.remove('active'));
    const section = document.getElementById(`section-${name}`);
    if (section) section.style.display = 'block';
    if (linkEl)  linkEl.classList.add('active');

    // Lazy load data
    switch (name) {
      case 'dashboard': loadDashboard(); break;
      case 'orders':    loadAllOrders(); break;
      case 'products':  loadProducts();  break;
    }
  };

  /* ── Dashboard ── */
  const loadDashboard = async () => {
    const data = await API.get('/api/admin/stats');
    if (!data.success) {
      Toast.show('❌ Could not load stats (admin login required)');
      return;
    }
    const s = data.data;

    // Stat cards
    document.getElementById('stats-grid').innerHTML = `
      <div class="stat-card">
        <div class="stat-card-icon">👥</div>
        <div class="stat-card-value">${s.total_users.toLocaleString()}</div>
        <div class="stat-card-label">Total Customers</div>
        <div class="stat-card-change change-up">↑ Growing</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-icon">📦</div>
        <div class="stat-card-value">${s.total_orders.toLocaleString()}</div>
        <div class="stat-card-label">Total Orders</div>
        <div class="stat-card-change change-up">↑ Active</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-icon">💰</div>
        <div class="stat-card-value">₹${Number(s.revenue).toLocaleString()}</div>
        <div class="stat-card-label">Revenue (Paid)</div>
        <div class="stat-card-change change-up">↑ This month</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-icon">🛍️</div>
        <div class="stat-card-value">${s.total_products.toLocaleString()}</div>
        <div class="stat-card-label">Active Products</div>
        <div class="stat-card-change change-up">↑ Stocked</div>
      </div>
    `;

    // Recent orders table
    const tbody = document.getElementById('recent-orders-body');
    if (tbody) {
      tbody.innerHTML = s.recent_orders.length === 0
        ? '<tr><td colspan="5" style="text-align:center;color:var(--mute);padding:2rem">No orders yet</td></tr>'
        : s.recent_orders.map(o => `
          <tr>
            <td><span style="font-family:'Syne',sans-serif;font-weight:600">${o.order_number}</span></td>
            <td>${o.customer}</td>
            <td style="color:var(--gold);font-weight:500">₹${Number(o.total).toLocaleString()}</td>
            <td><span class="status-badge status-${o.status}">${o.status}</span></td>
            <td style="color:var(--mute)">${formatDate(o.created_at)}</td>
          </tr>
        `).join('');
    }
  };

  /* ── All Orders ── */
  const loadAllOrders = async () => {
    const data = await API.get('/api/admin/orders');
    if (!data.success) return;
    const tbody = document.getElementById('all-orders-body');
    if (!tbody) return;

    tbody.innerHTML = data.data.length === 0
      ? '<tr><td colspan="7" style="text-align:center;color:var(--mute);padding:2rem">No orders yet</td></tr>'
      : data.data.map(o => `
        <tr>
          <td><span style="font-family:'Syne',sans-serif;font-weight:600">${o.order_number}</span></td>
          <td>
            <div style="font-weight:500;font-size:.88rem">${o.customer}</div>
            <div style="color:var(--mute);font-size:.78rem">${o.customer_email}</div>
          </td>
          <td style="color:var(--gold);font-weight:500">₹${Number(o.total).toLocaleString()}</td>
          <td><span class="status-badge status-${o.payment_status}">${o.payment_method} / ${o.payment_status}</span></td>
          <td>
            <select class="status-select" onchange="Admin.updateStatus(${o.id}, this.value)">
              ${['pending','confirmed','processing','shipped','delivered','cancelled','refunded']
                .map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${capitalize(s)}</option>`)
                .join('')}
            </select>
          </td>
          <td style="color:var(--mute)">${formatDate(o.created_at)}</td>
          <td>
            <div class="action-btns">
              <button class="btn-action" onclick="Admin.viewOrder(${o.id})">View</button>
            </div>
          </td>
        </tr>
      `).join('');
  };

  const updateStatus = async (orderId, status) => {
    const data = await API.patch(`/api/admin/orders/${orderId}`, { status });
    if (data.success) Toast.show(`✦ Order status updated to ${status}`);
    else Toast.show('❌ ' + data.error);
  };

  const viewOrder = (orderId) => {
    Toast.show(`Viewing order #${orderId} — detail view coming soon`);
  };

  /* ── Products ── */
  const loadProducts = async () => {
    const data = await API.get('/api/products?limit=50');
    if (!data.success) return;
    const tbody = document.getElementById('products-table-body');
    if (!tbody) return;

    tbody.innerHTML = data.data.products.map(p => `
      <tr>
        <td style="font-size:1.8rem">${p.emoji}</td>
        <td>
          <div style="font-weight:500;font-size:.9rem">${p.name}</div>
          <div style="color:var(--mute);font-size:.76rem">SKU: ${p.sku || '—'}</div>
        </td>
        <td style="color:var(--mute)">${p.category_name}</td>
        <td>
          <div style="color:var(--gold);font-weight:600">₹${Number(p.price).toLocaleString()}</div>
          ${p.old_price ? `<div style="color:var(--mute);font-size:.76rem;text-decoration:line-through">₹${Number(p.old_price).toLocaleString()}</div>` : ''}
        </td>
        <td>
          <span style="color:${p.stock > 20 ? 'var(--teal)' : p.stock > 0 ? 'var(--gold)' : 'var(--rose)'}">
            ${p.stock}
          </span>
        </td>
        <td>
          <span style="color:var(--gold)">★ ${p.rating}</span>
          <span style="color:var(--mute);font-size:.76rem"> (${p.review_count})</span>
        </td>
        <td>
          <div class="action-btns">
            <button class="btn-action btn-danger" onclick="Admin.deleteProduct(${p.id})">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');
  };

  const showAddProduct = () => {
    const form = document.getElementById('add-product-form');
    if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
  };

  const addProduct = async () => {
    const product = {
      name:        document.getElementById('ap-name').value.trim(),
      category_id: document.getElementById('ap-cat').value,
      description: document.getElementById('ap-desc').value.trim(),
      price:       document.getElementById('ap-price').value,
      old_price:   document.getElementById('ap-oldprice').value || null,
      stock:       document.getElementById('ap-stock').value,
      emoji:       document.getElementById('ap-emoji').value.trim() || '📦',
      badge:       document.getElementById('ap-badge').value,
      is_featured: document.getElementById('ap-featured').value,
    };

    if (!product.name || !product.price) {
      Toast.show('Name and price are required'); return;
    }

    const data = await API.post('/api/admin/products', product);
    if (data.success) {
      Toast.show('✦ Product added successfully!');
      document.getElementById('add-product-form').style.display = 'none';
      // Clear form
      ['ap-name','ap-desc','ap-price','ap-oldprice','ap-stock'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      document.getElementById('ap-emoji').value    = '📦';
      document.getElementById('ap-badge').value    = '';
      document.getElementById('ap-featured').value = '0';
      loadProducts();
    } else {
      Toast.show('❌ ' + data.error);
    }
  };

  const deleteProduct = async (productId) => {
    if (!confirm('Delete this product? This action cannot be undone.')) return;
    const data = await API.delete(`/api/admin/products/${productId}`);
    if (data.success) {
      Toast.show('Product deleted');
      loadProducts();
    } else {
      Toast.show('❌ ' + data.error);
    }
  };

  /* ── Utilities ── */
  const formatDate = str => {
    if (!str) return '—';
    return new Date(str).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
  };

  const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);

  /* ── Init ── */
  loadDashboard();

  return {
    showSection,
    updateStatus,
    viewOrder,
    showAddProduct,
    addProduct,
    deleteProduct,
  };
})();

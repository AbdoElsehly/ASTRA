const API = '/api';
const tokenKey = 'orbit-admin-token';
const $ = (selector) => document.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
let users = [];
let transactions = [];
let listings = [];
let deliveries = [];
let commerceOrders = [];
let commerceProducts = [];
let commerceCategories = [];
let commerceReviews = [];
let commerceAgents = [];
let commerceReport = {};
let activeReportData = null;

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}), Authorization: `Bearer ${localStorage.getItem(tokenKey) || ''}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'تعذر تنفيذ العملية');
  return data;
}

function money(value) { return `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م`; }
function roleLabel(role) { return ({ customer: 'عميل', store: 'متجر', courier: 'مندوب', admin: 'مشرف' })[role] || role; }
function scopeLabel(scope) { return ({ super_admin: 'مشرف رئيسي', product_manager: 'مدير المنتجات', order_manager: 'مدير الطلبات', payment_manager: 'مدير المدفوعات', customer_manager: 'مدير العملاء', content_manager: 'مدير المحتوى' })[scope] || ''; }
function canManageUser(user) { const currentAdminId = JSON.parse(localStorage.getItem('orbit-admin-user') || '{}').id; return currentAdminId ? user.id !== currentAdminId : user.role !== 'admin'; }
function toast(message) { const element = $('#toast'); element.textContent = message; element.classList.add('show'); setTimeout(() => element.classList.remove('show'), 2600); }
function showLogin(error = '') { $('#loginView').classList.remove('hidden'); $('#dashboardView').classList.add('hidden'); $('#loginError').textContent = error; }
function escapeHTML(value = '') { return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }
function readImageData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('تعذرت قراءة صورة المنتج'));
    reader.readAsDataURL(file);
  });
}

function renderCommerceStats(summary) {
  const cards = [['المبيعات', money(summary.sales)], ['الطلبات', summary.orders], ['جديدة / دفع معلق', summary.newOrders], ['قيد التجهيز', summary.preparing], ['جاهزة للتوصيل', summary.ready], ['قيد التوصيل', summary.delivering], ['مكتملة', summary.completed], ['ملغاة', summary.cancelled], ['العملاء', summary.customers], ['إثباتات تحتاج مراجعة', summary.pendingProofs], ['مخزون منخفض', summary.lowStock]];
  $('#commerceStats').innerHTML = cards.map(([label, value]) => `<div class="commerce-stat"><span>${escapeHTML(label)}</span><strong>${escapeHTML(typeof value === 'number' ? value.toLocaleString('ar-EG') : value)}</strong></div>`).join('');
}

function orderStatusLabel(status) {
  return ({ new: 'جديد', payment_pending: 'بانتظار الدفع', payment_failed: 'الدفع لم يكتمل', preparing: 'قيد التجهيز', ready_for_delivery: 'جاهز للتوصيل', assigned: 'تم تعيين مندوب', out_for_delivery: 'قيد التوصيل', delivered: 'تم التسليم', failed_delivery: 'تعذر التسليم', cancelled: 'ملغي', returned: 'مرتجع' })[status] || status;
}

function renderCommerceOrders() {
  const search = ($('#commerceOrderSearch').value || '').trim().toLowerCase();
  const status = $('#commerceOrderStatus').value;
  const payment = $('#commercePaymentFilter').value;
  const filtered = commerceOrders.filter((order) => (!status || order.order_status === status) && (!payment || order.payment_status === payment) && `${order.order_number} ${order.customer_name} ${order.customer_phone}`.toLowerCase().includes(search));
  const transitions = ['preparing', 'ready_for_delivery', 'cancelled'];
  $('#commerceOrdersTable').innerHTML = filtered.length ? filtered.map((order) => `<article class="commerce-row"><div><strong>${escapeHTML(order.order_number)}</strong><span>${escapeHTML(order.customer_name)} · ${escapeHTML(order.customer_phone)}</span><small>${new Date(order.created_at).toLocaleString('ar-EG')}</small></div><div><span>الإجمالي</span><strong>${money(order.total)}</strong></div><div><span>الدفع</span><b class="commerce-badge ${order.payment_status === 'paid' || order.payment_status === 'collected' ? 'success' : order.payment_status === 'processing' ? 'warning' : ''}">${escapeHTML(order.payment_status)}</b></div><div><span>حالة الطلب</span><b class="commerce-badge">${escapeHTML(orderStatusLabel(order.order_status))}</b></div><div class="commerce-row-actions"><select aria-label="حالة الطلب ${escapeHTML(order.order_number)}" data-order-status="${escapeHTML(order.id)}"><option value="">تغيير الحالة</option>${transitions.map((item) => `<option value="${item}">${orderStatusLabel(item)}</option>`).join('')}</select><select aria-label="المندوب ${escapeHTML(order.order_number)}" data-order-agent="${escapeHTML(order.id)}"><option value="">اختر مندوبًا</option>${commerceAgents.map((agent) => `<option value="${escapeHTML(agent.id)}">${escapeHTML(agent.name)} · ${escapeHTML(agent.location || '')}</option>`).join('')}</select><button type="button" data-assign-order="${escapeHTML(order.id)}">تعيين</button></div></article>`).join('') : '<div class="commerce-empty">لا توجد طلبات مطابقة.</div>';
}

function renderCommerceProducts() {
  const search = ($('#commerceProductSearch').value || '').trim().toLowerCase();
  const status = $('#commerceProductStatus').value;
  const filtered = commerceProducts.filter((product) => (status === 'all' || product.status === status) && `${product.name} ${product.sku}`.toLowerCase().includes(search));
  $('#commerceProductsTable').innerHTML = filtered.length ? filtered.map((product) => `<article class="commerce-row"><div><strong>${escapeHTML(product.name)}</strong><span>${escapeHTML(product.sku)} · ${escapeHTML(product.category_name || 'بدون تصنيف')}</span></div><div><span>السعر</span><strong>${money(product.sale_price || product.price)}</strong></div><div><span>المخزون</span><b class="commerce-badge ${product.stock <= product.low_stock_threshold ? 'warning' : 'success'}">${Number(product.stock).toLocaleString('ar-EG')}</b></div><div><span>الحالة</span><b class="commerce-badge">${escapeHTML(product.status)}</b></div><div class="commerce-row-actions"><select data-product-status="${escapeHTML(product.id)}"><option value="draft" ${product.status === 'draft' ? 'selected' : ''}>مسودة</option><option value="published" ${product.status === 'published' ? 'selected' : ''}>منشور</option><option value="archived" ${product.status === 'archived' ? 'selected' : ''}>مؤرشف</option></select><button type="button" data-save-product="${escapeHTML(product.id)}">حفظ</button></div></article>`).join('') : '<div class="commerce-empty">لا توجد منتجات مطابقة.</div>';
  $('#commerceProductCategory').innerHTML = '<option value="">بدون تصنيف</option>' + commerceCategories.map((category) => `<option value="${escapeHTML(category.id)}">${escapeHTML(category.name)}</option>`).join('');
}

function renderCommerceCustomers(customers) {
  $('#commerceCustomersTable').innerHTML = customers.length ? customers.map((customer) => `<article class="commerce-row"><div><strong>${escapeHTML(customer.name)}</strong><span>${escapeHTML(customer.phone)}</span></div><div><span>الطلبات</span><strong>${Number(customer.orders).toLocaleString('ar-EG')}</strong></div><div><span>المشتريات</span><strong>${money(customer.purchases)}</strong></div><div><span>الحالة</span><b class="commerce-badge ${customer.status === 'active' ? 'success' : 'warning'}">${customer.status === 'active' ? 'نشط' : 'موقوف'}</b></div><div class="commerce-row-actions"><button type="button" data-customer-status="${escapeHTML(customer.id)}" data-next-status="${customer.status === 'active' ? 'suspended' : 'active'}">${customer.status === 'active' ? 'تعطيل' : 'تفعيل'}</button></div></article>`).join('') : '<div class="commerce-empty">لا يوجد عملاء.</div>';
}

function renderCommercePayments(payments) {
  $('#commercePaymentsTable').innerHTML = payments.length ? payments.map((payment) => `<article class="commerce-row"><div><strong>${escapeHTML(payment.order_number)}</strong><span>${escapeHTML(payment.customer_name)}</span></div><div><span>المبلغ</span><strong>${money(payment.amount)}</strong></div><div><span>الطريقة</span><strong>${payment.method === 'cod' ? 'عند الاستلام' : 'تحويل'}</strong></div><div><span>الحالة</span><b class="commerce-badge ${payment.status === 'paid' || payment.status === 'collected' ? 'success' : payment.status === 'failed' ? 'error' : 'warning'}">${escapeHTML(payment.status)}</b></div><div><span>رقم العملية</span><small>${escapeHTML(payment.transaction_id || '—')}</small></div></article>`).join('') : '<div class="commerce-empty">لا توجد مدفوعات.</div>';
}

function renderCommerceProofs(proofs) {
  $('#commerceProofsTable').innerHTML = proofs.length ? proofs.map((proof) => `<article class="commerce-row"><div><strong>${escapeHTML(proof.order_number)}</strong><span>${escapeHTML(proof.customer_name)}</span></div><div><span>المبلغ المدعى</span><strong>${money(proof.claimed_amount)}</strong></div><div><span>رقم العملية</span><strong>${escapeHTML(proof.transaction_id)}</strong></div><div><span>المراجعة</span><b class="commerce-badge ${proof.review_status === 'approved' ? 'success' : proof.review_status === 'rejected' ? 'error' : 'warning'}">${escapeHTML(proof.review_status)}</b></div><div class="commerce-row-actions"><button type="button" data-view-proof="${escapeHTML(proof.id)}">عرض الإيصال</button>${proof.review_status === 'pending' ? `<button type="button" data-review-proof="${escapeHTML(proof.id)}" data-decision="approve">قبول الدفع</button><button type="button" data-review-proof="${escapeHTML(proof.id)}" data-decision="reject" data-danger>رفض</button>` : ''}</div></article>`).join('') : '<div class="commerce-empty">لا توجد إثباتات تحتاج مراجعة.</div>';
}

function renderCommerceReviews(reviews) {
  commerceReviews = reviews;
  $('#commerceReviewsTable').innerHTML = reviews.length ? reviews.map((review) => `<article class="commerce-row"><div><strong>${escapeHTML(review.product_name)}</strong><span>${escapeHTML(review.customer_name)} · ${escapeHTML(review.order_number)}</span></div><div><span>التقييم</span><strong>${Number(review.rating).toLocaleString('ar-EG')} / ٥</strong></div><div><span>الحالة</span><b class="commerce-badge ${review.status === 'approved' ? 'success' : review.status === 'rejected' ? 'error' : 'warning'}">${escapeHTML(review.status)}</b></div><div><span>التعليق</span><small>${escapeHTML(review.text || 'بدون تعليق')}</small></div><div class="commerce-row-actions">${review.status === 'pending' ? `<button type="button" data-review-product="${escapeHTML(review.id)}" data-review-status="approved">موافقة</button><button type="button" data-review-product="${escapeHTML(review.id)}" data-review-status="rejected" data-danger>رفض</button>` : ''}</div></article>`).join('') : '<div class="commerce-empty">لا توجد تقييمات للمراجعة.</div>';
}

function renderCommerceNotifications(notifications) {
  $('#commerceNotificationsList').innerHTML = notifications.length ? notifications.map((notice) => `<article class="commerce-row"><div><strong>${escapeHTML(notice.title)}</strong><span>${escapeHTML(notice.message)}</span></div><div><span>${new Date(notice.created_at).toLocaleString('ar-EG')}</span></div><div><b class="commerce-badge ${notice.read_at ? '' : 'warning'}">${notice.read_at ? 'مقروء' : 'جديد'}</b></div><div class="commerce-row-actions">${notice.read_at ? '' : `<button type="button" data-read-notification="${escapeHTML(notice.id)}">تحديد كمقروء</button>`}</div></article>`).join('') : '<div class="commerce-empty">لا توجد إشعارات جديدة.</div>';
}

function renderCommerceAgents(agents) {
  commerceAgents = agents;
  $('#commerceAgentsTable').innerHTML = agents.length ? agents.map((agent) => `<article class="commerce-row"><div><strong>${escapeHTML(agent.name)}</strong><span>${escapeHTML(agent.phone)} · ${escapeHTML(agent.location || 'بدون منطقة')}</span></div><div><span>الحالة</span><b class="commerce-badge ${agent.status === 'active' ? 'success' : 'warning'}">${escapeHTML(agent.status)}</b></div><div><span>الحالية</span><strong>${Number(agent.current_orders || 0)}</strong></div><div><span>المكتملة</span><strong>${Number(agent.completed_orders || 0)}</strong></div><div><span>الفاشلة</span><strong>${Number(agent.failed_orders || 0)}</strong></div></article>`).join('') : '<div class="commerce-empty">أضف أول مندوب لتظهر القائمة هنا.</div>';
}

async function loadCommerceDashboard() {
  const currentAdmin = JSON.parse(localStorage.getItem('orbit-admin-user') || '{}');
  const scope = currentAdmin.adminScope || 'super_admin';
  if (scope !== 'super_admin') return loadScopedCommerceDashboard(scope);
  const [summary, orders, products, categories, customers, payments, proofs, reviews, agents, shipping, coupons, report, audit, settings, notifications] = await Promise.all([
    request('/admin/store/dashboard'), request('/admin/store/orders'), request('/admin/store/products'), request('/store/categories'),
    request('/admin/store/customers'), request('/admin/store/payments'), request('/admin/store/proofs'), request('/admin/store/reviews'),
    request('/admin/store/agents'), request('/admin/store/shipping-methods'), request('/admin/store/coupons'), request('/admin/store/reports'), request('/admin/store/audit'), request('/admin/store/settings'), request('/store/notifications'),
  ]);
  renderCommerceStats(summary);
  commerceOrders = orders; commerceProducts = products; commerceCategories = categories; commerceReport = report;
  renderCommerceOrders(); renderCommerceProducts(); renderCommerceCustomers(customers); renderCommercePayments(payments); renderCommerceProofs(proofs); renderCommerceReviews(reviews); renderCommerceAgents(agents);
  renderCommerceNotifications(notifications);
  $('#latestCommerceOrders').innerHTML = orders.slice(0, 6).map((order) => `<div class="commerce-mini-row"><strong>${escapeHTML(order.order_number)}</strong><span>${escapeHTML(order.customer_name)} · ${money(order.total)}</span></div>`).join('') || '<div class="commerce-empty">لا توجد طلبات بعد.</div>';
  const lowStock = products.filter((product) => product.status === 'published' && product.stock <= product.low_stock_threshold);
  $('#lowStockProducts').innerHTML = lowStock.slice(0, 6).map((product) => `<div class="commerce-mini-row"><strong>${escapeHTML(product.name)}</strong><span>متبقي ${Number(product.stock).toLocaleString('ar-EG')}</span></div>`).join('') || '<div class="commerce-empty">المخزون جيد.</div>';
  $('#commerceCategoriesList').innerHTML = categories.map((category) => `<span class="commerce-chip">${escapeHTML(category.name)}</span>`).join('') || '<div class="commerce-empty">لا توجد تصنيفات.</div>';
  $('#commerceShippingList').innerHTML = shipping.map((method) => `<div class="commerce-mini-row"><strong>${escapeHTML(method.name)}</strong><span>${money(method.price)} · ${method.active ? 'مفعّل' : 'متوقف'}</span></div>`).join('') || '<div class="commerce-empty">لا توجد طرق شحن.</div>';
  $('#commerceCouponsList').innerHTML = coupons.map((coupon) => `<span class="commerce-chip">${escapeHTML(coupon.code)} · ${coupon.kind === 'percent' ? `${coupon.value}%` : money(coupon.value)} · ${coupon.active ? 'مفعّل' : 'متوقف'}</span>`).join('') || '<div class="commerce-empty">لا توجد كوبونات.</div>';
  $('#commerceMonthlyReport').innerHTML = (report.monthlySales || []).map((row) => `<div class="commerce-mini-row"><strong>${escapeHTML(row.month)}</strong><span>${Number(row.orders)} طلب · ${money(row.total)}</span></div>`).join('') || '<div class="commerce-empty">لا توجد مبيعات مؤكدة بعد.</div>';
  $('#commerceAuditLog').innerHTML = audit.slice(0, 8).map((row) => `<div class="commerce-mini-row"><strong>${escapeHTML(row.actor_name || 'النظام')} · ${escapeHTML(row.action)}</strong><span>${escapeHTML(row.entity_type)} ${escapeHTML(row.entity_id)} · ${new Date(row.created_at).toLocaleString('ar-EG')}</span></div>`).join('') || '<div class="commerce-empty">لا توجد عمليات مسجلة.</div>';
  Object.entries(settings).forEach(([key, value]) => { const input = $(`#commerceSettingsForm [name="${key}"]`); if (input) input.value = value; });
  $('#commerceProductCategory').innerHTML = '<option value="">بدون تصنيف</option>' + categories.map((category) => `<option value="${escapeHTML(category.id)}">${escapeHTML(category.name)}</option>`).join('');
  window.lucide?.createIcons();
}

async function loadScopedCommerceDashboard(scope) {
  const panels = {
    product_manager: ['commerce-products', 'commerce-categories', 'commerce-reviews'],
    order_manager: ['commerce-dashboard', 'commerce-orders', 'commerce-shipping'],
    payment_manager: ['commerce-payments', 'commerce-proofs', 'commerce-coupons', 'commerce-settings'],
    customer_manager: ['commerce-customers'],
    content_manager: ['commerce-categories'],
  }[scope] || [];
  if (!panels.includes('commerce-notifications')) panels.push('commerce-notifications');
  $$('#dashboardView .commerce-panel').forEach((panel) => panel.classList.toggle('hidden', !panels.includes(panel.id)));
  ['users', 'listings', 'deliveries', 'transactions'].forEach((id) => $(`#${id}`)?.classList.add('hidden'));
  $('.admin-quickbar').classList.add('hidden');
  $('#statsGrid').classList.add('hidden');
  $$('.admin-sidebar nav a').forEach((link) => {
    const target = link.getAttribute('href')?.slice(1);
    if (target && target.startsWith('commerce-')) link.classList.toggle('hidden', !panels.includes(target));
    else if (['dashboard', 'users', 'listings', 'deliveries', 'transactions'].includes(target)) link.classList.add('hidden');
  });

  if (scope === 'product_manager') {
    [commerceProducts, commerceCategories, commerceReviews] = await Promise.all([request('/admin/store/products'), request('/store/categories'), request('/admin/store/reviews')]);
    renderCommerceProducts();
    renderCommerceReviews(commerceReviews);
    $('#commerceCategoriesList').innerHTML = commerceCategories.map((category) => `<span class="commerce-chip">${escapeHTML(category.name)}</span>`).join('') || '<div class="commerce-empty">لا توجد تصنيفات.</div>';
  } else if (scope === 'order_manager') {
    const [summary, orders, agents, shipping] = await Promise.all([request('/admin/store/dashboard'), request('/admin/store/orders'), request('/admin/store/agents'), request('/admin/store/shipping-methods')]);
    commerceOrders = orders;
    renderCommerceStats(summary);
    renderCommerceAgents(agents);
    renderCommerceOrders();
    $('#commerceShippingList').innerHTML = shipping.map((method) => `<div class="commerce-mini-row"><strong>${escapeHTML(method.name)}</strong><span>${money(method.price)}</span></div>`).join('') || '<div class="commerce-empty">لا توجد طرق شحن.</div>';
  } else if (scope === 'payment_manager') {
    const [payments, proofs, coupons, settings] = await Promise.all([request('/admin/store/payments'), request('/admin/store/proofs'), request('/admin/store/coupons'), request('/admin/store/settings')]);
    renderCommercePayments(payments); renderCommerceProofs(proofs);
    $('#commerceCouponsList').innerHTML = coupons.map((coupon) => `<span class="commerce-chip">${escapeHTML(coupon.code)} · ${coupon.kind === 'percent' ? `${coupon.value}%` : money(coupon.value)}</span>`).join('') || '<div class="commerce-empty">لا توجد كوبونات.</div>';
    Object.entries(settings).forEach(([key, value]) => { const input = $(`#commerceSettingsForm [name="${key}"]`); if (input) input.value = value; });
  } else if (scope === 'customer_manager') {
    renderCommerceCustomers(await request('/admin/store/customers'));
  } else if (scope === 'content_manager') {
    commerceCategories = await request('/store/categories');
    $('#commerceCategoriesList').innerHTML = commerceCategories.map((category) => `<span class="commerce-chip">${escapeHTML(category.name)}</span>`).join('') || '<div class="commerce-empty">لا توجد تصنيفات.</div>';
  } else {
    throw new Error('دور المشرف غير معروف');
  }
  renderCommerceNotifications(await request('/store/notifications'));
  window.lucide?.createIcons();
}

function renderStats() {
  const count = (role) => users.filter((user) => user.role === role).length;
  $('#statsGrid').innerHTML = [['إجمالي المستخدمين', users.length], ['المتاجر', count('store')], ['العملاء', count('customer')], ['المناديب', count('courier')], ['المشرفون', count('admin')]].map(([label, value]) => `<div class="stat-card"><span>${label}</span><strong>${value.toLocaleString('ar-EG')}</strong></div>`).join('');
}

function renderUsers() {
  const query = ($('#userSearch').value || '').trim().toLowerCase();
  const role = $('#userRoleFilter').value;
  const reviewFilter = $('#userReviewFilter').value;
  const filtered = users.filter((user) => {
    const isNew = user.role !== 'admin' && !user.reviewed_at;
    return (role === 'all' || user.role === role)
      && (reviewFilter === 'all' || (reviewFilter === 'new' ? isNew : !isNew))
      && `${user.name} ${user.phone} ${user.public_id || ''} ${user.role}`.toLowerCase().includes(query);
  });
  $('#usersTable').innerHTML = filtered.length ? filtered.map((user) => {
    const isNew = user.role !== 'admin' && !user.reviewed_at;
    const status = user.status === 'active' ? 'نشط' : user.status === 'suspended' ? 'موقوف' : 'قيد المراجعة';
    const moderation = Number(user.review_listings) !== 0;
    return `<div class="user-row"><div class="user-main"><strong>${escapeHTML(user.name)} ${isNew ? '<span class="new-user-badge">تسجيل جديد</span>' : ''}</strong><span>${roleLabel(user.role)}${user.admin_scope ? ` · ${scopeLabel(user.admin_scope)}` : ''} · ${escapeHTML(user.phone)} · ${escapeHTML(user.public_id || '')} · رصيد ${money(user.balance)} · ${status}</span></div><div class="user-actions"><label class="moderation-toggle"><input type="checkbox" data-listing-review="${escapeHTML(user.id)}" ${moderation ? 'checked' : ''} ${user.role === 'admin' ? 'disabled' : ''} /><span>مراجعة الإعلانات</span></label><button class="outline-button" data-report="${escapeHTML(user.id)}"><i data-lucide="file-chart-column"></i> تقارير</button>${canManageUser(user) ? isNew ? `<button class="outline-button" data-user-review="${escapeHTML(user.id)}" data-review-action="approve">السماح بالاستمرار</button><button class="outline-button danger-button" data-user-review="${escapeHTML(user.id)}" data-review-action="cancel">إلغاء الحساب</button>` : `<button class="outline-button" data-user-status="${escapeHTML(user.id)}" data-status-next="${user.status === 'active' ? 'suspended' : 'active'}">${user.status === 'active' ? 'إيقاف' : 'تفعيل'}</button><button class="outline-button danger-button" data-delete="${escapeHTML(user.id)}"><i data-lucide="trash-2"></i> حذف</button>` : ''}</div></div>`;
  }).join('') : '<div class="user-row"><span>لا توجد حسابات مطابقة.</span></div>';
  window.lucide?.createIcons();
}

function renderListings() {
  const status = $('#listingStatusFilter').value;
  const filtered = listings.filter((listing) => status === 'all' || listing.status === status);
  $('#listingsTable').innerHTML = filtered.length ? filtered.map((listing) => `<div class="listing-row"><div class="listing-main"><strong>${escapeHTML(listing.title)}</strong><span>${escapeHTML(listing.owner_name)} · ${escapeHTML(listing.category)} · ${money(listing.price)} · ${escapeHTML(listing.public_id || '')}</span></div><div class="listing-actions"><span class="status-badge ${escapeHTML(listing.status)}">${listing.status === 'pending' ? 'قيد المراجعة' : listing.status === 'published' ? 'منشور' : listing.status === 'rejected' ? 'مرفوض' : 'مؤرشف'}</span><button class="outline-button" data-listing-status="published" data-listing-id="${escapeHTML(listing.id)}">اعتماد</button><button class="outline-button danger-button" data-listing-status="rejected" data-listing-id="${escapeHTML(listing.id)}">رفض</button></div></div>`).join('') : '<div class="listing-row"><span>لا توجد إعلانات في هذه الحالة.</span></div>';
  window.lucide?.createIcons();
}

function renderDeliveries() {
  $('#deliveryCount').textContent = `${deliveries.length.toLocaleString('ar-EG')} طلب`;
  $('#deliveryTable').innerHTML = deliveries.length ? deliveries.map((delivery) => `<div class="delivery-row"><div><strong>${escapeHTML(delivery.listing_title)}</strong><span>${escapeHTML(delivery.public_id || '')} · ${escapeHTML(delivery.buyer_name)} ← ${escapeHTML(delivery.seller_name)}</span></div><div><span class="status-badge">${escapeHTML(delivery.status || 'جديد')}</span><small>المندوب: ${escapeHTML(delivery.courier_name || 'غير معيّن')} · الأجر ${money(delivery.courier_fee)}</small></div></div>`).join('') : '<div class="delivery-row"><span>لا توجد طلبات توصيل.</span></div>';
}

function renderTransactions() {
  $('#transactionsList').innerHTML = transactions.length ? transactions.slice(0, 15).map((item) => `<div class="transaction-row"><div class="transaction-main"><strong>${escapeHTML(item.details?.deletedUser || item.type)}</strong><span>${escapeHTML(item.public_id || '')} · ${item.sender_name ? `من ${escapeHTML(item.sender_name)}` : ''}${item.recipient_name ? ` إلى ${escapeHTML(item.recipient_name)}` : ''} · ${new Date(item.created_at).toLocaleString('ar-EG')}</span></div><strong>${money(item.amount)}</strong></div>`).join('') : '<div class="transaction-row"><span>لا توجد عمليات بعد.</span></div>';
}

function renderAccountReport(category) {
  const rows = activeReportData?.[category] || [];
  $$('.report-tabs [data-report-category]').forEach((button) => button.classList.toggle('active', button.dataset.reportCategory === category));
  if (!rows.length) {
    $('#reportList').innerHTML = '<p class="report-empty">لا توجد سجلات في هذا التقرير.</p>';
    return;
  }
  $('#reportList').innerHTML = rows.map((item) => {
    let details = item.details || {};
    if (typeof details === 'string') { try { details = JSON.parse(details); } catch { details = {}; } }
    const title = item.title || details.title || item.description || item.type || 'سجل';
    const identifier = item.public_id || item.publicId || item.order_number || item.id || '';
    const status = item.status || details.status || item.payment_status || '';
    const date = item.created_at ? new Date(item.created_at).toLocaleString('ar-EG') : '';
    return `<article class="report-item"><div><strong>${escapeHTML(title)}</strong><span>${escapeHTML(identifier)} · ${escapeHTML(status)} · ${escapeHTML(date)}</span></div><strong>${money(item.amount ?? item.price ?? item.total)}</strong></article>`;
  }).join('');
}

async function loadDashboard() {
  const currentAdmin = JSON.parse(localStorage.getItem('orbit-admin-user') || '{}');
  if ((currentAdmin.adminScope || 'super_admin') !== 'super_admin') {
    await loadScopedCommerceDashboard(currentAdmin.adminScope);
    $('#loginView').classList.add('hidden'); $('#dashboardView').classList.remove('hidden');
    return;
  }
  ['users', 'listings', 'deliveries', 'transactions'].forEach((id) => $(`#${id}`)?.classList.remove('hidden'));
  $$('#dashboardView .commerce-panel').forEach((panel) => panel.classList.remove('hidden'));
  $$('.admin-sidebar nav a').forEach((link) => link.classList.remove('hidden'));
  $('.admin-quickbar').classList.remove('hidden');
  $('#statsGrid').classList.remove('hidden');
  users = await request('/admin/users');
  transactions = await request('/admin/transactions');
  [listings, deliveries] = await Promise.all([request('/admin/listings'), request('/admin/delivery-requests')]);
  const marketSettings = await request('/admin/market-settings');
  $('#settingListings').value = marketSettings.listingsReview;
  $('#settingDeliveryFee').value = marketSettings.deliveryFeePercent;
  $('#settingMarket').value = marketSettings.marketStatus;
  transactions = transactions.map((item) => ({ ...item, details: (() => { try { return JSON.parse(item.details || '{}'); } catch { return {}; } })() }));
  renderStats(); renderUsers(); renderListings(); renderDeliveries(); renderTransactions();
  try { await loadCommerceDashboard(); } catch (error) { toast(`تعذر تحميل إدارة المتجر: ${error.message}`); }
  $('#loginView').classList.add('hidden'); $('#dashboardView').classList.remove('hidden');
  window.lucide?.createIcons();
}

$('#commerceProductForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = Object.fromEntries(new FormData(formElement));
  const imageFile = form.imageFile;
  if (imageFile?.size && (!['image/jpeg', 'image/png', 'image/webp'].includes(imageFile.type) || imageFile.size > 4 * 1024 * 1024)) return toast('اختار صورة JPG أو PNG أو WebP بحجم أقل من ٤ ميجابايت');
  try {
    const imageData = imageFile?.size ? await readImageData(imageFile) : '';
    await request('/admin/store/products', { method: 'POST', body: JSON.stringify({ ...form, imageFile: undefined, imageData, price: Number(form.price), salePrice: form.salePrice ? Number(form.salePrice) : null, costPrice: form.costPrice ? Number(form.costPrice) : null, stock: Number(form.stock), lowStockThreshold: Number(form.lowStockThreshold), categoryId: form.categoryId || null, images: form.imageUrl ? [form.imageUrl] : [] }) });
    formElement.reset();
    await loadCommerceDashboard();
    toast('تمت إضافة المنتج');
  } catch (error) { toast(error.message); }
});

$('#commerceCategoryForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = Object.fromEntries(new FormData(formElement));
  try { await request('/admin/store/categories', { method: 'POST', body: JSON.stringify(form) }); formElement.reset(); await loadCommerceDashboard(); toast('تمت إضافة التصنيف'); }
  catch (error) { toast(error.message); }
});

$('#commerceShippingForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = Object.fromEntries(new FormData(formElement));
  try { await request('/admin/store/shipping-methods', { method: 'POST', body: JSON.stringify({ ...form, price: Number(form.price), regions: form.regions.split(',').map((item) => item.trim()).filter(Boolean) }) }); formElement.reset(); await loadCommerceDashboard(); toast('تمت إضافة طريقة الشحن'); }
  catch (error) { toast(error.message); }
});

$('#commerceAgentForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = Object.fromEntries(new FormData(formElement));
  try { await request('/admin/store/agents', { method: 'POST', body: JSON.stringify(form) }); formElement.reset(); await loadCommerceDashboard(); toast('تم حفظ حساب المندوب'); }
  catch (error) { toast(error.message); }
});

$('#commerceCouponForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = Object.fromEntries(new FormData(formElement));
  try { await request('/admin/store/coupons', { method: 'POST', body: JSON.stringify({ ...form, value: Number(form.value), usageLimit: form.usageLimit ? Number(form.usageLimit) : null, minOrder: Number(form.minOrder || 0) }) }); formElement.reset(); await loadCommerceDashboard(); toast('تم إنشاء الكوبون'); }
  catch (error) { toast(error.message); }
});

$('#commerceSettingsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try { await request('/admin/store/settings', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); await loadCommerceDashboard(); toast('تم حفظ بيانات التحويل'); }
  catch (error) { toast(error.message); }
});

$('#commerceOrderSearch').addEventListener('input', renderCommerceOrders);
$('#commerceOrderStatus').addEventListener('change', async () => { try { commerceOrders = await request(`/admin/store/orders?status=${encodeURIComponent($('#commerceOrderStatus').value)}&q=${encodeURIComponent($('#commerceOrderSearch').value)}`); renderCommerceOrders(); } catch (error) { toast(error.message); } });
$('#commercePaymentFilter').addEventListener('change', renderCommerceOrders);
$('#commerceProductSearch').addEventListener('input', renderCommerceProducts);
$('#commerceProductStatus').addEventListener('change', renderCommerceProducts);
$('#commerceCustomerSearch').addEventListener('input', async () => { try { renderCommerceCustomers(await request(`/admin/store/customers?q=${encodeURIComponent($('#commerceCustomerSearch').value)}`)); } catch (error) { toast(error.message); } });
$('#commercePaymentsFilter').addEventListener('change', async () => { try { renderCommercePayments(await request(`/admin/store/payments?status=${encodeURIComponent($('#commercePaymentsFilter').value)}`)); } catch (error) { toast(error.message); } });
$('[data-commerce-refresh]').addEventListener('click', () => loadCommerceDashboard().then(() => toast('تم تحديث بيانات المتجر')).catch((error) => toast(error.message)));

$('#adminLoginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const result = await request('/auth/login', { method: 'POST', body: JSON.stringify(body) });
    if (result.user.role !== 'admin') throw new Error('هذا الحساب ليس حساب مشرف');
    localStorage.setItem(tokenKey, result.token);
    localStorage.setItem('orbit-admin-user', JSON.stringify(result.user));
    await loadDashboard();
  } catch (error) { showLogin(error.message); }
});

$('#userSearch').addEventListener('input', renderUsers);
$('#userRoleFilter').addEventListener('change', renderUsers);
$('#userReviewFilter').addEventListener('change', renderUsers);
$('#listingStatusFilter').addEventListener('change', renderListings);
async function saveMarketSettings() {
  try {
    await request('/admin/market-settings', {
      method: 'PATCH',
      body: JSON.stringify({
        listingsReview: $('#settingListings').value,
        deliveryFeePercent: Number($('#settingDeliveryFee').value),
        marketStatus: $('#settingMarket').value,
      }),
    });
    toast('تم حفظ إعدادات السوق');
  } catch (error) {
    toast(error.message);
    await loadDashboard();
  }
}
$('#settingListings').addEventListener('change', saveMarketSettings);
$('#settingDeliveryFee').addEventListener('change', saveMarketSettings);
$('#settingMarket').addEventListener('change', saveMarketSettings);
const adminSidebar = $('.admin-sidebar');
const adminShell = $('.admin-shell');
const adminMenuButton = $('#adminMenuButton');
const isNarrowAdminLayout = () => window.matchMedia('(max-width: 760px)').matches;
function setAdminSidebarOpen(open) {
  if (isNarrowAdminLayout()) adminSidebar.classList.toggle('open', open);
  else adminShell.classList.toggle('sidebar-collapsed', !open);
  adminMenuButton.setAttribute('aria-expanded', String(open));
  adminMenuButton.setAttribute('aria-label', open ? 'إخفاء القائمة' : 'إظهار القائمة');
}
adminMenuButton.addEventListener('click', () => {
  const open = isNarrowAdminLayout()
    ? !adminSidebar.classList.contains('open')
    : adminShell.classList.contains('sidebar-collapsed');
  setAdminSidebarOpen(open);
});
$('#adminSidebarClose').addEventListener('click', () => setAdminSidebarOpen(false));
document.addEventListener('click', (event) => {
  if (isNarrowAdminLayout() && adminSidebar.classList.contains('open')
    && !adminSidebar.contains(event.target) && !adminMenuButton.contains(event.target)) {
    setAdminSidebarOpen(false);
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && isNarrowAdminLayout() && adminSidebar.classList.contains('open')) {
    setAdminSidebarOpen(false);
  }
});
window.addEventListener('resize', () => {
  const open = isNarrowAdminLayout()
    ? adminSidebar.classList.contains('open')
    : !adminShell.classList.contains('sidebar-collapsed');
  adminMenuButton.setAttribute('aria-expanded', String(open));
  adminMenuButton.setAttribute('aria-label', open ? 'إخفاء القائمة' : 'إظهار القائمة');
});
adminMenuButton.setAttribute('aria-expanded', String(!isNarrowAdminLayout()));
adminMenuButton.setAttribute('aria-label', isNarrowAdminLayout() ? 'إظهار القائمة' : 'إخفاء القائمة');
$('#logoutButton').addEventListener('click', () => { localStorage.removeItem(tokenKey); localStorage.removeItem('orbit-admin-user'); showLogin(); });
$('#adminCreateButton').addEventListener('click', () => {
  $('#adminCreateError').textContent = '';
  $('#adminCreateForm').reset();
  $('#adminCreateModal').classList.remove('hidden');
  $('#adminCreateForm [name="name"]').focus();
});
$('#closeAdminCreate').addEventListener('click', () => $('#adminCreateModal').classList.add('hidden'));
$('#adminCreateForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const password = String(form.get('password') || '');
  if (password.length < 10) {
    $('#adminCreateError').textContent = 'كلمة المرور يجب ألا تقل عن ١٠ أحرف';
    return;
  }
  if (password !== form.get('passwordConfirm')) {
    $('#adminCreateError').textContent = 'كلمتا المرور غير متطابقتين';
    return;
  }
  try {
    await request('/admin/admins', { method: 'POST', body: JSON.stringify({ name: form.get('name'), phone: form.get('phone'), password, scope: form.get('scope') }) });
    $('#adminCreateModal').classList.add('hidden');
    await loadDashboard();
    $('#userRoleFilter').value = 'admin';
    renderUsers();
    toast('تم إنشاء الحساب، وهو الآن قيد المراجعة');
  } catch (error) {
    $('#adminCreateError').textContent = error.message;
  }
});

document.addEventListener('change', async (event) => {
  const statusSelect = event.target.closest('[data-order-status]');
  if (!statusSelect?.value) return;
  if (statusSelect.value === 'cancelled' && !confirm('هل تريد إلغاء الطلب وإرجاع الكمية للمخزون؟')) { statusSelect.value = ''; return; }
  try { await request(`/admin/store/orders/${encodeURIComponent(statusSelect.dataset.orderStatus)}/status`, { method: 'PATCH', body: JSON.stringify({ status: statusSelect.value }) }); await loadDashboard(); toast('تم تحديث حالة الطلب'); }
  catch (error) { toast(error.message); }
});

document.addEventListener('click', async (event) => {
  const markRead = event.target.closest('[data-read-notification]');
  if (!markRead) return;
  try { await request(`/store/notifications/${encodeURIComponent(markRead.dataset.readNotification)}/read`, { method: 'PATCH', body: JSON.stringify({}) }); await loadDashboard(); }
  catch (error) { toast(error.message); }
});

$('#closeReport').addEventListener('click', () => $('#reportModal').classList.add('hidden'));
$('[data-refresh]').addEventListener('click', () => loadDashboard().then(() => toast('تم تحديث لوحة الإدارة')));
$('[data-filter-pending]').addEventListener('click', () => { $('#listingStatusFilter').value = 'pending'; renderListings(); document.querySelector('#listings').scrollIntoView({ behavior: 'smooth' }); });
$('[data-export]').addEventListener('click', () => { const csv = ['العملية,المبلغ,التاريخ', ...transactions.map((item) => `"${item.type}","${item.amount || 0}","${item.created_at}"`)].join('\n'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })); link.download = 'astra-transactions.csv'; link.click(); });

document.addEventListener('click', async (event) => {
  const reportCategory = event.target.closest('[data-report-category]');
  if (reportCategory && activeReportData) {
    renderAccountReport(reportCategory.dataset.reportCategory);
    return;
  }
  const orderStatus = event.target.closest('[data-order-status]');
  if (orderStatus?.value) {
    if (orderStatus.value === 'cancelled' && !confirm('هل تريد إلغاء الطلب وإرجاع الكمية للمخزون؟')) { orderStatus.value = ''; return; }
    try { await request(`/admin/store/orders/${orderStatus.dataset.orderStatus}/status`, { method: 'PATCH', body: JSON.stringify({ status: orderStatus.value }) }); await loadDashboard(); toast('تم تحديث حالة الطلب'); }
    catch (error) { toast(error.message); }
    return;
  }
  const assign = event.target.closest('[data-assign-order]');
  if (assign) {
    const selected = $(`[data-order-agent="${CSS.escape(assign.dataset.assignOrder)}"]`);
    if (!selected?.value) return toast('اختر مندوبًا أولًا');
    try { await request(`/admin/store/orders/${assign.dataset.assignOrder}/assign`, { method: 'POST', body: JSON.stringify({ agentId: selected.value }) }); await loadDashboard(); toast('تم تعيين المندوب وإرسال إشعار'); }
    catch (error) { toast(error.message); }
    return;
  }
  const saveProduct = event.target.closest('[data-save-product]');
  if (saveProduct) {
    const product = commerceProducts.find((item) => item.id === saveProduct.dataset.saveProduct);
    const status = $(`[data-product-status="${CSS.escape(saveProduct.dataset.saveProduct)}"]`)?.value;
    if (status === 'archived' && !confirm('أرشفة المنتج ستوقف ظهوره والشراء منه. هل تريد المتابعة؟')) return;
    try { await request(`/admin/store/products/${product.id}`, { method: 'PATCH', body: JSON.stringify({ name: product.name, description: product.description, price: product.price, salePrice: product.sale_price, costPrice: product.cost_price, stock: product.stock, categoryId: product.category_id, featured: product.featured, status }) }); await loadCommerceDashboard(); toast('تم تحديث المنتج'); }
    catch (error) { toast(error.message); }
    return;
  }
  const customerStatus = event.target.closest('[data-customer-status]');
  if (customerStatus) {
    const status = customerStatus.dataset.nextStatus;
    if (status === 'suspended' && !confirm('سيتم منع العميل من تسجيل الدخول. هل تريد المتابعة؟')) return;
    try { await request(`/admin/store/customers/${customerStatus.dataset.customerStatus}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); await loadCommerceDashboard(); toast('تم تحديث حالة العميل'); }
    catch (error) { toast(error.message); }
    return;
  }
  const reviewProof = event.target.closest('[data-review-proof]');
  if (reviewProof) {
    const action = reviewProof.dataset.decision;
    const message = action === 'approve' ? 'اعتماد الدفع يؤكد وصول المبلغ ويبدأ تجهيز الطلب. هل تحققت من العملية؟' : 'رفض إثبات الدفع؟';
    if (!confirm(message)) return;
    try { await request(`/admin/store/proofs/${reviewProof.dataset.reviewProof}/review`, { method: 'PATCH', body: JSON.stringify({ action }) }); await loadDashboard(); toast(action === 'approve' ? 'تم تأكيد الدفع وإرسال إشعار' : 'تم رفض الإثبات'); }
    catch (error) { toast(error.message); }
    return;
  }
  const productReview = event.target.closest('[data-review-product]');
  if (productReview) {
    const status = productReview.dataset.reviewStatus;
    if (status === 'rejected' && !confirm('رفض هذا التقييم؟')) return;
    try { await request(`/admin/store/reviews/${encodeURIComponent(productReview.dataset.reviewProduct)}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await loadDashboard(); toast(status === 'approved' ? 'تم نشر التقييم' : 'تم رفض التقييم'); }
    catch (error) { toast(error.message); }
    return;
  }
  const viewProof = event.target.closest('[data-view-proof]');
  if (viewProof) {
    try {
      const response = await fetch(`${API}/store/proofs/${encodeURIComponent(viewProof.dataset.viewProof)}/image`, { headers: { Authorization: `Bearer ${localStorage.getItem(tokenKey) || ''}` } });
      if (!response.ok) throw new Error('تعذر فتح الإيصال');
      const url = URL.createObjectURL(await response.blob());
      $('#reportTitle').textContent = 'صورة إثبات التحويل';
      $('#reportList').innerHTML = `<img class="proof-preview" src="${url}" alt="إيصال التحويل" />`;
      $('#reportModal').classList.remove('hidden');
    } catch (error) { toast(error.message); }
    return;
  }
  const exportCommerce = event.target.closest('[data-export-commerce]');
  if (exportCommerce) {
    const rows = exportCommerce.dataset.exportCommerce === 'orders' ? commerceOrders : (commerceReport.monthlySales || []);
    if (!rows.length) return toast('لا توجد بيانات لتصديرها');
    const keys = Object.keys(rows[0]);
    const csv = [keys.join(','), ...rows.map((row) => keys.map((key) => `"${String(row[key] ?? '').replaceAll('"', '""')}"`).join(','))].join('\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })); link.download = `${exportCommerce.dataset.exportCommerce}-astra.csv`; link.click(); URL.revokeObjectURL(link.href);
    return;
  }
  const report = event.target.closest('[data-report]');
  if (report) {
    try {
      const user = users.find((item) => item.id === report.dataset.report);
      activeReportData = await request(`/admin/reports/${report.dataset.report}`);
      $('#reportTitle').textContent = `تقرير ${user?.name || 'الحساب'}`;
      $('#reportModal').classList.remove('hidden');
      renderAccountReport('transactions');
    } catch (error) { toast(error.message); }
    return;
  }
  const userReview = event.target.closest('[data-user-review]');
  if (userReview) {
    const action = userReview.dataset.reviewAction;
    if (action === 'cancel' && !confirm('سيتم إيقاف الحساب ومنع صاحبه من الدخول. هل تريد المتابعة؟')) return;
    try {
      await request(`/admin/users/${encodeURIComponent(userReview.dataset.userReview)}/review`, { method: 'PATCH', body: JSON.stringify({ action }) });
      await loadDashboard();
      toast(action === 'approve' ? 'تم السماح للحساب بالاستمرار' : 'تم إلغاء الحساب وإيقافه');
    } catch (error) { toast(error.message); }
    return;
  }
  const remove = event.target.closest('[data-delete]');
  if (remove && confirm('هل تريد حذف هذا المستخدم ونقل رصيده إلى المشرف؟')) {
    try { await request(`/admin/users/${remove.dataset.delete}`, { method: 'DELETE' }); await loadDashboard(); toast('تم حذف المستخدم ونقل رصيده'); } catch (error) { toast(error.message); }
  }
  const statusButton = event.target.closest('[data-user-status]');
  if (statusButton) {
    try { await request(`/admin/users/${statusButton.dataset.userStatus}/status`, { method: 'PATCH', body: JSON.stringify({ status: statusButton.dataset.statusNext }) }); await loadDashboard(); toast('تم تحديث حالة الحساب'); } catch (error) { toast(error.message); }
  }
  const listingStatus = event.target.closest('[data-listing-status]');
  if (listingStatus) {
    try { await request(`/admin/listings/${listingStatus.dataset.listingId}/status`, { method: 'PATCH', body: JSON.stringify({ status: listingStatus.dataset.listingStatus }) }); await loadDashboard(); toast('تم تحديث حالة الإعلان'); } catch (error) { toast(error.message); }
  }
});

document.addEventListener('change', async (event) => {
  const toggle = event.target.closest('[data-listing-review]');
  if (!toggle) return;
  try {
    await request(`/admin/users/${encodeURIComponent(toggle.dataset.listingReview)}/listing-review`, { method: 'PATCH', body: JSON.stringify({ required: toggle.checked }) });
    await loadDashboard();
    toast(toggle.checked ? 'سيتم مراجعة إعلانات الحساب قبل النشر' : 'ستنشر إعلانات الحساب تلقائيًا');
  } catch (error) {
    toggle.checked = !toggle.checked;
    toast(error.message);
  }
});

window.lucide?.createIcons();
if (localStorage.getItem(tokenKey)) loadDashboard().catch(() => showLogin('انتهت جلسة المشرف')); else showLogin();

const API = '/api';
const TOKEN_KEY = 'orbit-courier-token';
const USER_KEY = 'orbit-courier-user';
const $ = (selector, parent = document) => parent.querySelector(selector);
const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const money = (value) => `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م`;
const token = () => localStorage.getItem(TOKEN_KEY) || '';

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token()}`, ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'تعذر تنفيذ العملية');
  return data;
}

function toast(message) {
  const element = $('#courierToast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2600);
}

function setSignedIn(isSignedIn) {
  $('#courierLoginView').classList.toggle('hidden', isSignedIn);
  $('#courierDashboard').classList.toggle('hidden', !isSignedIn);
  $('#courierLogout').classList.toggle('hidden', !isSignedIn);
  const user = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  $('#courierName').textContent = isSignedIn ? user?.name || '' : '';
}

async function signIn(event) {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.currentTarget));
  const button = $('#courierLoginForm button[type="submit"]');
  button.disabled = true;
  $('#courierLoginError').textContent = '';
  try {
    const result = await api('/auth/login', { method: 'POST', body: JSON.stringify(form) });
    if (result.user.role !== 'courier') throw new Error('هذا الحساب ليس حساب مندوب');
    localStorage.setItem(TOKEN_KEY, result.token);
    localStorage.setItem(USER_KEY, JSON.stringify(result.user));
    setSignedIn(true);
    await loadOrders();
  } catch (error) { $('#courierLoginError').textContent = error.message; }
  finally { button.disabled = false; }
}

function renderStats(stats) {
  const values = [['طلبات جديدة', stats.assigned], ['مطلوب توصيلها اليوم', stats.today], ['قيد التوصيل', stats.outForDelivery], ['مكتملة', stats.completed], ['تعذر تسليمها', stats.failed]];
  $('#courierStats').innerHTML = values.map(([label, value]) => `<div class="courier-stat"><span>${label}</span><strong>${Number(value || 0).toLocaleString('ar-EG')}</strong></div>`).join('');
}

function renderOrder(order) {
  const status = order.order_status === 'out_for_delivery' ? 'warning' : order.order_status === 'failed_delivery' ? 'error' : 'success';
  const payment = order.payment || {};
  const isCod = payment.method === 'cod';
  const addressText = [order.city, order.area, order.line1].filter(Boolean).join('، ');
  const products = (order.items || []).map((item) => `<div class="delivery-item"><span>${escapeHTML(item.name)} × ${Number(item.quantity).toLocaleString('ar-EG')}</span><strong>${money(item.line_total)}</strong></div>`).join('');
  let actions = '';
  if (order.order_status === 'assigned' && order.shipping_status === 'assigned') actions = `<button class="button button-success" type="button" data-courier-action="accept" data-order="${escapeHTML(order.id)}">قبول الطلب</button><button class="button button-outline" type="button" data-courier-action="reject" data-order="${escapeHTML(order.id)}">رفض الطلب</button>`;
  if (order.order_status === 'assigned' && order.shipping_status === 'accepted') actions = `<button class="button button-primary" type="button" data-courier-action="start" data-order="${escapeHTML(order.id)}">بدء التوصيل ${'<i data-lucide="truck"></i>'}</button>`;
  if (order.order_status === 'out_for_delivery') actions = `<form class="delivery-complete-form" data-delivery-form="${escapeHTML(order.id)}"><input name="otp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required placeholder="رمز العميل" aria-label="رمز التسليم" />${isCod ? `<input name="collectedAmount" type="number" min="0" step="0.01" required placeholder="المبلغ المحصل: ${Number(order.total).toLocaleString('ar-EG')}" aria-label="المبلغ المحصل" />` : ''}<button class="button button-success" type="submit">تأكيد التسليم ${'<i data-lucide="circle-check"></i>'}</button></form><button class="button button-danger" type="button" data-courier-action="fail" data-order="${escapeHTML(order.id)}">تعذر التسليم</button>`;
  if (order.order_status === 'failed_delivery') actions = '<span class="status-pill error">سجلت الإدارة تعذر التسليم</span>';
  return `<article class="delivery-card"><div class="delivery-card-header"><div><h2>${escapeHTML(order.order_number)}</h2><p>العميل: ${escapeHTML(order.customer_name)} · ${new Date(order.created_at).toLocaleString('ar-EG')}</p></div><span class="status-pill ${status}">${statusLabel(order.order_status)}</span></div><div class="delivery-details"><section><h3>بيانات العميل والتوصيل</h3><p>${escapeHTML(order.customer_name)} · ${escapeHTML(order.customer_phone)}</p><p>${escapeHTML(addressText || 'العنوان غير متاح')}</p><p>ملاحظات: ${escapeHTML(order.delivery_notes || order.notes || 'لا توجد')}</p>${isCod ? `<p><strong>المبلغ المطلوب تحصيله: ${money(order.total)}</strong></p>` : `<p>حالة الدفع: ${escapeHTML(payment.status || order.payment_status)}</p>`}</section><section><h3>محتويات الطلب · ${money(order.total)}</h3><div class="delivery-items">${products || '<p>لا توجد تفاصيل للمنتجات.</p>'}</div></section></div><div class="delivery-actions"><a href="tel:${encodeURIComponent(order.customer_phone || '')}">${'<i data-lucide="phone"></i>'} اتصل بالعميل</a><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressText)}" target="_blank" rel="noopener">${'<i data-lucide="map-pin"></i>'} فتح الموقع</a>${actions}</div></article>`;
}

const statusNames = { assigned: 'طلب مسند', out_for_delivery: 'قيد التوصيل', failed_delivery: 'تعذر التسليم' };
function statusLabel(status) { return statusNames[status] || status; }

async function loadOrders() {
  if (!token()) { setSignedIn(false); return; }
  try {
    const [orders, stats] = await Promise.all([api('/courier/orders'), api('/courier/dashboard')]);
    renderStats(stats);
    $('#courierOrders').innerHTML = orders.length ? orders.map(renderOrder).join('') : '<div class="empty-state"><i data-lucide="package-check"></i><h2>لا توجد طلبات مسندة</h2><p>ستظهر الطلبات الجديدة هنا بعد تعيينها لك.</p></div>';
    window.lucide?.createIcons();
  } catch (error) {
    if (error.message.includes('جلسة') || error.message.includes('الحساب غير نشط')) { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); setSignedIn(false); }
    toast(error.message);
  }
}

async function submitDelivery(event) {
  event.preventDefault();
  const formElement = event.target;
  const form = Object.fromEntries(new FormData(formElement));
  const orderId = formElement.dataset.deliveryForm;
  const button = formElement.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api(`/courier/orders/${encodeURIComponent(orderId)}/deliver`, { method: 'POST', body: JSON.stringify({ otp: form.otp, collectedAmount: form.collectedAmount ? Number(form.collectedAmount) : undefined }) });
    toast('تم تأكيد التسليم وتسجيل التحصيل');
    await loadOrders();
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}

$('#courierLoginForm').addEventListener('submit', signIn);
$('#courierRefresh').addEventListener('click', loadOrders);
$('#courierLogout').addEventListener('click', () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); setSignedIn(false); });
$('#failureForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const values = new FormData(formElement);
  const reason = `${values.get('reason')}${values.get('detail') ? `: ${values.get('detail')}` : ''}`;
  try { await api(`/courier/orders/${encodeURIComponent(values.get('orderId'))}/fail`, { method: 'POST', body: JSON.stringify({ reason }) }); $('#failureModal').classList.add('hidden'); formElement.reset(); toast('تم تسجيل تعذر التسليم وإبلاغ الإدارة'); await loadOrders(); }
  catch (error) { toast(error.message); }
});
$('[data-close-failure]').addEventListener('click', () => $('#failureModal').classList.add('hidden'));
$('#failureModal').addEventListener('click', (event) => { if (event.target === $('#failureModal')) $('#failureModal').classList.add('hidden'); });

document.addEventListener('submit', (event) => { if (event.target.matches('[data-delivery-form]')) submitDelivery(event); });
document.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-courier-action]');
  if (!action) return;
  const orderId = action.dataset.order;
  if (action.dataset.courierAction === 'reject' || action.dataset.courierAction === 'fail') {
    $('#failureForm [name="orderId"]').value = orderId;
    $('#failureForm').reset();
    $('#failureForm [name="orderId"]').value = orderId;
    $('#failureModal').classList.remove('hidden');
    return;
  }
  const route = action.dataset.courierAction === 'start' ? `/courier/orders/${encodeURIComponent(orderId)}/start` : `/courier/orders/${encodeURIComponent(orderId)}/respond`;
  const body = action.dataset.courierAction === 'accept' ? { action: 'accept' } : {};
  action.disabled = true;
  try { await api(route, { method: action.dataset.courierAction === 'start' ? 'POST' : 'PATCH', body: JSON.stringify(body) }); toast(action.dataset.courierAction === 'accept' ? 'تم قبول الطلب' : 'بدأت رحلة التوصيل'); await loadOrders(); }
  catch (error) { toast(error.message); }
  finally { action.disabled = false; }
});

window.lucide?.createIcons();
if (token()) {
  try {
    const currentUser = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    if (currentUser?.role === 'courier') { setSignedIn(true); loadOrders(); }
    else { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); setSignedIn(false); }
  } catch { setSignedIn(false); }
} else setSignedIn(false);

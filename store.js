const API = '/api';
if (new URLSearchParams(location.search).get('embedded') === '1') document.body.classList.add('embedded-store');
const TOKEN_KEY = 'orbit-store-token';
const USER_KEY = 'orbit-store-user';
const GUEST_CART_KEY = 'orbit-guest-cart';
const FAVORITES_KEY = 'orbit-store-favorites';
const state = {
  categories: [], products: [], shippingMethods: [], addresses: [], cart: [], favorites: [],
  page: 'home', query: '', selectedCategory: '', selectedProduct: null,
  detailQuantity: 1, selectedOrder: null, coupon: '', couponDiscount: 0,
  lastOrder: null, dealsOnly: false, authMode: 'login', returnPage: 'home',
};
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const money = (value) => `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م`;
const token = () => localStorage.getItem(TOKEN_KEY) || '';
const user = () => { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } };
const icon = (name) => `<i data-lucide="${name}"></i>`;

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...(options.headers || {}) },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'تعذر إتمام العملية. حاول مرة أخرى.');
  return result;
}

function toast(message) {
  const element = $('#shopToast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2800);
}

function setRoute(route, replace = false) {
  if (replace) history.replaceState(null, '', `#${route}`);
  else location.hash = route;
}

function routeFromHash() {
  const route = decodeURIComponent(location.hash.slice(1) || 'home');
  const [page, id] = route.split('/');
  state.page = page === 'deals' ? 'products' : page;
  state.dealsOnly = page === 'deals';
  if (page === 'product') state.selectedProduct = id || '';
  if (page === 'order') state.selectedOrder = id || '';
  if (page === 'success') state.selectedOrder = id || '';
  const pages = ['home', 'categories', 'products', 'favorites', 'product', 'cart', 'checkout', 'success', 'orders', 'order', 'profile', 'forgot', 'contact', 'faq', 'terms', 'privacy', 'error'];
  if (!pages.includes(state.page)) state.page = 'home';
  $$('.shop-page').forEach((section) => section.classList.toggle('hidden', section.dataset.page !== state.page));
  $$('.shop-nav a').forEach((link) => link.classList.toggle('active', link.dataset.route === state.page || (state.page === 'products' && link.dataset.route === 'products')));
  $('#shopNav').classList.remove('open');
  if (state.page === 'products') renderCatalog();
  if (state.page === 'categories') renderCategories();
  if (state.page === 'favorites') renderFavorites();
  if (state.page === 'product') renderProductDetails(state.selectedProduct);
  if (state.page === 'cart') renderCart();
  if (state.page === 'checkout') prepareCheckout();
  if (state.page === 'success') renderOrderSuccess();
  if (state.page === 'orders') renderOrders();
  if (state.page === 'order') renderOrderDetails(state.selectedOrder);
  if (state.page === 'profile') renderProfile();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function imageMarkup(product, className = '') {
  const image = product.images?.[0] || product.image_url || '';
  return image
    ? `<img class="${className}" src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" loading="lazy" />`
    : `<div class="product-placeholder ${className}">${icon('package')}</div>`;
}

function priceMarkup(product) {
  const current = Number(product.sale_price || product.price || 0);
  const old = product.sale_price && Number(product.sale_price) < Number(product.price);
  const discount = old ? Math.round((1 - current / Number(product.price)) * 100) : 0;
  return `<div class="product-price-row"><strong class="product-price">${money(current)}</strong>${old ? `<del class="old-price">${money(product.price)}</del>` : ''}</div>${discount ? `<span class="product-badge">خصم ${discount}٪</span>` : ''}`;
}

function productCard(product) {
  const favorite = state.favorites.includes(product.id);
  const out = Number(product.stock) <= 0;
  const image = product.images?.[0] || '';
  const discount = product.sale_price && Number(product.sale_price) < Number(product.price)
    ? Math.round((1 - Number(product.sale_price) / Number(product.price)) * 100) : 0;
  return `<article class="product-card">
    <div class="product-photo" data-open-product="${escapeHtml(product.slug)}">
      ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" loading="lazy" />` : `<div class="product-placeholder">${icon('package')}</div>`}
      ${discount ? `<span class="product-badge">خصم ${discount}٪</span>` : ''}
      <button class="wishlist-button ${favorite ? 'active' : ''}" type="button" data-favorite="${escapeHtml(product.id)}" aria-label="${favorite ? 'إزالة من المفضلة' : 'أضف للمفضلة'}">${icon('heart')}</button>
    </div>
    <div class="product-copy">
      <span class="product-category">${escapeHtml(product.category_name || 'منتجات ASTRA')}</span>
      <button class="product-name" type="button" data-open-product="${escapeHtml(product.slug)}">${escapeHtml(product.name)}</button>
      <div class="product-rating">${icon('star')} ${Number(product.average_rating || 0).toLocaleString('ar-EG', { maximumFractionDigits: 1 })}<small>(${Number(product.review_count || 0).toLocaleString('ar-EG')})</small></div>
      ${priceMarkup(product)}
      <div class="product-actions"><button class="button button-primary" type="button" data-add-cart="${escapeHtml(product.id)}" ${out ? 'disabled' : ''}>${icon('shopping-bag')} ${out ? 'غير متوفر' : 'أضف للسلة'}</button><button class="button button-outline icon-only" type="button" data-open-product="${escapeHtml(product.slug)}" aria-label="تفاصيل المنتج">${icon('arrow-up-left')}</button></div>
    </div>
  </article>`;
}

function emptyState(title, text, action = '') {
  return `<div class="empty-state">${icon('package-search')}<h2>${escapeHtml(title)}</h2><p>${escapeHtml(text)}</p>${action}</div>`;
}

async function fetchProducts(params = {}) {
  const search = new URLSearchParams();
  if (params.query) search.set('q', params.query);
  if (params.category) search.set('category', params.category);
  if (params.featured) search.set('featured', 'true');
  search.set('limit', '60');
  const response = await api(`/store/products?${search}`);
  let products = response.items || [];
  if (params.sort === 'price-low') products.sort((a, b) => Number(a.sale_price || a.price) - Number(b.sale_price || b.price));
  if (params.sort === 'price-high') products.sort((a, b) => Number(b.sale_price || b.price) - Number(a.sale_price || a.price));
  if (params.dealsOnly) products = products.filter((item) => item.sale_price && Number(item.sale_price) < Number(item.price));
  return products;
}

async function renderCatalog() {
  $('#productsHeading').textContent = state.dealsOnly ? 'العروض' : state.selectedCategory ? state.categories.find((item) => item.slug === state.selectedCategory)?.name || 'المنتجات' : 'المنتجات';
  $('#categoryFilter').value = state.selectedCategory;
  $('#searchTerm').textContent = state.query ? `نتائج البحث عن: ${state.query}` : '';
  $('#searchTerm').classList.toggle('hidden', !state.query);
  $('#catalogProducts').innerHTML = emptyState('جاري تحميل المنتجات', 'لحظة واحدة...');
  try {
    const products = await fetchProducts({ query: state.query, category: state.selectedCategory, sort: $('#sortFilter').value, dealsOnly: state.dealsOnly });
    $('#resultCount').textContent = `${products.length.toLocaleString('ar-EG')} منتج`;
    $('#catalogProducts').innerHTML = products.length ? products.map(productCard).join('') : emptyState('لا توجد منتجات مطابقة', 'جرّب تغيير البحث أو التصنيف.', '<a class="button button-outline" href="/orbit-1.html#market-listings">اطلب منتجًا غير موجود</a>');
    lucide.createIcons();
  } catch (error) { $('#catalogProducts').innerHTML = emptyState('تعذر تحميل المنتجات', error.message, '<button class="button button-outline" data-retry>إعادة المحاولة</button>'); }
}

function renderCategories() {
  const markup = state.categories.length ? state.categories.map((category) => `<button class="category-card" type="button" data-category="${escapeHtml(category.slug)}"><span class="category-icon">${category.image_url ? `<img src="${escapeHtml(category.image_url)}" alt="" loading="lazy" />` : icon('grid-2x2')}</span><strong>${escapeHtml(category.name)}</strong></button>`).join('') : emptyState('التصنيفات قيد التجهيز', 'ستظهر التصنيفات هنا عند إضافة المنتجات.');
  $('#homeCategoryList').innerHTML = markup;
  $('#allCategoryList').innerHTML = markup;
  $('#categoryFilter').innerHTML = '<option value="">كل التصنيفات</option>' + state.categories.map((category) => `<option value="${escapeHtml(category.slug)}">${escapeHtml(category.name)}</option>`).join('');
}

async function renderHome() {
  try {
    const products = await fetchProducts({ featured: true });
    $('#featuredProducts').innerHTML = products.length ? products.slice(0, 8).map(productCard).join('') : emptyState('نجهز اختياراتنا', 'ستظهر المنتجات المميزة هنا قريبًا.');
    $('#popularProducts').innerHTML = products.length ? products.slice(0, 4).map(productCard).join('') : emptyState('لا توجد منتجات بعد', 'أضف منتجات من لوحة الإدارة لتبدأ المبيعات.');
    lucide.createIcons();
  } catch {
    $('#featuredProducts').innerHTML = emptyState('تعذر تحميل المنتجات', 'تحقق من الاتصال وحاول مرة أخرى.');
  }
}

function favoriteProducts() {
  const ids = new Set(state.favorites);
  return state.products.filter((product) => ids.has(product.id));
}

async function renderFavorites() {
  try {
    state.products = await fetchProducts();
    const products = favoriteProducts();
    $('#favoriteProducts').innerHTML = products.length ? products.map(productCard).join('') : emptyState('قائمة المفضلة فارغة', 'احفظ المنتجات التي أعجبتك لتعود إليها لاحقًا.', '<a class="button button-primary" href="#products" data-route="products">تصفح المنتجات</a>');
    lucide.createIcons();
  } catch (error) { $('#favoriteProducts').innerHTML = emptyState('تعذر تحميل المفضلة', error.message); }
}

async function renderProductDetails(slug) {
  const container = $('#productDetails');
  container.innerHTML = emptyState('جاري تحميل المنتج', 'لحظة واحدة...');
  try {
    const product = await api(`/store/products/${encodeURIComponent(slug)}`);
    state.selectedProduct = product;
    state.detailQuantity = 1;
    const images = product.images?.length ? product.images : [''];
    const first = images[0];
    container.innerHTML = `<div class="product-detail"><div class="detail-gallery"><div class="detail-main-image">${first ? `<img id="detailMainImage" src="${escapeHtml(first)}" alt="${escapeHtml(product.name)}" />` : `<div class="product-placeholder">${icon('package')}</div>`}</div><div class="detail-thumbnails">${images.filter(Boolean).map((image) => `<button type="button" data-gallery-image="${escapeHtml(image)}"><img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" /></button>`).join('')}</div></div><div class="detail-information"><span class="eyebrow">${escapeHtml(product.category_name || 'منتجات ASTRA')}</span><h1>${escapeHtml(product.name)}</h1><div class="product-rating">${icon('star')} ${Number(product.average_rating || 0).toLocaleString('ar-EG', { maximumFractionDigits: 1 })}<small>(${Number(product.review_count || 0)} تقييم)</small></div><div class="detail-price">${priceMarkup(product)}</div><p>${escapeHtml(product.description || 'تفاصيل المنتج ستضاف قريبًا.')}</p><span class="detail-stock ${product.stock <= 0 ? 'out' : ''}">${product.stock > 0 ? `متوفر · ${Number(product.stock).toLocaleString('ar-EG')} قطعة` : 'غير متوفر حاليًا'}</span><div class="detail-actions"><div class="quantity-control"><button type="button" data-detail-quantity="-1" aria-label="تقليل الكمية">${icon('minus')}</button><output id="detailQuantity">١</output><button type="button" data-detail-quantity="1" aria-label="زيادة الكمية">${icon('plus')}</button></div><button class="button button-primary" type="button" data-detail-add ${product.stock <= 0 ? 'disabled' : ''}>${icon('shopping-bag')} أضف للسلة</button><button class="button button-outline" type="button" data-favorite="${escapeHtml(product.id)}" aria-label="المفضلة">${icon('heart')}</button></div><div class="detail-meta"><div>${icon('truck')} الشحن يظهر بوضوح عند إتمام الطلب</div><div>${icon('rotate-ccw')} للاستفسار عن الاسترجاع تواصل مع خدمة العملاء</div><div>${icon('barcode')} رمز المنتج: ${escapeHtml(product.sku)}</div></div></div></div><section class="shop-section"><div class="section-title"><div><span class="eyebrow">اختيارات قريبة</span><h2>منتجات مشابهة</h2></div></div><div class="product-grid" id="relatedProducts"></div></section>`;
    const related = await fetchProducts({ category: product.category_slug });
    $('#relatedProducts').innerHTML = related.filter((item) => item.id !== product.id).slice(0, 4).map(productCard).join('') || emptyState('اكتشف باقي المنتجات', '');
      const reviews = await api(`/store/products/${encodeURIComponent(product.slug)}/reviews`);
      let eligibleOrders = [];
      if (token() && user()?.role === 'customer') {
        const orders = await api('/store/orders');
        eligibleOrders = orders.filter((order) => order.order_status === 'delivered' && order.items?.some((item) => item.product_id === product.id));
      }
      const reviewForm = eligibleOrders.length
        ? `<form id="productReviewForm" data-product-id="${escapeHtml(product.id)}" class="review-submit-form"><label>طلب مستلم<select name="orderId" required>${eligibleOrders.map((order) => `<option value="${escapeHtml(order.id)}">${escapeHtml(order.order_number)}</option>`).join('')}</select></label><label>تقييمك<select name="rating" required><option value="5">٥ نجوم</option><option value="4">٤ نجوم</option><option value="3">٣ نجوم</option><option value="2">نجمتان</option><option value="1">نجمة واحدة</option></select></label><label>مراجعتك<textarea name="text" maxlength="1000" rows="3" placeholder="شارك تجربتك"></textarea></label><button class="button button-primary" type="submit">إرسال التقييم للمراجعة</button></form>`
        : token() ? '<p class="review-hint">يمكنك تقييم المنتج بعد استلامه.</p>' : '<button class="button button-outline" type="button" data-open-shop-auth>سجل الدخول لتقييم المنتج</button>';
      container.insertAdjacentHTML('beforeend', `<section class="reviews-section"><div class="section-title"><div><span class="eyebrow">تجارب العملاء</span><h2>التقييمات</h2></div></div><div class="review-list">${reviews.length ? reviews.map((review) => `<article class="review-item"><div><strong>${escapeHtml(review.customer_name)}</strong><span>${'★'.repeat(Number(review.rating))}</span></div><p>${escapeHtml(review.text || 'تقييم بدون تعليق')}</p><time>${new Date(review.created_at).toLocaleDateString('ar-EG')}</time></article>`).join('') : '<div class="empty-state">لا توجد تقييمات منشورة بعد.</div>'}</div>${reviewForm}</section>`);
    lucide.createIcons();
  } catch (error) { container.innerHTML = emptyState('المنتج غير متاح', error.message, '<a class="button button-outline" href="#products" data-route="products">رجوع للمنتجات</a>'); }
}

function getGuestCart() {
  try { return JSON.parse(localStorage.getItem(GUEST_CART_KEY) || '[]'); } catch { return []; }
}

async function loadCart() {
  if (token() && user()?.role === 'customer') {
    try { state.cart = (await api('/store/cart')).items || []; return state.cart; }
    catch (error) { if (!String(error.message).includes('تسجيل الدخول')) throw error; }
  }
  const guest = getGuestCart();
  if (!guest.length) { state.cart = []; return state.cart; }
  const products = await fetchProducts();
  state.cart = guest.map((line) => {
    const product = products.find((item) => item.id === line.product_id);
    return product ? { ...product, product_id: product.id, quantity: line.quantity, unit_price: Number(product.sale_price || product.price), line_total: Number(product.sale_price || product.price) * line.quantity } : null;
  }).filter(Boolean);
  return state.cart;
}

async function updateCartBadge() {
  try { await loadCart(); } catch { state.cart = []; }
  const count = state.cart.reduce((sum, item) => sum + Number(item.quantity), 0);
  $('#cartCount').textContent = count.toLocaleString('ar-EG');
  $('#favoriteCount').textContent = state.favorites.length.toLocaleString('ar-EG');
  $('#favoriteCount').classList.toggle('hidden', !state.favorites.length);
  $('#accountLabel').textContent = user()?.name?.split(' ')[0] || 'دخول';
}

async function addToCart(productId, quantity = 1) {
  try {
    if (token() && user()?.role === 'customer') {
      const current = await api('/store/cart');
      const existing = current.items.find((item) => item.product_id === productId);
      await api(`/store/cart/items/${encodeURIComponent(productId)}`, { method: 'PUT', body: JSON.stringify({ quantity: Number(existing?.quantity || 0) + quantity }) });
    } else {
      const items = getGuestCart();
      const existing = items.find((item) => item.product_id === productId);
      if (existing) existing.quantity += quantity;
      else items.push({ product_id: productId, quantity });
      localStorage.setItem(GUEST_CART_KEY, JSON.stringify(items));
    }
    await updateCartBadge();
    toast('اتضاف المنتج للسلة');
  } catch (error) { toast(error.message); }
}

async function setCartQuantity(productId, quantity) {
  try {
    if (token() && user()?.role === 'customer') {
      await api(`/store/cart/items/${encodeURIComponent(productId)}`, { method: 'PUT', body: JSON.stringify({ quantity }) });
    } else {
      const items = getGuestCart().filter((item) => item.product_id !== productId || quantity > 0);
      if (quantity > 0) {
        const existing = items.find((item) => item.product_id === productId);
        if (existing) existing.quantity = quantity;
      }
      localStorage.setItem(GUEST_CART_KEY, JSON.stringify(items));
    }
    await renderCart();
    await updateCartBadge();
  } catch (error) { toast(error.message); }
}

async function renderCart() {
  try {
    await loadCart();
    const items = state.cart;
    $('#cartItems').innerHTML = items.length ? items.map((item) => `<article class="cart-line"><div>${imageMarkup(item)}</div><div><h3>${escapeHtml(item.name)}</h3><p>${money(item.unit_price)} · ${escapeHtml(item.sku || '')}</p><div class="quantity-control"><button type="button" data-cart-quantity="-1" data-product-id="${escapeHtml(item.product_id)}" aria-label="تقليل الكمية">${icon('minus')}</button><output>${Number(item.quantity).toLocaleString('ar-EG')}</output><button type="button" data-cart-quantity="1" data-product-id="${escapeHtml(item.product_id)}" aria-label="زيادة الكمية">${icon('plus')}</button></div></div><div class="cart-line-actions"><strong>${money(item.line_total)}</strong><button class="link-danger" type="button" data-remove-cart="${escapeHtml(item.product_id)}">${icon('trash-2')} حذف</button></div></article>`).join('') : emptyState('سلتك لسه فاضية', 'اختار المنتجات اللي محتاجها وهنجمعها هنا.', '<a class="button button-primary" href="#products" data-route="products">تصفح المنتجات</a>');
    const subtotal = items.reduce((sum, item) => sum + Number(item.line_total), 0);
    $('#cartSummary').innerHTML = `<h2>ملخص السلة</h2><div class="summary-row"><span>الإجمالي الفرعي</span><strong>${money(subtotal)}</strong></div><div class="summary-row"><span>الشحن</span><span>يُحسب في الخطوة التالية</span></div><div class="summary-row summary-total"><span>الإجمالي</span><strong>${money(subtotal)}</strong></div><button class="button button-primary" type="button" data-route="checkout" ${items.length ? '' : 'disabled'}>إتمام الطلب ${icon('arrow-left')}</button>`;
    lucide.createIcons();
  } catch (error) { $('#cartItems').innerHTML = emptyState('تعذر تحميل السلة', error.message); }
}

async function prepareCheckout() {
  if (!user() || user().role !== 'customer') { state.returnPage = 'checkout'; openAuth('login'); return; }
  try {
    if (getGuestCart().length) {
      const guest = getGuestCart();
      const products = await fetchProducts();
      for (const line of guest) {
        if (products.some((product) => product.id === line.product_id)) {
          const current = state.cart.find((item) => item.product_id === line.product_id)?.quantity || 0;
          await api(`/store/cart/items/${encodeURIComponent(line.product_id)}`, { method: 'PUT', body: JSON.stringify({ quantity: current + line.quantity }) });
        }
      }
      localStorage.removeItem(GUEST_CART_KEY);
    }
    await loadCart();
    [state.shippingMethods, state.addresses] = await Promise.all([api('/store/shipping-methods'), api('/store/addresses')]);
    $('#savedAddressSelect').innerHTML = '<option value="">إدخال عنوان جديد</option>' + state.addresses.map((address) => `<option value="${escapeHtml(address.id)}">${escapeHtml(address.recipient_name)} · ${escapeHtml(address.city)} · ${escapeHtml(address.line1)}</option>`).join('');
    $('#shippingChoices').innerHTML = state.shippingMethods.map((method, index) => `<label class="choice-row"><input type="radio" name="shippingMethodId" value="${escapeHtml(method.id)}" ${index === 0 ? 'checked' : ''} /><span><strong>${escapeHtml(method.name)}</strong><small>${money(method.price)}</small></span>${icon('truck')}</label>`).join('') || '<p>لا توجد طرق شحن متاحة حاليًا.</p>';
    const defaultAddress = state.addresses.find((address) => address.is_default);
    $('#savedAddressSelect').value = defaultAddress?.id || '';
    $('#checkoutForm [name="recipient_name"]').value = defaultAddress?.recipient_name || user().name || '';
    ['phone', 'city', 'area', 'line1', 'notes'].forEach((key) => { $('#checkoutForm').elements[key].value = defaultAddress?.[key] || ''; });
    $('#checkoutSummary').innerHTML = checkoutSummary();
    lucide.createIcons();
  } catch (error) { toast(error.message); }
}

function checkoutSummary() {
  const subtotal = state.cart.reduce((sum, item) => sum + Number(item.line_total), 0);
  const shipping = Number(state.shippingMethods.find((method) => method.id === $('[name="shippingMethodId"]:checked')?.value)?.price || state.shippingMethods[0]?.price || 0);
  const total = Math.max(0, subtotal - state.couponDiscount + shipping);
  return `<h2>مراجعة الطلب</h2>${state.cart.map((item) => `<div class="summary-row"><span>${escapeHtml(item.name)} × ${Number(item.quantity).toLocaleString('ar-EG')}</span><strong>${money(item.line_total)}</strong></div>`).join('')}<div class="summary-row"><span>الإجمالي الفرعي</span><strong>${money(subtotal)}</strong></div><div class="summary-row"><span>الخصم</span><strong>-${money(state.couponDiscount)}</strong></div><div class="summary-row"><span>الشحن</span><strong>${money(shipping)}</strong></div><div class="summary-row summary-total"><span>الإجمالي</span><strong>${money(total)}</strong></div>`;
}

async function applyCoupon() {
  if (!token()) return openAuth('login');
  try {
    const quote = await api('/store/coupons/quote', { method: 'POST', body: JSON.stringify({ code: $('#couponInput').value.trim() }) });
    state.coupon = quote.code;
    state.couponDiscount = Number(quote.discount);
    $('#couponMessage').textContent = `تم تطبيق خصم ${money(quote.discount)}`;
    $('#checkoutSummary').innerHTML = checkoutSummary();
  } catch (error) { state.coupon = ''; state.couponDiscount = 0; $('#couponMessage').textContent = error.message; }
}

async function submitOrder(event) {
  event.preventDefault();
  if (!state.cart.length) return toast('السلة فارغة');
  const button = $('#checkoutForm button[type="submit"]');
  button.disabled = true;
  button.textContent = 'جارٍ تأكيد الطلب...';
  const form = new FormData(event.currentTarget);
  const address = Object.fromEntries(['recipient_name', 'phone', 'city', 'area', 'line1', 'notes'].map((key) => [key, String(form.get(key) || '').trim()]));
  const addressId = String(form.get('addressId') || '');
  try {
    const order = await api('/store/orders', { method: 'POST', body: JSON.stringify({ address, addressId, paymentMethod: form.get('paymentMethod'), shippingMethodId: form.get('shippingMethodId'), coupon: state.coupon }) });
    state.lastOrder = order;
    setRoute(`success/${encodeURIComponent(order.id)}`);
    await updateCartBadge();
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.innerHTML = `تأكيد الطلب ${icon('arrow-left')}`; lucide.createIcons(); }
}

async function renderOrderSuccess() {
  let order = state.lastOrder;
  if (!order && state.selectedOrder && token()) {
    try { order = await api(`/store/orders/${encodeURIComponent(state.selectedOrder)}`); }
    catch { order = null; }
  }
  if (!order) { $('#orderSuccess').innerHTML = emptyState('لا يوجد طلب حديث', 'افتح طلباتك لمتابعة مشترياتك.', '<a class="button button-primary" href="#orders" data-route="orders">طلباتي</a>'); return; }
  const transfer = order.payment_method === 'bank_transfer';
  let instructions = null;
  if (transfer) { try { instructions = await api('/store/payment-instructions'); } catch { instructions = null; } }
  $('#orderSuccess').innerHTML = `<div class="order-success-panel">${icon('circle-check')}<span class="eyebrow">تم تسجيل الطلب</span><h1>${transfer ? 'طلبك بانتظار تأكيد التحويل' : 'طلبك اتأكد بنجاح'}</h1><p>رقم الطلب <strong>${escapeHtml(order.order_number)}</strong></p><p>الإجمالي: <strong>${money(order.total)}</strong></p>${transfer ? `<div class="transfer-info">${instructions?.configured ? `<h2>بيانات التحويل</h2>${[['المستفيد',instructions.beneficiary],['البنك أو المحفظة',instructions.channel],['رقم الحساب',instructions.account],['المبلغ',money(order.total)],['رقم الطلب',order.order_number]].map(([label,value]) => `<div class="copy-row"><span>${label}: <strong>${escapeHtml(value)}</strong></span><button class="button button-outline" type="button" data-copy="${escapeHtml(value)}" aria-label="نسخ ${label}">${icon('copy')}</button></div>`).join('')}` : '<p class="notice-warning">بيانات التحويل لم تُضبط بعد. تواصل مع خدمة العملاء قبل إرسال أي مبلغ.</p>'}<form id="proofForm" class="upload-proof"><strong>رفع إيصال التحويل</strong><label>رقم العملية<input name="transactionId" required maxlength="100" /></label><label>تاريخ التحويل<input name="transferredAt" type="date" /></label><label>صورة الإيصال<input name="proofImage" type="file" accept="image/jpeg,image/png,image/webp" required /></label><button class="button button-warning" type="submit">إرسال للمراجعة ${icon('upload')}</button><small>الصورة وحدها لا تؤكد وصول المبلغ. سيتم التحقق قبل تجهيز الطلب.</small></form></div>` : '<p>ادفع للمندوب عند استلام الطلب.</p>'}<div class="order-card-actions"><a class="button button-primary" href="#order/${encodeURIComponent(order.id)}" data-route="order/${encodeURIComponent(order.id)}">تتبع الطلب ${icon('map-pin')}</a><a class="button button-outline" href="#products" data-route="products">مواصلة التسوق</a></div></div>`;
  lucide.createIcons();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('تعذر قراءة الصورة'));
    reader.readAsDataURL(file);
  });
}

async function submitProof(event) {
  event.preventDefault();
  const form = event.target;
  const file = form.elements.proofImage.files[0];
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return toast('اختار صورة JPG أو PNG أو WebP');
  if (file.size > 4 * 1024 * 1024) return toast('حجم الصورة يجب ألا يتجاوز ٤ ميجابايت');
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const imageData = await readFileAsDataUrl(file);
    await api(`/store/orders/${encodeURIComponent(state.lastOrder.id)}/proofs`, { method: 'POST', body: JSON.stringify({ transactionId: form.elements.transactionId.value.trim(), amount: state.lastOrder.total, transferredAt: form.elements.transferredAt.value, imageData }) });
    toast('وصل الإيصال للمراجعة، الدفع غير مؤكد حتى التحقق');
    form.reset();
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}

async function renderOrders() {
  if (!token()) { state.returnPage = 'orders'; openAuth('login'); return; }
  $('#ordersList').innerHTML = emptyState('جاري تحميل الطلبات', 'لحظة واحدة...');
  try {
    const orders = await api('/store/orders');
    $('#ordersList').innerHTML = orders.length ? orders.map((order) => `<article class="order-card"><div class="order-card-top"><div><h3>${escapeHtml(order.order_number)}</h3><p>${new Date(order.created_at).toLocaleDateString('ar-EG')} · ${Number(order.items?.length || 0).toLocaleString('ar-EG')} منتجات</p></div><span class="status-pill ${['delivered','paid','collected'].includes(order.order_status) ? 'success' : order.order_status === 'cancelled' ? 'error' : ''}">${statusLabel(order.order_status)}</span></div><div class="summary-row"><span>الإجمالي</span><strong>${money(order.total)}</strong></div><div class="order-card-actions"><a class="button button-outline" href="#order/${encodeURIComponent(order.id)}" data-route="order/${encodeURIComponent(order.id)}">تفاصيل وتتبع ${icon('arrow-left')}</a>${['new','payment_pending','payment_failed'].includes(order.order_status) ? `<button class="button button-outline" type="button" data-cancel-order="${escapeHtml(order.id)}">إلغاء الطلب</button>` : ''}</div></article>`).join('') : emptyState('لسه ماعملتش طلبات', 'لما تطلب منتجاتك هتلاقي تفاصيلها هنا.', '<a class="button button-primary" href="#products" data-route="products">تصفح المنتجات</a>');
    lucide.createIcons();
  } catch (error) { $('#ordersList').innerHTML = emptyState('تعذر تحميل الطلبات', error.message); }
}

const statusNames = { new: 'طلب جديد', payment_pending: 'بانتظار الدفع', payment_failed: 'الدفع لم يكتمل', preparing: 'قيد التجهيز', ready_for_delivery: 'جاهز للتوصيل', assigned: 'تم تعيين مندوب', out_for_delivery: 'خرج للتوصيل', delivered: 'تم التسليم', failed_delivery: 'تعذر التسليم', cancelled: 'ملغي', returned: 'مرتجع' };
function statusLabel(status) { return statusNames[status] || status || 'قيد التحديث'; }

async function renderOrderDetails(id) {
  if (!token()) { state.returnPage = `order/${id}`; openAuth('login'); return; }
  const container = $('#orderDetails');
  container.innerHTML = emptyState('جاري تحميل الطلب', 'لحظة واحدة...');
  try {
    const [order, notifications] = await Promise.all([api(`/store/orders/${encodeURIComponent(id)}`), api('/store/notifications')]);
    const otpNotice = notifications.find((notice) => notice.title === 'رمز تأكيد التوصيل' && notice.message.includes(order.order_number));
    container.innerHTML = `<div class="page-heading"><div><span class="eyebrow">تتبع الطلب</span><h1>${escapeHtml(order.order_number)}</h1></div><span class="status-pill">${statusLabel(order.order_status)}</span></div><div class="order-detail-grid"><section class="order-info-panel"><h2>المنتجات</h2>${order.items.map((item) => `<div class="summary-row"><span>${escapeHtml(item.name)} × ${Number(item.quantity).toLocaleString('ar-EG')}</span><strong>${money(item.line_total)}</strong></div>`).join('')}<div class="summary-row summary-total"><span>الإجمالي</span><strong>${money(order.total)}</strong></div></section><section class="order-info-panel"><h2>الدفع</h2><div class="summary-row"><span>الطريقة</span><strong>${order.payment_method === 'cod' ? 'الدفع عند الاستلام' : 'تحويل بنكي'}</strong></div><div class="summary-row"><span>الحالة</span><strong>${escapeHtml(order.payment_status)}</strong></div>${otpNotice ? `<p class="notice-warning">${escapeHtml(otpNotice.message)}. شارك الرمز مع المندوب عند الاستلام.</p>` : ''}</section><section class="order-info-panel"><h2>عنوان التوصيل</h2><p>${escapeHtml(order.address?.recipient_name)} · ${escapeHtml(order.address?.phone)}</p><p>${escapeHtml(order.address?.city)}، ${escapeHtml(order.address?.area)}، ${escapeHtml(order.address?.line1)}</p><a class="button button-outline" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([order.address?.city,order.address?.area,order.address?.line1].filter(Boolean).join(' '))}">${icon('map')} فتح الموقع</a></section><section class="order-info-panel"><h2>حالة الشحنة</h2><div class="timeline">${order.history.map((item) => `<div class="timeline-item"><strong>${escapeHtml(actionLabel(item.action))}</strong>${new Date(item.created_at).toLocaleString('ar-EG')}</div>`).join('') || `<div class="timeline-item"><strong>${statusLabel(order.order_status)}</strong>${new Date(order.created_at).toLocaleString('ar-EG')}</div>`}</div></section></div>`;
    lucide.createIcons();
  } catch (error) { container.innerHTML = emptyState('الطلب غير متاح', error.message); }
}

function actionLabel(action) { return ({ 'order.created': 'تم تسجيل الطلب', 'order.status_changed': 'تحديث حالة الطلب', 'order.agent_assigned': 'تم تعيين مندوب', 'order.delivered': 'تم التسليم', 'order.failed_delivery': 'تعذر التسليم' })[action] || 'تحديث الطلب'; }

function renderProfile() {
  const current = user();
  if (!current || !token()) { openAuth('login'); return; }
  $('#profilePanel').innerHTML = `<h2>${escapeHtml(current.name)}</h2><p>${escapeHtml(current.phone)}</p><p>نوع الحساب: عميل</p><button class="button button-outline" type="button" id="logoutStore">تسجيل الخروج ${icon('log-out')}</button>`;
  lucide.createIcons();
}

function openAuth(mode = 'login') {
  state.authMode = mode;
  $('#authError').textContent = '';
  $('#authTitle').textContent = mode === 'signup' ? 'إنشاء حساب عميل' : 'تسجيل الدخول';
  $$('.signup-only').forEach((field) => field.classList.toggle('hidden', mode !== 'signup'));
  $('#authForm [name="name"]').required = mode === 'signup';
  $('#authForm [name="password"]').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  $('#authSubmit').textContent = mode === 'signup' ? 'إنشاء الحساب' : 'تسجيل الدخول';
  $$('[data-auth-mode]').forEach((button) => button.classList.toggle('active', button.dataset.authMode === mode));
  $('#authModal').classList.remove('hidden');
  lucide.createIcons();
}

async function syncGuestCart() {
  const guest = getGuestCart();
  if (!guest.length) return;
  const products = await fetchProducts();
  for (const line of guest) {
    if (products.some((product) => product.id === line.product_id)) {
      await api(`/store/cart/items/${encodeURIComponent(line.product_id)}`, { method: 'PUT', body: JSON.stringify({ quantity: line.quantity }) });
    }
  }
  localStorage.removeItem(GUEST_CART_KEY);
}

async function submitAuth(event) {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.currentTarget));
  const submit = $('#authSubmit');
  submit.disabled = true;
  $('#authError').textContent = '';
  try {
    if (state.authMode === 'signup') {
      const signup = await api('/auth/signup', { method: 'POST', body: JSON.stringify({ name: form.name, phone: form.phone, password: form.password, role: 'customer' }) });
      const message = encodeURIComponent(`مرحبًا، أطلب تفعيل حسابي في ASTRA.\nالاسم: ${signup.user.name}\nالمعرّف: ${signup.user.publicId || signup.user.marketId || ''}\nرقم الموبايل: ${signup.user.phone}`);
      $('#authError').innerHTML = `تم إنشاء الحساب وهو قيد المراجعة. لن تتمكن من الشراء قبل اعتماد المشرف. <a href="https://wa.me/201037572742?text=${message}" target="_blank" rel="noopener noreferrer">إرسال طلب التفعيل عبر واتساب</a>`;
      return;
    }
    const result = await api('/auth/login', { method: 'POST', body: JSON.stringify({ phone: form.phone, password: form.password }) });
    if (result.user.role !== 'customer') throw new Error('استخدم بوابة الدخول المخصصة لنوع حسابك');
    localStorage.setItem(TOKEN_KEY, result.token);
    localStorage.setItem(USER_KEY, JSON.stringify(result.user));
    $('#authModal').classList.add('hidden');
    try { await syncGuestCart(); } catch (error) { toast(error.message); }
    await updateCartBadge();
    if (state.returnPage) { const next = state.returnPage; state.returnPage = ''; setRoute(next); }
    else toast('تم تسجيل الدخول');
  } catch (error) { $('#authError').textContent = error.message; }
  finally { submit.disabled = false; }
}

function setFavorite(productId) {
  state.favorites = state.favorites.includes(productId) ? state.favorites.filter((id) => id !== productId) : [...state.favorites, productId];
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favorites));
  updateCartBadge();
  if (state.page === 'favorites') renderFavorites();
  else if (state.page === 'products') renderCatalog();
  else if (state.page === 'product' && state.selectedProduct?.id === productId) renderProductDetails(state.selectedProduct.slug);
}

async function refresh() {
  try {
    [state.categories, state.shippingMethods] = await Promise.all([api('/store/categories'), api('/store/shipping-methods')]);
    state.favorites = (() => { try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); } catch { return []; } })();
    renderCategories();
    await renderHome();
    await updateCartBadge();
    routeFromHash();
  } catch (error) { console.error(error); setRoute('error', true); routeFromHash(); }
}

$('#headerSearch').addEventListener('submit', (event) => {
  event.preventDefault();
  state.query = $('#headerSearchInput').value.trim();
  state.selectedCategory = '';
  state.dealsOnly = false;
  setRoute('products');
});
$('#categoryFilter').addEventListener('change', (event) => { state.selectedCategory = event.currentTarget.value; renderCatalog(); });
$('#sortFilter').addEventListener('change', renderCatalog);
document.addEventListener('change', (event) => {
  if (event.target.matches('[name="shippingMethodId"]')) $('#checkoutSummary').innerHTML = checkoutSummary();
});
$('#savedAddressSelect').addEventListener('change', (event) => {
  const address = state.addresses.find((item) => item.id === event.currentTarget.value);
  ['recipient_name', 'phone', 'city', 'area', 'line1', 'notes'].forEach((key) => { $('#checkoutForm').elements[key].value = address?.[key] || (key === 'recipient_name' ? user()?.name || '' : ''); });
});
$('#checkoutForm').addEventListener('submit', submitOrder);
$('#applyCoupon').addEventListener('click', applyCoupon);
$('#authForm').addEventListener('submit', submitAuth);
$('#menuButton').addEventListener('click', () => $('#shopNav').classList.toggle('open'));
$('#accountButton').addEventListener('click', () => token() ? setRoute('profile') : openAuth('login'));
$$('[data-auth-mode]').forEach((button) => button.addEventListener('click', () => openAuth(button.dataset.authMode)));
$$('[data-close-auth]').forEach((button) => button.addEventListener('click', () => $('#authModal').classList.add('hidden')));
$('#authModal').addEventListener('click', (event) => { if (event.target === $('#authModal')) $('#authModal').classList.add('hidden'); });

document.addEventListener('click', async (event) => {
  const route = event.target.closest('[data-route]');
  if (route) {
    event.preventDefault();
    const next = route.dataset.route;
    if (next === 'cart' && token()) await renderCart();
    if (next === 'checkout' && !token()) { state.returnPage = 'checkout'; openAuth('login'); return; }
    setRoute(next);
    return;
  }
  const category = event.target.closest('[data-category]');
  if (category) { state.selectedCategory = category.dataset.category; state.query = ''; state.dealsOnly = false; setRoute('products'); return; }
  const productLink = event.target.closest('[data-open-product]');
  if (productLink) { setRoute(`product/${encodeURIComponent(productLink.dataset.openProduct)}`); return; }
  const add = event.target.closest('[data-add-cart]');
  if (add) { await addToCart(add.dataset.addCart); return; }
  const favorite = event.target.closest('[data-favorite]');
  if (favorite) { event.preventDefault(); event.stopPropagation(); setFavorite(favorite.dataset.favorite); return; }
  const quantity = event.target.closest('[data-cart-quantity]');
  if (quantity) { const item = state.cart.find((line) => line.product_id === quantity.dataset.productId); await setCartQuantity(quantity.dataset.productId, Math.max(0, Number(item?.quantity || 0) + Number(quantity.dataset.cartQuantity))); return; }
  const remove = event.target.closest('[data-remove-cart]');
  if (remove) { await setCartQuantity(remove.dataset.removeCart, 0); return; }
  const detailQuantity = event.target.closest('[data-detail-quantity]');
  if (detailQuantity) { state.detailQuantity = Math.min(Math.max(1, state.detailQuantity + Number(detailQuantity.dataset.detailQuantity)), Number(state.selectedProduct.stock)); $('#detailQuantity').textContent = state.detailQuantity.toLocaleString('ar-EG'); return; }
  if (event.target.closest('[data-detail-add]')) { await addToCart(state.selectedProduct.id, state.detailQuantity); return; }
  const gallery = event.target.closest('[data-gallery-image]');
  if (gallery && $('#detailMainImage')) $('#detailMainImage').src = gallery.dataset.galleryImage;
  const cancel = event.target.closest('[data-cancel-order]');
  if (cancel) {
    if (!confirm('هل تريد إلغاء الطلب؟')) return;
    try { await api(`/store/orders/${encodeURIComponent(cancel.dataset.cancelOrder)}/cancel`, { method: 'POST', body: JSON.stringify({}) }); toast('تم إلغاء الطلب وإرجاع الكميات للمخزون'); renderOrders(); }
    catch (error) { toast(error.message); }
    return;
  }
  const copy = event.target.closest('[data-copy]');
  if (copy) { try { await navigator.clipboard.writeText(copy.dataset.copy); toast('تم النسخ'); } catch { toast('تعذر النسخ من هذا المتصفح'); } return; }
  if (event.target.closest('#logoutStore')) { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); await updateCartBadge(); setRoute('home'); toast('تم تسجيل الخروج'); return; }
  if (event.target.closest('[data-retry]')) { await refresh(); return; }
});

document.addEventListener('submit', (event) => {
  if (event.target.id === 'proofForm') submitProof(event);
  if (event.target.id === 'productReviewForm') submitProductReview(event);
});
window.addEventListener('hashchange', routeFromHash);
window.lucide?.createIcons();
refresh();

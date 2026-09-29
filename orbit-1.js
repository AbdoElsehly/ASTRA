const STORAGE_KEYS = {
  users: 'astra-server-users',
  listings: 'astra-server-listings',
  rechargeRequests: 'souq-recharge-requests',
  transactions: 'souq-transactions',
  currentUser: 'astra-server-current-user',
  theme: 'souq-theme',
  chats: 'souq-chats',
  deliveryAgents: 'souq-delivery-agents',
  adminWallet: 'souq-admin-wallet',
  reviews: 'souq-reviews',
  deliveryRequests: 'astra-server-delivery-requests',
};

function readStoredValue(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value === null ? fallback : value;
  } catch {
    localStorage.removeItem(key);
    return fallback;
  }
}

function readStoredList(key) {
  const value = readStoredValue(key, []);
  return Array.isArray(value) ? value : [];
}

(() => {
  const state = {
    authMode: 'login',
    toastTimer: null,
    marketFilter: 'all',
    marketCategory: 'all',
    marketQuery: '',
    marketSort: 'featured',
    marketLayout: 'grid',
    marketStatus: 'open',
    currentChatUserId: null,
  };

  const users = readStoredList(STORAGE_KEYS.users).filter((item) => item && typeof item === 'object');
  const listings = readStoredList(STORAGE_KEYS.listings).filter((item) => item && typeof item === 'object');
  const wantedRequests = readStoredList('souq-wanted-products').filter((item) => item && typeof item === 'object');
  const rechargeRequests = readStoredList(STORAGE_KEYS.rechargeRequests).filter((item) => item && typeof item === 'object');
  const transactions = readStoredList(STORAGE_KEYS.transactions).filter((item) => item && typeof item === 'object');
  const chats = readStoredList(STORAGE_KEYS.chats).filter((item) => item && typeof item === 'object');
  const reviews = readStoredList(STORAGE_KEYS.reviews).filter((item) => item && typeof item === 'object');
  const deliveryRequests = readStoredList(STORAGE_KEYS.deliveryRequests).filter((item) => item && typeof item === 'object');
  const customerFeeRate = 0.002;
  const storeFeeRate = 0.001;
  let deliveryFeeRate = 0.05;
  let deliveryAgents = readStoredList(STORAGE_KEYS.deliveryAgents);
  if (!deliveryAgents.length) {
    deliveryAgents = [{ id: 'market-courier', name: 'مندوب السوق', phone: '', area: '' }];
    localStorage.setItem(STORAGE_KEYS.deliveryAgents, JSON.stringify(deliveryAgents));
  }

  let currentUser = readStoredValue(STORAGE_KEYS.currentUser, null);

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const iconRenderer = window.lucide || { createIcons() {} };
  const lucide = iconRenderer;
  const API_TOKEN_KEY = 'astra-market-token';

  async function apiRequest(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const token = localStorage.getItem(API_TOKEN_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`/api${path}`, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'تعذر تنفيذ العملية');
    return data;
  }

  function fromApiUser(user) {
    const existingUser = users.find((item) => String(item.id) === String(user.id)) || {};
    return normalizeUser({
      ...existingUser,
      id: user.id,
      marketId: user.marketId || user.publicId || user.public_id,
      name: user.name,
      phone: user.phone || '',
      role: user.role,
      status: user.status,
      balance: Number(user.balance || 0),
      facebook: user.facebook || '',
      location: user.location || '',
      reviewListings: user.reviewListings ?? Boolean(user.review_listings),
      reviewedAt: user.reviewedAt || user.reviewed_at || null,
      restrictions: getDefaultRestrictions(),
      notifications: existingUser.notifications || [],
      following: existingUser.following || [],
      followers: existingUser.followers || [],
    });
  }

  function fromApiListing(listing) {
    return {
      id: listing.id,
      publicId: listing.publicId || listing.public_id,
      ownerId: listing.ownerId || listing.owner_id,
      ownerName: listing.ownerName || listing.owner_name,
      ownerPhone: listing.ownerPhone || listing.owner_phone || '',
      title: listing.title,
      type: listing.type,
      category: listing.category,
      price: Number(listing.price || 0),
      notes: listing.notes || '',
      mediaData: listing.mediaData || listing.media_data || '',
      mediaType: listing.mediaType || listing.media_type || '',
      facebookUrl: listing.facebookUrl || listing.facebook_url || '',
      status: listing.status,
      createdAt: listing.createdAt || listing.created_at,
      isPremium: false,
      sales: 0,
      revenue: 0,
    };
  }

  function upsertMarketUser(user) {
    const index = users.findIndex((item) => String(item.id) === String(user.id));
    if (index < 0) users.push(user);
    else users[index] = { ...users[index], ...user };
    return users.find((item) => String(item.id) === String(user.id));
  }

  async function refreshMarketData() {
    const token = localStorage.getItem(API_TOKEN_KEY);
    let sessionUser = null;
    if (token) {
      try {
        const session = await apiRequest('/auth/me');
        sessionUser = fromApiUser(session.user);
      } catch {
        localStorage.removeItem(API_TOKEN_KEY);
      }
    }
    const [remoteUsers, remoteListings, marketSettings] = await Promise.all([
      apiRequest('/users'),
      apiRequest('/listings'),
      apiRequest('/market-settings'),
    ]);
    deliveryFeeRate = Math.min(100, Math.max(0, Number(marketSettings.deliveryFeePercent))) / 100;
    state.marketStatus = marketSettings.marketStatus;
    if (sessionUser?.role === 'courier') {
      try {
        const requests = await apiRequest('/courier/requests');
        deliveryRequests.splice(0, deliveryRequests.length, ...requests.map((request) => ({
          id: request.id,
          publicId: request.public_id,
          listingId: request.listing_id,
          listingTitle: request.listing_title,
          buyerId: request.buyer_id,
          sellerId: request.seller_id,
          courierId: request.courier_id,
          buyerLocation: request.buyer_location,
          sellerLocation: request.seller_location,
          deliveryFee: request.delivery_fee,
          courierFee: request.courier_fee,
          status: request.status === 'delivered' ? 'تم التسليم' : request.status === 'accepted' ? 'تم قبول الطلب' : 'جديد',
          createdAt: request.created_at,
        })));
      } catch {}
    }
    const marketUsers = remoteUsers.map(fromApiUser);
    if (sessionUser && !marketUsers.some((user) => String(user.id) === String(sessionUser.id))) marketUsers.push(sessionUser);
    users.splice(0, users.length, ...marketUsers);
    currentUser = sessionUser ? users.find((user) => String(user.id) === String(sessionUser.id)) || null : null;
    listings.splice(0, listings.length, ...remoteListings.map(fromApiListing));
    saveCurrentUser();
    saveUsers();
    localStorage.setItem(STORAGE_KEYS.listings, JSON.stringify(listings));
    updateAccountActions();
    renderMarket();
    renderWallet();
  }

  function publicIdPrefix(role) {
    return ({ store: 'STR', courier: 'CRY', admin: 'ADM' })[role] || 'USR';
  }

  function createPublicId(prefix) {
    const used = new Set([
      ...users.flatMap((user) => [user.marketId, ...(user.legacyMarketIds || [])]),
      ...listings.map((listing) => listing.publicId),
      ...deliveryAgents.map((agent) => agent.publicId),
    ].filter(Boolean));
    let publicId;
    do {
      publicId = `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
    } while (used.has(publicId));
    return publicId;
  }

  function createMarketId(role = 'customer') {
    return createPublicId(publicIdPrefix(role));
  }

  function getDefaultRestrictions() {
    return {
      purchase: false,
      sale: false,
      posting: false,
      transfer: false,
      recharge: false,
    };
  }

  function normalizeUser(user) {
    if (!user) return null;
    user.role = user.role || 'customer';
    const expectedPrefix = `${publicIdPrefix(user.role)}-`;
    if (!String(user.marketId || '').startsWith(expectedPrefix)) {
      user.legacyMarketIds = Array.isArray(user.legacyMarketIds) ? user.legacyMarketIds : [];
      if (user.marketId && !user.legacyMarketIds.includes(user.marketId)) user.legacyMarketIds.push(user.marketId);
      user.marketId = createMarketId(user.role);
    }
    user.feeRate = getFeeRate(user.role);
    user.isPremium = Boolean(user.isPremium);
    user.password = typeof user.password === 'string' ? user.password : '';
    user.status = user.status || 'active';
    user.phone = typeof user.phone === 'string' ? user.phone : '';
    user.facebook = typeof user.facebook === 'string' ? user.facebook : '';
    user.location = typeof user.location === 'string' ? user.location : '';
    user.balance = Number(user.balance || 0);
    user.ads = Number(user.ads || 0);
    user.following = Array.isArray(user.following) ? user.following : [];
    user.followers = Array.isArray(user.followers) ? user.followers : [];
    user.notifications = Array.isArray(user.notifications) ? user.notifications : [];
    user.restrictions = { ...getDefaultRestrictions(), ...(user.restrictions || {}) };
    return user;
  }

  function saveUsers() {
    localStorage.setItem(STORAGE_KEYS.users, JSON.stringify(users));
  }

  function saveTransactions() {
    localStorage.setItem(STORAGE_KEYS.transactions, JSON.stringify(transactions));
  }

  function recordTransaction(data) {
    transactions.push({
      id: Date.now(),
      createdAt: new Date().toISOString(),
      ...data,
    });
    saveTransactions();
  }

  function saveChats() {
    localStorage.setItem(STORAGE_KEYS.chats, JSON.stringify(chats));
  }

  function saveReviews() {
    localStorage.setItem(STORAGE_KEYS.reviews, JSON.stringify(reviews));
  }

  function saveDeliveryRequests() {
    localStorage.setItem(STORAGE_KEYS.deliveryRequests, JSON.stringify(deliveryRequests));
  }

  function saveCurrentUser() {
    if (currentUser) localStorage.setItem(STORAGE_KEYS.currentUser, JSON.stringify(currentUser));
    else localStorage.removeItem(STORAGE_KEYS.currentUser);
  }

  function findUser(userId) {
    if (userId === undefined || userId === null || userId === '') return null;
    return users.find((user) => String(user.id) === String(userId));
  }

  function addNotification(userId, title, detail) {
    const user = findUser(userId);
    if (!user) return;
    user.notifications = Array.isArray(user.notifications) ? user.notifications : [];
    user.notifications.push({
      id: Date.now(),
      title,
      detail,
      read: false,
      createdAt: new Date().toISOString(),
    });
  }

  function getUserRestrictions(user) {
    return { ...getDefaultRestrictions(), ...(user?.restrictions || {}) };
  }

  function updateNotificationsBadge() {
    const button = $('#notificationsButton');
    const badge = $('#notificationsBadge');
    if (!button || !badge) return;
    button.classList.toggle('hidden', !currentUser);
    const count = currentUser
      ? (currentUser.notifications || []).filter((item) => !item.read).length
      : 0;
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
  }

  function changeBalance(user, amount) {
    if (!user) return;
    user.balance = Number(user.balance || 0) + Number(amount);
  }

  function formatMoney(value) {
    return `${Number(value || 0).toLocaleString('ar-EG', {
      maximumFractionDigits: 2,
    })} ج.م`;
  }

  function formatDate(value) {
    return new Date(value).toLocaleString('ar-EG');
  }

  function formatFeeRate(rate) {
    return `${(Number(rate ?? 0.005) * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[character]);
  }

  function getFeeRate(role, type, price) {
    return role === 'store' ? storeFeeRate : role === 'customer' ? customerFeeRate : 0;
  }

  function calculateFee(role, type, price) {
    return Number(price || 0) * getFeeRate(role, type, price);
  }

  function calculateDeliveryFee(price, deliveryMethod) {
    return deliveryMethod === 'courier' ? Number(price || 0) * deliveryFeeRate : 0;
  }

  function syncAdminWallet() {
    const storedBalance = readStoredValue(STORAGE_KEYS.adminWallet, null);
    const adminUsers = users.filter((user) => user.role === 'admin');
    const balance = storedBalance === null ? Number(adminUsers[0]?.balance || 0) : Number(storedBalance || 0);
    localStorage.setItem(STORAGE_KEYS.adminWallet, JSON.stringify(balance));
    adminUsers.forEach((user) => { user.balance = balance; });
    if (currentUser?.role === 'admin') currentUser.balance = balance;
    return balance;
  }

  function changeAdminWallet(amount) {
    const balance = syncAdminWallet() + Number(amount || 0);
    localStorage.setItem(STORAGE_KEYS.adminWallet, JSON.stringify(balance));
    users.filter((user) => user.role === 'admin').forEach((user) => { user.balance = balance; });
    if (currentUser?.role === 'admin') {
      currentUser.balance = balance;
      saveCurrentUser();
    }
    saveUsers();
  }

  function syncCurrentUser() {
    if (!currentUser) return;
    const savedUser = users.find((user) => user.id === currentUser.id);
    if (savedUser) {
      currentUser = normalizeUser(savedUser);
      saveCurrentUser();
    }
  }

  users.forEach((user) => normalizeUser(user));
  listings.forEach((listing) => {
    const prefix = listing.type === 'service' ? 'SRV' : 'PRD';
    if (!String(listing.publicId || '').startsWith(`${prefix}-`)) listing.publicId = createPublicId(prefix);
  });
  deliveryAgents.forEach((agent) => {
    if (!String(agent.publicId || '').startsWith('CRY-')) agent.publicId = createPublicId('CRY');
  });
  localStorage.setItem(STORAGE_KEYS.listings, JSON.stringify(listings));
  localStorage.setItem(STORAGE_KEYS.deliveryAgents, JSON.stringify(deliveryAgents));

  const adminUser = users.find((user) => user.role === 'admin') || { id: 'server-managed-admin' };
  syncAdminWallet();
  saveUsers();

  if (currentUser) {
    const savedUser = users.find((user) => String(user.id) === String(currentUser.id));
    currentUser = normalizeUser(savedUser || currentUser);
    saveCurrentUser();
  }

  lucide.createIcons();

  if (localStorage.getItem(STORAGE_KEYS.theme) === 'night') {
    document.body.dataset.theme = 'night';
  }

  function updateThemeLabel() {
    const night = document.body.dataset.theme === 'night';
    $('#themeToggle').setAttribute(
      'aria-label',
      night ? 'تفعيل الوضع النهاري' : 'تفعيل الوضع الليلي',
    );
    $('#themeToggle').title = night ? 'تفعيل الوضع النهاري' : 'تفعيل الوضع الليلي';
  }

  updateThemeLabel();
  $('#themeToggle').addEventListener('click', () => {
    const night = document.body.dataset.theme === 'night';
    if (night) delete document.body.dataset.theme;
    else document.body.dataset.theme = 'night';
    localStorage.setItem(STORAGE_KEYS.theme, night ? 'day' : 'night');
    updateThemeLabel();
  });

  function showToast(message) {
    const toast = $('#toast');
    if (!toast) return;
    $('#toast span').textContent = message;
    toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2700);
  }

  function userListings(ownerId = currentUser?.id) {
    return listings.filter((listing) => listing.ownerId === ownerId);
  }

  function openAuth(mode = 'login') {
    state.authMode = mode;
    $('#authModal').classList.remove('hidden');
    updateAuthMode();
    $('#authPhone').focus();
  }

  function updateAuthMode() {
    const signup = state.authMode === 'signup';
    $('#authForm').classList.remove('hidden');
    $('.auth-tabs').classList.remove('hidden');
    $('#signupPendingMessage').classList.add('hidden');
    $('#authTitle').textContent = signup ? 'أنشئ حسابك في ASTRA' : 'أهلاً بك في ASTRA';
    $('#authSubtitle').textContent = signup
      ? 'اختر نوع حسابك وابدأ استخدام السوق.'
      : 'ادخل إلى حسابك وتابع مشترياتك وإعلاناتك.';
    $('#authSubmit').textContent = signup ? 'إنشاء الحساب' : 'دخول الحساب';
    $$('.signup-only').forEach((element) =>
      element.classList.toggle('hidden', !signup),
    );
    $('.account-type').classList.toggle('hidden', !signup);
    $$('[data-auth-tab]').forEach((button) =>
      button.classList.toggle('active', button.dataset.authTab === state.authMode),
    );
  }

  function showPendingSignup(user) {
    const message = encodeURIComponent(`مرحبًا، يرجى تفعيل حسابي في ASTRA.
الاسم: ${user.name}
المعرّف: ${user.marketId}
نوع الحساب: ${user.role === 'admin' ? 'مشرف ASTRA' : user.role === 'store' ? 'متجر / مقدم خدمة' : 'عميل عادي'}
رقم الموبايل: ${user.phone}`);
    $('#authModal').classList.remove('hidden');
    $('#authForm').classList.add('hidden');
    $('.auth-tabs').classList.add('hidden');
    $('#signupPendingMessage').classList.remove('hidden');
    $('#pendingSignupWhatsApp').href = `https://wa.me/201037572742?text=${message}`;
    lucide.createIcons();
  }

  function updateBalanceWidget() {
    const widget = $('#marketBalance');
    if (!widget) return;
    const marketVisible = !$('#homeView').classList.contains('hidden') || !$('#marketListingsView').classList.contains('hidden');
    widget.classList.toggle(
      'hidden',
      !currentUser || !marketVisible,
    );
    if (currentUser) {
      $('#marketBalanceValue').textContent = formatMoney(currentUser.balance || 0);
    }
  }

  function updateWelcomeSection() {
    const section = $('.welcome-section');
    if (section) section.classList.toggle('hidden', Boolean(currentUser));
  }

  function renderMarketHighlights() {
    const container = $('#marketHighlights');
    if (!container) return;
    const latest = listings
      .filter((listing) => listing.status === 'published')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 3);

    if (!latest.length) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div class="home-panels">
        <div class="home-panel">
          <span class="section-kicker">منتجات جديدة</span>
          <h3>آخر ما تم نشره</h3>
          ${latest
            .map(
              (listing) => `
                <div class="hot-listing-row">
                  <div>
                    <strong>${escapeHtml(listing.title)}</strong>
                    <span>${escapeHtml(listing.category)} · ${listing.type === 'service' ? 'خدمة' : 'منتج'}</span>
                  </div>
                  <button class="outline-button" data-user-profile="${listing.ownerId}">ملف البائع</button>
                </div>
              `,
            )
            .join('')}
        </div>
        <div class="home-panel">
          <span class="section-kicker">إشعارات السوق</span>
          <h3>أحدث التحديثات</h3>
          <div class="notification-list">
            <div class="notification-item">
              <div>
                <strong>تحديثات السوق</strong>
                <small>يتم إضافة منتجات جديدة خلال اليوم.</small>
              </div>
              <i data-lucide="sparkles"></i>
            </div>
          </div>
        </div>
      </div>
    `;
    lucide.createIcons();
  }

  function openTransferModal() {
    if (!currentUser) return openAuth('login');
    if (getUserRestrictions(currentUser).transfer) {
      return showToast('تم تقييدك من تحويل الرصيد مؤقتًا');
    }
    $('#transferRecipient').value = '';
    $('#transferAmount').value = '';
    $('#transferModal').classList.remove('hidden');
    $('#transferRecipient').focus();
  }

  function openRechargeModal() {
    if (!currentUser) return openAuth('login');
    if (getUserRestrictions(currentUser).recharge) {
      return showToast('تم تقييدك من شحن الرصيد مؤقتًا');
    }
    $('#customRechargeAmount').value = '';
    $('#transferNumber').value = '';
    $('#transferReceipt').value = '';
    $('input[name=proofType][value=number]').checked = true;
    $('#transferNumberField').classList.remove('hidden');
    $('#transferReceiptField').classList.add('hidden');
    $$('[data-recharge-amount]').forEach((button) =>
      button.classList.remove('selected'),
    );
    $('#rechargeModal').classList.remove('hidden');
  }

  function closeRechargeModal() {
    $('#rechargeModal').classList.add('hidden');
  }

  function openEditAccountModal() {
    if (!currentUser) return openAuth('login');
    $('#editAccountName').value = currentUser.name;
    $('#editAccountPhone').value = currentUser.phone || '';
    $('#editAccountPassword').value = '';
    $('#editAccountFacebook').value = currentUser.facebook || '';
    $('#editAccountLocation').value = currentUser.location || '';
    $('#editAccountModal').classList.remove('hidden');
  }

  function renderReport(userId) {
    const user = findUser(userId);
    if (!user) return;
    const accountListings = listings.filter((item) => item.ownerId === user.id);
    const activity = transactions.filter((item) => item.userId === user.id || item.buyerId === user.id || item.sellerId === user.id || item.senderId === user.id || item.recipientId === user.id || item.payerId === user.id || item.courierId === user.id);
    const personName = (id) => findUser(id)?.name || 'غير معروف';
    $('#reportTitle').textContent = `تقرير ${user.name}`;
    $('#reportContent').innerHTML = `<div class="report-grid"><div><span>الاسم</span><strong>${escapeHtml(user.name)}</strong></div><div><span>الهاتف</span><strong>${escapeHtml(user.phone || 'غير مضاف')}</strong></div><div><span>الرصيد</span><strong>${formatMoney(user.balance || 0)}</strong></div><div><span>الإعلانات</span><strong>${accountListings.length}</strong></div></div><div class="report-section"><h3>كل النشاط والمعاملات (${activity.length})</h3>${activity.length ? `<div class="report-activity-list">${activity.slice().reverse().map((item) => `<div class="report-activity-row"><div><strong>${escapeHtml(item.description || item.type || 'عملية')}</strong><span>${escapeHtml(item.type || 'غير محدد')} · ${escapeHtml(item.createdAt ? formatDate(item.createdAt) : '')}</span></div><div><strong>${formatMoney(item.amount || item.total || 0)}</strong><span>${item.senderId ? `من: ${escapeHtml(personName(item.senderId))}` : ''}${item.recipientId ? ` إلى: ${escapeHtml(personName(item.recipientId))}` : ''}${item.buyerId ? ` المشتري: ${escapeHtml(personName(item.buyerId))}` : ''}${item.sellerId ? ` البائع: ${escapeHtml(personName(item.sellerId))}` : ''}</span></div></div>`).join('')}</div>` : '<p>لا توجد معاملات مسجلة.</p>'}</div>`;
    $('#reportModal').classList.remove('hidden');
  }

  async function handleTransfer() {
    const recipientInput = $('#transferRecipient').value.trim();
    const amount = Number($('#transferAmount').value);
    const recipient = users.find((user) => [user.marketId, ...(user.legacyMarketIds || [])]
      .some((marketId) => String(marketId).toLowerCase() === recipientInput.toLowerCase()));
    if (!currentUser) return openAuth('login');
    if (getUserRestrictions(currentUser).transfer) {
      return showToast('تم تقييدك من التحويل');
    }
    if (!recipient) return showToast('لم يتم العثور على هذا المعرّف');
    if (recipient.id === currentUser.id) return showToast('لا يمكن التحويل إلى نفس الحساب');
    if (!Number.isFinite(amount) || amount < 1) return showToast('اكتب قيمة تحويل صحيحة');
    if (Number(currentUser.balance || 0) < amount) return showToast('رصيدك لا يكفي لإتمام التحويل');

    let result;
    try {
      result = await apiRequest('/transfers', { method: 'POST', body: JSON.stringify({ recipientId: recipient.id, amount }) });
    } catch (error) {
      return showToast(error.message);
    }
    currentUser.balance = Number(result.senderBalance || 0);
    recipient.balance = Number(result.recipientBalance || 0);
    recordTransaction({ id: result.transactionId, publicId: result.publicId, type: 'transfer', userId: currentUser.id, senderId: currentUser.id, recipientId: recipient.id, amount, description: `تحويل إلى ${recipient.name}` });
    addNotification(recipient.id, 'تم استلام تحويل', `${currentUser.name} قام بتحويل ${formatMoney(amount)}`);
    saveUsers();
    saveCurrentUser();
    updateAccountActions();
    renderWallet();
    $('#transferModal').classList.add('hidden');
    showToast(`تم تحويل ${formatMoney(amount)} إلى ${recipient.name}`);
  }

  function updatePurchaseSummary() {
    const listing = listings.find((item) => String(item.id) === String($('#purchaseListingId').value));
    if (!listing) return;
    const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value || 'balance';
    const deliveryMethod = document.querySelector('input[name="deliveryMethod"]:checked')?.value || 'self';
    const price = Number(listing.price || 0);
    const fee = calculateFee('customer', listing.type, price);
    const deliveryFee = calculateDeliveryFee(price, deliveryMethod);
    const total = price + fee + deliveryFee;
    $('#purchaseTotal').innerHTML = `
      <div><span>سعر المنتج</span><strong>${formatMoney(price)}</strong></div>
      <div><span>رسوم السوق</span><strong>${formatMoney(fee)}</strong></div>
      <div><span>التوصيل</span><strong>${deliveryFee ? formatMoney(deliveryFee) : 'بدون رسوم'}</strong></div>
      <div class="purchase-total-final"><span>الإجمالي ${paymentMethod === 'cash' ? 'عند الاستلام' : ''}</span><strong>${formatMoney(total)}</strong></div>
    `;
  }

  function openPurchaseModal(listingId) {
    const listing = listings.find((item) => String(item.id) === String(listingId));
    const seller = listing ? findUser(listing.ownerId) : null;
    if (!currentUser) return openAuth('login');
    if (currentUser.role === 'courier') return showToast('حساب المندوب مخصص لاستقبال طلبات التوصيل فقط');
    if (getUserRestrictions(currentUser).purchase) return showToast('تم تقييدك من الشراء مؤقتًا');
    if (!listing || !seller || listing.status !== 'published') return showToast('هذا الإعلان غير متاح حاليًا');
    if (seller.id === currentUser.id) return showToast('لا يمكنك شراء إعلانك الخاص');
    if (getUserRestrictions(seller).sale) return showToast('هذا البائع مقيّد من البيع مؤقتًا');

    $('#purchaseListingId').value = listing.id;
    $('#purchaseListingName').textContent = listing.title;
    $('#purchaseListingPrice').textContent = formatMoney(listing.price);
    $('#purchaseCourier').innerHTML = '<option value="">اختر مندوبًا</option>' + availableCouriers().map((courier) => `<option value="${escapeHtml(courier.id)}">${escapeHtml(courier.name)} · ${escapeHtml(courier.publicId || '')}${courier.area ? ` · ${escapeHtml(courier.area)}` : ''}</option>`).join('');
    $('#purchaseLocation').value = currentUser.location || '';
    $('#purchaseCourierField').classList.add('hidden');
    $('#purchaseModal').classList.remove('hidden');
    updatePurchaseSummary();
    lucide.createIcons();
  }

  async function handlePurchaseSubmit() {
    const listing = listings.find((item) => String(item.id) === String($('#purchaseListingId').value));
    const seller = listing ? findUser(listing.ownerId) : null;
    if (!currentUser || !listing || !seller) return showToast('هذا الإعلان غير متاح حاليًا');

    const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value || 'balance';
    const deliveryMethod = document.querySelector('input[name="deliveryMethod"]:checked')?.value || 'self';
    const courierId = $('#purchaseCourier').value;
    if (deliveryMethod === 'courier' && !courierId) return showToast('اختر مندوب التوصيل أولًا');

    const courier = availableCouriers().find((agent) => String(agent.id) === String(courierId)) || null;
    const price = Number(listing.price || 0);
    const fee = calculateFee('customer', listing.type, price);
    const deliveryFee = calculateDeliveryFee(price, deliveryMethod);
    const total = price + fee + deliveryFee;
    const buyer = currentUser;
    const buyerLocation = $('#purchaseLocation').value.trim() || buyer.location || '';
    const sellerLocation = seller.location || '';
    if (deliveryMethod === 'courier' && (!buyerLocation || !sellerLocation)) {
      return showToast('أضف موقع البائع والمشتري قبل طلب التوصيل');
    }
    const courierFee = deliveryMethod === 'courier' ? deliveryFee * 0.8 : 0;

    if (paymentMethod === 'balance' && Number(buyer.balance || 0) < total) {
      return showToast(`تحتاج إلى ${formatMoney(total)} لإتمام الشراء من الرصيد`);
    }

    let purchase;
    try {
      purchase = await apiRequest('/purchases', {
        method: 'POST',
        body: JSON.stringify({ listingId: listing.id, paymentMethod, deliveryMethod, courierId: courier?.id, buyerLocation, sellerLocation }),
      });
    } catch (error) {
      return showToast(error.message);
    }
    if (paymentMethod === 'balance') {
      buyer.balance = Number(purchase.balances.buyer || 0);
      seller.balance = Number(purchase.balances.seller || 0);
      if (courier?.id && users.some((user) => String(user.id) === String(courier.id))) {
        const courierUser = findUser(courier.id);
        courierUser.balance = Number(purchase.balances.courier || 0);
      }
      changeAdminWallet(fee + deliveryFee - courierFee);
    }
    listing.sales = Number(listing.sales || 0) + 1;
    listing.revenue = Number(listing.revenue || 0) + price;
    recordTransaction({
      id: purchase.transactionId,
      publicId: purchase.publicId,
      type: 'purchase',
      userId: buyer.id,
      buyerId: buyer.id,
      sellerId: seller.id,
      adminId: adminUser.id,
      listingId: listing.id,
      amount: price,
      fee,
      deliveryFee,
      total,
      paymentMethod,
      deliveryMethod,
      courierId: courier?.id || '',
      courierName: courier?.name || '',
      buyerLocation,
      sellerLocation,
      courierFee,
      status: paymentMethod === 'cash' ? 'cash-on-delivery' : 'paid',
      description: `شراء ${listing.title}`,
    });
    if (purchase.delivery && courier) {
      deliveryRequests.push({
        id: purchase.delivery.id,
        publicId: purchase.delivery.publicId,
        listingId: listing.id,
        listingTitle: listing.title,
        buyerId: buyer.id,
        sellerId: seller.id,
        courierId: courier.id,
        buyerLocation,
        sellerLocation,
        deliveryFee,
        courierFee,
        status: 'جديد',
        createdAt: new Date().toISOString(),
      });
      saveDeliveryRequests();
      if (users.some((user) => String(user.id) === String(courier.id))) {
        addNotification(courier.id, 'طلب توصيل جديد', `لديك طلب لتوصيل ${listing.title}.`);
      }
    }
    addNotification(seller.id, 'تم استلام طلب جديد', `${buyer.name} طلب ${listing.title} بطريقة ${paymentMethod === 'cash' ? 'الدفع عند الاستلام' : 'الدفع من الرصيد'}.`);
    addNotification(buyer.id, 'تم تسجيل طلبك', `${listing.title} بإجمالي ${formatMoney(total)}${courier ? ` مع المندوب ${courier.name}` : ' مع الاستلام الذاتي'}.`);
    saveUsers();
    localStorage.setItem(STORAGE_KEYS.listings, JSON.stringify(listings));
    saveCurrentUser();
    $('#purchaseModal').classList.add('hidden');
    renderMarket();
    renderWallet();
    renderAdmin();
    showToast(paymentMethod === 'cash' ? 'تم تسجيل طلبك بالدفع عند الاستلام' : `تم شراء ${listing.title} بنجاح`);
  }

  function buyListing(listingId) {
    openPurchaseModal(listingId);
  }

  function toggleFollow(targetId) {
    if (!currentUser) return openAuth('login');
    const target = findUser(targetId);
    if (!target || target.id === currentUser.id) return;
    const following = Array.isArray(currentUser.following) ? [...currentUser.following] : [];
    const followers = Array.isArray(target.followers) ? [...target.followers] : [];
    const currentIsFollowing = following.includes(target.id);

    if (currentIsFollowing) {
      currentUser.following = following.filter((id) => id !== target.id);
      target.followers = followers.filter((id) => id !== currentUser.id);
      showToast(`تم إلغاء متابعة ${target.name}`);
    } else {
      currentUser.following = [...new Set([...following, target.id])];
      target.followers = [...new Set([...followers, currentUser.id])];
      addNotification(target.id, 'لديك متابع جديد', `${currentUser.name} بدأ متابعتك.`);
      showToast(`تم متابعة ${target.name}`);
    }

    saveUsers();
    saveCurrentUser();
    renderProfile(target.id);
    updateAccountActions();
  }

  function renderProfile(userId) {
    const user = findUser(userId);
    if (!user) return;
    const isCurrent = currentUser && currentUser.id === user.id;
    const followers = (user.followers || []).map((id) => findUser(id)).filter(Boolean);
    const following = (user.following || []).map((id) => findUser(id)).filter(Boolean);
    const published = listings.filter((listing) => listing.ownerId === user.id && listing.status === 'published');

    const feed = currentUser && currentUser.id !== user.id
      ? listings.filter((listing) => listing.status === 'published' && (listing.ownerId === user.id || currentUser.following.includes(listing.ownerId)))
      : published;

    $('#profileContent').innerHTML = `
      <div class="profile-sheet">
        <div class="profile-header">
          <div class="profile-top">
            <span class="profile-avatar">${escapeHtml(user.name[0] || 'U')}</span>
            <div>
              <h3>${escapeHtml(user.name)}</h3>
              <span>${escapeHtml(user.marketId)} · ${user.role === 'store' ? 'متجر' : user.role === 'courier' ? 'مندوب توصيل' : user.role === 'admin' ? 'مدير' : 'عميل'}</span>
            </div>
          </div>
          <div class="profile-actions">
            ${currentUser && !isCurrent ? `<button class="primary-button" data-toggle-follow="${user.id}">${(currentUser.following || []).includes(user.id) ? 'إلغاء المتابعة' : 'متابعة'}</button>` : ''}
            ${currentUser && !isCurrent ? `<button class="outline-button" data-open-chat="${user.id}">محادثة</button>` : ''}
          </div>
        </div>
        <div class="profile-stats">
          <div class="profile-stat"><strong>${published.length}</strong><span>إعلانات</span></div>
          <div class="profile-stat"><strong>${followers.length}</strong><span>متابعين</span></div>
          <div class="profile-stat"><strong>${following.length}</strong><span>يتابع</span></div>
        </div>
        <div class="profile-contact-links">
          ${user.facebook ? `<a href="${escapeHtml(user.facebook)}" target="_blank" rel="noopener noreferrer"><i data-lucide="facebook"></i> فيسبوك</a>` : ''}
          ${user.location ? `<span><i data-lucide="map-pin"></i> ${escapeHtml(user.location)}</span>` : ''}
        </div>
        <div class="follow-list">
          <div class="home-panel">
            <h3>المتابَعون</h3>
            ${followers.length ? followers.map((person) => `
              <div class="follow-chip">
                <div>
                  <strong>${escapeHtml(person.name)}</strong>
                  <span>${escapeHtml(person.marketId)}</span>
                </div>
                <button class="outline-button" data-user-profile="${person.id}">فتح</button>
              </div>
            `).join('') : '<small>لا يوجد متابعون بعد.</small>'}
          </div>
          <div class="home-panel">
            <h3>يُتابع</h3>
            ${following.length ? following.map((person) => `
              <div class="follow-chip">
                <div>
                  <strong>${escapeHtml(person.name)}</strong>
                  <span>${escapeHtml(person.marketId)}</span>
                </div>
                <button class="outline-button" data-user-profile="${person.id}">فتح</button>
              </div>
            `).join('') : '<small>لا يتابع أي حسابات بعد.</small>'}
          </div>
        </div>
        <div class="home-panel">
          <h3>أحدث الإعلانات</h3>
          ${feed.length ? feed.slice(0, 4).map((listing) => `
            <div class="hot-listing-row">
              <div>
                <strong>${escapeHtml(listing.title)}</strong>
                <span>${escapeHtml(listing.category)} · ${formatMoney(listing.price)}</span>
              </div>
              <button class="outline-button" data-buy-listing="${listing.id}">شراء</button>
            </div>
          `).join('') : '<small>لا توجد إعلانات منشورة.</small>'}
        </div>
      </div>
    `;
    $('#profileModal').classList.remove('hidden');
    lucide.createIcons();
  }

  function renderNotifications() {
    if (!currentUser) return;
    const list = $('#notificationsList');
    currentUser.notifications = (currentUser.notifications || []).map((item) => ({ ...item, read: true }));
    saveCurrentUser();
    updateNotificationsBadge();
    list.innerHTML = currentUser.notifications.length
      ? currentUser.notifications
          .map(
            (item) => `
              <div class="notification-item">
                <div>
                  <strong>${escapeHtml(item.title)}</strong>
                  <small>${escapeHtml(item.detail)}</small>
                </div>
                <span>${formatDate(item.createdAt)}</span>
              </div>
            `,
          )
          .join('')
      : '<div class="empty-admin">لا توجد إشعارات جديدة.</div>';
  }

  function renderChat() {
    const peer = currentUser && state.currentChatUserId ? findUser(state.currentChatUserId) : null;
    if (!peer || !currentUser) return;
    $('#chatTitle').textContent = `محادثة ${peer.name}`;
    const messages = chats.filter(
      (message) =>
        (message.fromId === currentUser.id && message.toId === peer.id) ||
        (message.fromId === peer.id && message.toId === currentUser.id),
    );

    $('#chatPanel').innerHTML = messages.length
      ? messages
          .map(
            (message) => `
              <div class="chat-message ${message.fromId === currentUser.id ? 'my-message' : ''}">
                <div class="chat-bubble">${escapeHtml(message.text)}</div>
              </div>
            `,
          )
          .join('')
      : '<div class="empty-admin">ابدأ المحادثة مع هذا المستخدم.</div>';
    $('#chatPanel').scrollTop = $('#chatPanel').scrollHeight;
  }

  function openChat(userId) {
    if (!currentUser) return openAuth('login');
    state.currentChatUserId = Number(userId);
    $('#chatModal').classList.remove('hidden');
    renderChat();
  }

  function sendChatMessage(event) {
    event.preventDefault();
    if (!currentUser || !state.currentChatUserId) return;
    const text = $('#chatInput').value.trim();
    if (!text) return;
    chats.push({
      id: Date.now(),
      fromId: currentUser.id,
      toId: state.currentChatUserId,
      text,
      createdAt: new Date().toISOString(),
    });
    saveChats();
    $('#chatInput').value = '';
    renderChat();
    addNotification(state.currentChatUserId, 'رسالة جديدة', `${currentUser.name} أرسل لك رسالة.`);
  }

  function renderWallet() {
    if (!currentUser) {
      $('#walletContent').innerHTML = '<div class="empty-market"><h2>سجل الدخول أولاً</h2><button class="primary-button" data-open-auth="login">تسجيل الدخول</button></div>';
      return;
    }
    if (currentUser.role === 'courier') {
      $('#walletContent').innerHTML = renderCourierDashboard();
      lucide.createIcons();
      return;
    }
    const ownListings = userListings(currentUser.id);
    const published = ownListings.filter((listing) => listing.status === 'published');
    const pending = ownListings.filter((listing) => listing.status === 'pending');
    const isStore = currentUser.role === 'store';
    const isAdmin = currentUser.role === 'admin';
    const totalRevenue = ownListings.reduce(
      (sum, listing) => sum + Number(listing.revenue || 0),
      0,
    );
    const quota = 'مفتوح';
    $('#walletContent').innerHTML = `
      <div class="wallet-layout">
        <div class="panel balance-panel">
          <span class="section-kicker">الرصيد المتاح</span>
          <div class="balance-number">${formatMoney(currentUser.balance)}</div>
          <span class="balance-caption">يمكن استخدامه داخل سوق ASTRA فقط</span>
          <div class="panel-actions">
            <button class="primary-button" data-action="recharge">اختيار قيمة الشحن</button>
          </div>
        </div>
        <div class="panel">
          <h3>بيانات الحساب</h3>
          <div class="account-summary">
            <span class="profile-avatar">${escapeHtml(currentUser.name[0])}</span>
            <div>
              <strong>${escapeHtml(currentUser.name)}</strong>
              <span>${escapeHtml(currentUser.phone || 'بدون رقم موبايل')}</span>
              <span>${isAdmin ? 'مدير النظام · محفظة المشرفين المشتركة' : isStore ? 'متجر / مقدم خدمة' : 'عميل عادي'}</span>
              <span class="account-id"><i data-lucide="fingerprint"></i> معرّفك: ${escapeHtml(currentUser.marketId)}</span>
            </div>
          </div>
          <div class="panel-actions">
            <button class="outline-button" data-action="create-ad">إضافة إعلان</button>
            <button class="outline-button" data-action="transfer-balance">تحويل رصيد</button>
          </div>
          <div class="quota-note"><i data-lucide="badge-info"></i> ${isAdmin ? 'هذا الرصيد مشترك ومتزامن مع كل حسابات المشرفين.' : 'يمكنك إضافة إعلانات بدون حد، وتُخصم الرسوم عند اعتماد الإعلان.'}</div>
        </div>
      </div>
      <div class="listing-summary">
        <div class="stat-card"><span>إعلاناتي</span><strong>${ownListings.length}</strong></div>
        <div class="stat-card"><span>قيد المراجعة</span><strong>${pending.length}</strong></div>
        <div class="stat-card"><span>${isStore ? 'إجمالي المبيعات' : 'مشترياتي'}</span><strong>${isStore ? formatMoney(totalRevenue) : '٠'}</strong></div>
      </div>
      <div class="account-tools">
        <button class="outline-button" data-action="edit-account"><i data-lucide="user-round-cog"></i> تعديل بياناتي</button>
        <button class="outline-button" data-action="profile"><i data-lucide="user-round"></i> ملفي الشخصي</button>
        <button class="outline-button" data-action="notifications"><i data-lucide="bell"></i> إشعارات</button>
      </div>
      <div class="panel">
        <div class="section-heading">
          <div>
            <span class="section-kicker">ملف النشاط</span>
            <h3>إعلاناتي</h3>
          </div>
          <button class="primary-button" data-action="create-ad"><i data-lucide="plus"></i> إضافة إعلان</button>
        </div>
        ${ownListings.length ? `<div class="listing-grid">${ownListings.map((listing) => `<article class="listing-card"><div class="listing-card-header"><h3>${escapeHtml(listing.title)}</h3><span class="listing-status">${listing.status === 'published' ? 'منشور' : 'قيد المراجعة'}</span></div><div class="listing-card-meta"><span>${escapeHtml(listing.category)} · ${listing.type === 'service' ? 'خدمة' : 'منتج'}</span><strong>${formatMoney(listing.price)}</strong></div><p>${escapeHtml(listing.notes)}</p><div class="listing-card-footer"><span>الرسوم: ${formatMoney(listing.fee || 0)}</span><button class="outline-button" data-user-profile="${currentUser.id}">عرض الملف</button><button class="outline-button danger-button" type="button" data-delete-listing="${escapeHtml(listing.id)}"><i data-lucide="trash-2"></i> حذف</button></div></article>`).join('')}</div>` : '<div class="empty-admin">لا توجد إعلانات حتى الآن.</div>'}
      </div>
    `;
    lucide.createIcons();
    $$('[data-action="recharge"]').forEach((button) => (button.onclick = openRechargeModal));
    $$('[data-action="transfer-balance"]').forEach((button) => (button.onclick = openTransferModal));
    $$('[data-action="create-ad"]').forEach((button) => (button.onclick = openListingModal));
    $$('[data-action="edit-account"]').forEach((button) => (button.onclick = openEditAccountModal));
    $$('[data-action="profile"]').forEach((button) => (button.onclick = () => renderProfile(currentUser.id)));
    $$('[data-action="notifications"]').forEach((button) => (button.onclick = openNotifications));
  }

  function renderAdminUsers() {
    const query = $('#adminUserSearch')?.value.trim().toLowerCase() || '';
    const matches = users.filter((user) =>
      `${user.marketId} ${user.name} ${user.phone || ''}`.toLowerCase().includes(query),
    );

    $('#adminUsers').innerHTML = `${matches.map((user) => {
      const restrictions = getUserRestrictions(user);
      const activeRestriction = Object.entries(restrictions).find(([, value]) => value)?.[0] || '';
      return `
        <div class="admin-user-row">
          <div>
            <strong>${escapeHtml(user.name)}</strong>
            <span>${escapeHtml(user.marketId)} · ${user.role === 'store' ? 'متجر' : user.role === 'courier' ? 'مندوب' : user.role === 'admin' ? 'مدير' : 'عميل'} · ${user.status === 'pending' ? 'قيد المراجعة' : 'نشط'} · ${escapeHtml(user.phone || 'بدون هاتف')} · رصيد ${formatMoney(user.balance || 0)}</span>
            <span>التقييد الحالي: ${activeRestriction || 'بدون قيود'}</span>
          </div>
          <label class="fee-control"><span>تقييد</span><select data-user-restrict-select="${user.id}"><option value="">بدون قيود</option><option value="purchase" ${activeRestriction === 'purchase' ? 'selected' : ''}>شراء</option><option value="sale" ${activeRestriction === 'sale' ? 'selected' : ''}>بيع</option><option value="posting" ${activeRestriction === 'posting' ? 'selected' : ''}>نشر</option><option value="transfer" ${activeRestriction === 'transfer' ? 'selected' : ''}>تحويل رصيد</option><option value="recharge" ${activeRestriction === 'recharge' ? 'selected' : ''}>شحن رصيد</option></select></label>
          <button class="outline-button" data-user-restrict="${user.id}">تطبيق التقييد</button>
          <button class="outline-button" data-admin-deduct="${user.id}">خصم</button>
          <button class="outline-button" data-admin-report="${user.id}">تقرير</button>
          ${user.id !== currentUser?.id ? `<button class="outline-button danger-button" data-admin-delete="${user.id}">حذف المستخدم</button>` : ''}
          ${user.role !== 'admin' ? `<button class="outline-button" data-admin-premium="${user.id}">${user.isPremium ? 'إلغاء Premium' : 'ترقية Premium'}</button>` : ''}
          ${user.status === 'pending' ? `<button class="primary-button" data-admin-approve-user="${user.id}">اعتماد الحساب</button>` : ''}
          ${user.id !== currentUser?.id ? `<button class="outline-button" data-open-chat="${user.id}">شات</button>` : ''}
        </div>
      `;
    }).join('') || '<div class="empty-admin">لا يوجد حساب مطابق</div>'}`;

  }

  function renderDeliveryAgents() {
    $('#agentsContent').innerHTML = deliveryAgents.map((agent) => `
      <div class="agent-row"><span class="agent-avatar"><i data-lucide="user-round"></i></span><div><strong>${escapeHtml(agent.name)}</strong><small>${escapeHtml(agent.publicId || '')} · ${escapeHtml(agent.area || 'تغطية السوق')}</small></div><a class="agent-phone" href="tel:${escapeHtml(agent.phone || '')}"><i data-lucide="phone"></i>${escapeHtml(agent.phone || 'يتم التواصل من خلال السوق')}</a></div>
    `).join('');
    lucide.createIcons();
  }

  function availableCouriers() {
    const accountCouriers = users
      .filter((user) => user.role === 'courier' && user.status === 'active')
      .map((user) => ({ id: user.id, publicId: user.marketId, name: user.name, phone: user.phone, area: user.location }));
    return accountCouriers;
  }

  function renderCourierDashboard() {
    const requests = deliveryRequests.filter((request) => String(request.courierId) === String(currentUser.id));
    return `
      <div class="panel courier-dashboard">
        <div class="section-heading"><div><span class="section-kicker">لوحة المندوب</span><h3>طلبات التوصيل</h3></div><span class="courier-fee-note">رسومك حسب كل طلب</span></div>
        ${requests.length ? requests.slice().reverse().map((request) => `
          <article class="delivery-request-card">
            <div class="delivery-request-top"><strong>${escapeHtml(request.listingTitle)}</strong><span>${escapeHtml(request.status || 'جديد')}</span></div>
            <div class="delivery-route"><div><small>موقع البائع</small><strong>${escapeHtml(request.sellerLocation || 'غير مضاف')}</strong></div><i data-lucide="arrow-left-right"></i><div><small>موقع المشتري</small><strong>${escapeHtml(request.buyerLocation || 'غير مضاف')}</strong></div></div>
            <div class="delivery-request-meta"><span>رسوم التوصيل: ${formatMoney(request.deliveryFee || 0)}</span><span>أجرك: ${formatMoney(request.courierFee || 0)}</span></div>
            <div class="delivery-request-actions"><button class="outline-button" data-delivery-status="accepted" data-delivery-id="${request.id}">قبول الطلب</button><button class="primary-button" data-delivery-status="delivered" data-delivery-id="${request.id}">تم التسليم</button></div>
          </article>
        `).join('') : '<div class="empty-admin">لا توجد طلبات توصيل جديدة.</div>'}
      </div>
    `;
  }

  function saveDeliveryAgents() {
    localStorage.setItem(STORAGE_KEYS.deliveryAgents, JSON.stringify(deliveryAgents));
  }

  function renderAdminAgents() {
    const container = $('#adminAgents');
    if (!container) return;
    container.innerHTML = deliveryAgents.map((agent) => `
      <div class="agent-row"><span class="agent-avatar"><i data-lucide="user-round"></i></span><div><strong>${escapeHtml(agent.name)}</strong><small>${escapeHtml(agent.area || 'تغطية السوق')} · ${escapeHtml(agent.phone || 'بدون رقم')}</small></div><button class="outline-button" data-remove-agent="${agent.id}">حذف</button></div>
    `).join('');
    lucide.createIcons();
    $$('[data-remove-agent]').forEach((button) => {
      button.onclick = () => {
        if (deliveryAgents.length === 1) return showToast('يجب الاحتفاظ بمندوب واحد على الأقل');
        deliveryAgents = deliveryAgents.filter((agent) => agent.id !== button.dataset.removeAgent);
        saveDeliveryAgents();
        renderAdminAgents();
      };
    });
  }

  function renderAdmin() {
    const stores = users.filter((user) => user.role === 'store').length;
    const customers = users.filter((user) => user.role === 'customer').length;
    const couriers = users.filter((user) => user.role === 'courier').length;
    const admins = users.filter((user) => user.role === 'admin').length;
    const pendingAdmins = users.filter((user) => user.role === 'admin' && user.status === 'pending');
    const pending = listings.filter((listing) => listing.status === 'pending');
    const published = listings.filter((listing) => listing.status === 'published');
    const fees = listings.reduce((sum, listing) => sum + Number(listing.fee || 0), 0);
    const totalUsers = users.length;
    const balanceOut = users.filter((user) => user.role !== 'admin').reduce((sum, user) => sum + Number(user.balance || 0), 0);

    $('#adminContent').innerHTML = `
      <div class="admin-stats">
        <div class="stat-card"><span>إجمالي المستخدمين</span><strong>${totalUsers}</strong></div>
        <div class="stat-card"><span>المتاجر</span><strong>${stores}</strong></div>
        <div class="stat-card"><span>العملاء</span><strong>${customers}</strong></div>
        <div class="stat-card"><span>المناديب</span><strong>${couriers}</strong></div>
        <div class="stat-card"><span>المشرفون</span><strong>${admins}</strong></div>
        <div class="stat-card"><span>الإعلانات المنشورة</span><strong>${published.length}</strong></div>
      </div>
      <div class="admin-stats">
        <div class="stat-card"><span>قيد المراجعة</span><strong>${pending.length}</strong></div>
        <div class="stat-card"><span>إيراد السوق</span><strong>${formatMoney(fees)}</strong></div>
        <div class="stat-card"><span>إجمالي أموال المستخدمين</span><strong>${formatMoney(balanceOut)}</strong></div>
      </div>
      <div class="admin-table">
        <h3>مراجعة الإعلانات</h3>
        <p>اعتمد الإعلان ليظهر في السوق العام. الرسوم محسوبة حسب نوع الإعلان وسعره ونوع حساب صاحبه.</p>
        ${pending.length ? `<div class="listing-grid">${pending.map((listing) => `<article class="listing-card"><div class="listing-card-header"><h3>${escapeHtml(listing.title)}</h3><span class="listing-status">قيد المراجعة</span></div><div class="listing-card-meta"><span>${escapeHtml(listing.ownerName)} · ${escapeHtml(listing.category)}</span><strong>${formatMoney(listing.price)}</strong></div><p>${escapeHtml(listing.notes)}</p><div class="listing-card-footer"><span>الرسوم: ${formatMoney(listing.fee || 0)}</span><button class="primary-button" data-approve-listing="${listing.id}">اعتماد الإعلان</button></div></article>`).join('')}</div>` : '<div class="empty-admin"><i data-lucide="inbox"></i><br>لا توجد إعلانات تنتظر المراجعة</div>'}
      </div>
      <div class="admin-table">
        <div class="section-heading">
          <div>
            <span class="section-kicker">حسابات السوق</span>
            <h3>ابحث في حسابات السوق</h3>
          </div>
          <input class="admin-search" id="adminUserSearch" type="search" placeholder="SQ-123456 أو اسم العميل" />
        </div>
        <div id="adminUsers"></div>
      </div>
      <div class="admin-table">
        <div class="section-heading">
          <div>
            <span class="section-kicker">سجل مالي كامل</span>
            <h3>كل التحويلات والعمليات</h3>
          </div>
        </div>
        <div class="admin-transactions">
          ${transactions.length ? transactions.slice().reverse().map((item) => `<div class="admin-transaction-row"><strong>${escapeHtml(item.description || item.type)}</strong><span>${formatMoney(item.amount || 0)} · ${escapeHtml(item.createdAt ? formatDate(item.createdAt) : '')}</span></div>`).join('') : '<div class="empty-admin">لا توجد عمليات مسجلة.</div>'}
        </div>
      </div>
      <div class="admin-table admin-agents-panel">
        <div class="section-heading">
          <div>
            <span class="section-kicker">التوصيل</span>
            <h3>إدارة مناديب السوق</h3>
          </div>
        </div>
        <form id="agentForm" class="agent-form">
          <input id="agentName" required placeholder="اسم المندوب" />
          <input id="agentPhone" required type="tel" placeholder="رقم الموبايل" />
          <input id="agentArea" placeholder="منطقة التغطية" />
          <button class="primary-button" type="submit"><i data-lucide="plus"></i> إضافة مندوب</button>
        </form>
        <div id="adminAgents" class="agents-list"></div>
      </div>
      <div class="admin-table pending-admins-panel">
        <div class="section-heading">
          <div>
            <span class="section-kicker">صلاحيات حساسة</span>
            <h3>طلبات المشرفين</h3>
          </div>
        </div>
        ${pendingAdmins.length ? pendingAdmins.map((user) => `<div class="admin-user-row"><div><strong>${escapeHtml(user.name)}</strong><span>${escapeHtml(user.phone || 'بدون هاتف')} · ${escapeHtml(user.marketId)}</span></div><button class="primary-button" data-approve-admin="${user.id}">اعتماد المشرف</button></div>`).join('') : '<div class="empty-admin">لا توجد طلبات مشرفين معلقة</div>'}
      </div>
    `;
    renderAdminUsers();
    lucide.createIcons();
    renderAdminAgents();
    $('#agentForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const name = $('#agentName').value.trim();
      const phone = $('#agentPhone').value.trim();
      const area = $('#agentArea').value.trim();
      if (!name || !phone) return showToast('اكتب اسم المندوب ورقم الموبايل');
      deliveryAgents.push({ id: `agent-${Date.now()}`, publicId: createPublicId('CRY'), name, phone, area });
      saveDeliveryAgents();
      event.currentTarget.reset();
      renderAdminAgents();
      showToast('تمت إضافة المندوب');
    });
    $$('[data-approve-listing]').forEach((button) => {
      button.onclick = () => {
        const listing = listings.find((item) => item.id === Number(button.dataset.approveListing));
        if (!listing) return;
        const owner = findUser(listing.ownerId);
        const fee = calculateFee(owner?.role, listing.type, listing.price);
        if (!owner || Number(owner.balance || 0) < fee) {
          return showToast(`لا يمكن النشر: يحتاج الحساب إلى ${formatMoney(fee)} رسوم نشر`);
        }
        changeBalance(owner, -fee);
        changeAdminWallet(fee);
        listing.status = 'published';
        listing.fee = fee;
        listing.feeRate = getFeeRate(owner?.role);
        recordTransaction({
          type: 'publishing-fee',
          userId: owner.id,
          payerId: owner.id,
          adminId: adminUser.id,
          listingId: listing.id,
          amount: fee,
          description: `رسوم نشر ${listing.title}`,
        });
        addNotification(owner.id, 'تم اعتماد الإعلان', `${listing.title} أصبح منشورًا في السوق.`);
        saveUsers();
        localStorage.setItem(STORAGE_KEYS.listings, JSON.stringify(listings));
        renderAdmin();
        renderMarket();
        showToast('تم اعتماد الإعلان ونشره في السوق');
      };
    });

    $$('[data-approve-admin]').forEach((button) => {
      button.onclick = () => {
        const user = findUser(button.dataset.approveAdmin);
        if (!user || user.role !== 'admin') return;
        user.status = 'active';
        user.balance = syncAdminWallet();
        recordTransaction({ type: 'admin-approved', userId: user.id, adminId: adminUser.id, amount: 0, description: 'اعتماد حساب مشرف' });
        addNotification(user.id, 'تم اعتماد حساب المشرف', 'يمكنك الآن تسجيل الدخول إلى لوحة الإدارة.');
        saveUsers();
        renderAdmin();
        showToast('تم اعتماد حساب المشرف');
      };
    });

    $$('[data-user-restrict]').forEach((button) => {
      button.onclick = () => {
        const user = findUser(button.dataset.userRestrict);
        const select = $(`[data-user-restrict-select="${button.dataset.userRestrict}"]`);
        if (!user || !select) return;
        Object.keys(getUserRestrictions(user)).forEach((key) => { user.restrictions[key] = false; });
        if (select.value) user.restrictions[select.value] = true;
        saveUsers();
        renderAdminUsers();
        showToast(select.value ? 'تم تطبيق التقييد' : 'تم إلغاء التقييد');
      };
    });

    $$('[data-admin-premium]').forEach((button) => {
      button.onclick = () => {
        const user = findUser(button.dataset.adminPremium);
        if (!user) return;
        user.isPremium = !user.isPremium;
        listings.filter((listing) => listing.ownerId === user.id).forEach((listing) => { listing.isPremium = user.isPremium; });
        saveUsers();
        localStorage.setItem(STORAGE_KEYS.listings, JSON.stringify(listings));
        renderAdminUsers();
        showToast(user.isPremium ? 'تمت ترقية الحساب إلى Premium' : 'تم إلغاء Premium');
      };
    });

    $$('[data-admin-deduct]').forEach((button) => {
      button.onclick = () => {
        const user = findUser(button.dataset.adminDeduct);
        const amount = Number(prompt('اكتب قيمة الخصم بالجنيه', '50'));
        if (!user || !amount || amount < 1 || Number(user.balance || 0) < amount) return showToast('تعذر تنفيذ الخصم');
        changeBalance(user, -amount);
        saveUsers();
        renderAdminUsers();
        showToast('تم خصم المبلغ');
      };
    });

    $$('[data-admin-delete]').forEach((button) => {
      button.onclick = () => {
        const user = findUser(button.dataset.adminDelete);
        if (!user || user.id === currentUser?.id) return;
        if (!confirm(`حذف حساب ${user.name}؟ سيتم نقل رصيده إلى رصيد المشرف.`)) return;
        const balance = Number(user.balance || 0);
        if (balance > 0) {
          changeBalance(user, -balance);
          changeAdminWallet(balance);
        }
        recordTransaction({
          type: 'user-deleted',
          userId: user.id,
          adminId: adminUser.id,
          amount: balance,
          description: `حذف المستخدم ${user.name} ونقل رصيده إلى المشرف`,
        });
        users.splice(users.indexOf(user), 1);
        saveUsers();
        localStorage.setItem(STORAGE_KEYS.listings, JSON.stringify(listings.filter((listing) => listing.ownerId !== user.id)));
        renderAdmin();
        showToast(`تم حذف ${user.name} ونقل ${formatMoney(balance)} للمشرف`);
      };
    });

    $$('[data-admin-report]').forEach((button) => {
      button.onclick = () => renderReport(button.dataset.adminReport);
    });

    $$('[data-admin-approve-user]').forEach((button) => {
      button.onclick = () => {
        const user = findUser(button.dataset.adminApproveUser);
        if (!user) return;
        user.status = 'active';
        recordTransaction({
          type: 'account-approved',
          userId: user.id,
          adminId: adminUser.id,
          amount: 0,
          description: 'اعتماد الحساب من المشرف',
        });
        saveUsers();
        renderAdminUsers();
        showToast(`تم تفعيل حساب ${user.name}`);
      };
    });

    $('#adminUserSearch').addEventListener('input', renderAdminUsers);
  }

  function renderReviewStars(rating) {
    return `${'★'.repeat(Math.max(0, Math.min(5, Number(rating) || 0)))}${'☆'.repeat(5 - Math.max(0, Math.min(5, Number(rating) || 0)))}`;
  }

  function renderMarketFeedback() {
    const publicReviews = reviews.filter((review) => !review.listingId).slice(-5).reverse();
    const average = publicReviews.length
      ? (publicReviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / publicReviews.length).toFixed(1)
      : '—';
    return `
      <section class="market-feedback" id="marketFeedback">
        <div class="market-feedback-heading">
          <div>
            <span class="section-kicker"><i data-lucide="message-square-heart"></i> رأي المستخدمين</span>
            <h2>التقييمات والتعليقات</h2>
            <p>شارك تجربتك مع السوق وساعد غيرك يختار بشكل أوضح.</p>
          </div>
          <div class="market-rating-summary"><strong>${average}</strong><span>${average === '—' ? 'لا توجد تقييمات بعد' : `${publicReviews.length} تقييم`}</span></div>
        </div>
        <div class="market-feedback-layout">
          <div class="market-review-list">
            ${publicReviews.length ? publicReviews.map((review) => `
              <article class="review-item">
                <div class="review-item-top"><strong>${escapeHtml(review.userName)}</strong><span>${renderReviewStars(review.rating)}</span></div>
                <p>${escapeHtml(review.text)}</p>
                <small>${escapeHtml(review.createdAt ? formatDate(review.createdAt) : '')}</small>
              </article>
            `).join('') : '<div class="review-empty">كن أول من يقيّم تجربة السوق.</div>'}
          </div>
          <form class="review-form" data-market-review-form>
            <h3>أضف تقييمك</h3>
            <label>التقييم<select name="rating"><option value="5">٥ نجوم</option><option value="4">٤ نجوم</option><option value="3">٣ نجوم</option><option value="2">نجمتان</option><option value="1">نجمة واحدة</option></select></label>
            <label>تعليقك<textarea name="text" rows="3" required placeholder="اكتب رأيك في تجربة السوق..."></textarea></label>
            <button class="primary-button" type="submit"><i data-lucide="send"></i> نشر التقييم</button>
          </form>
        </div>
      </section>
    `;
  }

  function renderListingRating(listing) {
    const listingReviews = reviews.filter((review) => String(review.listingId) === String(listing.id));
    const average = listingReviews.length
      ? (listingReviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / listingReviews.length).toFixed(1)
      : '—';
    const stars = average === '—' ? '☆☆☆☆☆' : renderReviewStars(Number(average));
    return `
      <div class="listing-rating">
        <span class="listing-rating-stars">${stars}</span>
        ${average !== '—' ? `<strong>${average}</strong>` : '<span class="listing-rating-empty">لا يوجد تقييم</span>'}
      </div>
    `;
  }

  function renderListingDiscussion(listing) {
    const listingReviews = reviews.filter((review) => String(review.listingId) === String(listing.id));
    return `
      <div class="listing-discussion">
        <div class="discussion-heading"><strong>أسئلة وتعليقات</strong><span>${listingReviews.length}</span></div>
        ${listingReviews.length ? `<div class="discussion-list">${listingReviews.slice(-3).map((review) => `
          <div class="discussion-item"><strong>${escapeHtml(review.userName)}</strong><span class="discussion-kind">${review.kind === 'question' ? 'سؤال' : 'تعليق'}</span><p>${escapeHtml(review.text)}</p></div>
        `).join('')}</div>` : '<p class="discussion-empty">لا توجد أسئلة أو تعليقات بعد.</p>'}
        <form class="discussion-form" data-listing-review-form data-listing-id="${listing.id}">
          <select name="kind" aria-label="نوع المشاركة"><option value="question">سؤال</option><option value="comment">تعليق</option></select>
          <input name="text" required placeholder="اكتب سؤالًا أو تعليقًا..." aria-label="سؤال أو تعليق" />
          <button class="outline-button" type="submit">إرسال</button>
        </form>
      </div>
    `;
  }

  function renderMarketListingCard(listing) {
    const seller = findUser(listing.ownerId);
    const isOwner = currentUser && String(currentUser.id) === String(listing.ownerId);
    const actionLabel = listing.type === 'service' ? 'اطلب الخدمة' : 'شراء المنتج';
    const contactPhone = listing.ownerPhone || seller?.phone || '';
    const dialPhone = contactPhone.replace(/[^\d+]/g, '');
    return `
      <article class="listing-card ${listing.type === 'service' ? 'service-card' : 'product-card'}">
        ${listing.mediaData && listing.mediaType.startsWith('image/') ? `<img class="listing-media" src="${escapeHtml(listing.mediaData)}" alt="${escapeHtml(listing.title)}" loading="lazy" />` : listing.mediaData && listing.mediaType.startsWith('video/') ? `<video class="listing-media" src="${escapeHtml(listing.mediaData)}" controls preload="metadata"></video>` : ''}
        <div class="listing-card-header"><h3>${escapeHtml(listing.title)}</h3></div>
        <div class="listing-card-meta"><strong>${formatMoney(listing.price)}</strong>${renderListingRating(listing)}</div>
        <small class="market-listing-code">المعرّف: ${escapeHtml(listing.publicId || '')}</small>
        <p class="market-listing-description">${escapeHtml(listing.notes || 'تواصل مع البائع لمعرفة التفاصيل.')}</p>
        <div class="market-listing-seller"><span>البائع</span>${seller ? `<button type="button" data-user-profile="${escapeHtml(seller.id)}">${escapeHtml(seller.name)}</button>` : `<span>${escapeHtml(listing.ownerName || 'بائع ASTRA')}</span>`}</div>
        <div class="market-listing-actions">
          ${isOwner ? `<span class="listing-owner-label">إعلانك</span><button class="outline-button danger-button" type="button" data-delete-listing="${escapeHtml(listing.id)}"><i data-lucide="trash-2"></i> حذف المنشور</button>` : `<button class="primary-button" type="button" data-buy-listing="${escapeHtml(listing.id)}"><i data-lucide="shopping-bag"></i> ${actionLabel}</button>${dialPhone ? `<a class="outline-button listing-phone-link" href="tel:${escapeHtml(dialPhone)}"><i data-lucide="phone"></i> اتصال ${escapeHtml(contactPhone)}</a>` : ''}`}
        </div>
      </article>
    `;
  }

  async function deleteOwnListing(listingId) {
    const listing = listings.find((item) => String(item.id) === String(listingId));
    if (!listing || !currentUser || String(listing.ownerId) !== String(currentUser.id)) return;
    if (!confirm(`حذف منشور «${listing.title}» من السوق؟`)) return;
    try {
      await apiRequest(`/listings/${encodeURIComponent(listing.id)}`, { method: 'DELETE' });
      listings.splice(listings.indexOf(listing), 1);
      localStorage.setItem(STORAGE_KEYS.listings, JSON.stringify(listings));
      currentUser.ads = userListings(currentUser.id).length;
      saveCurrentUser();
      renderMarket();
      if (!$('#walletView').classList.contains('hidden')) renderWallet();
      showToast('تم حذف منشورك من السوق');
    } catch (error) {
      showToast(error.message);
    }
  }

  function handleReviewSubmit(event) {
    event.preventDefault();
    if (!currentUser) return openAuth('login');
    const form = event.target;
    const text = form.querySelector('[name="text"]').value.trim();
    if (!text) return showToast('اكتب تعليقك أولًا');
    reviews.push({
      id: Date.now(),
      listingId: form.dataset.listingId || null,
      kind: form.querySelector('[name="kind"]')?.value || 'comment',
      rating: Number(form.querySelector('[name="rating"]')?.value || 0),
      text,
      userId: currentUser.id,
      userName: currentUser.name,
      createdAt: new Date().toISOString(),
    });
    saveReviews();
    renderMarket();
    showToast('تم نشر مشاركتك');
  }

  function renderMarket() {
    renderMarketHighlights();

    const categoryTypes = state.marketFilter === 'services' ? ['service'] : state.marketFilter === 'products' ? ['product'] : ['product', 'service'];
    const categories = [...new Set(listings.filter((listing) => listing.status === 'published' && categoryTypes.includes(listing.type)).map((listing) => listing.category).filter(Boolean))].sort();
    const categorySelect = $('#marketCategory');
    if (categorySelect) {
      categorySelect.innerHTML = '<option value="all">كل التصنيفات</option>' + categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
      categorySelect.value = categories.includes(state.marketCategory) ? state.marketCategory : 'all';
      state.marketCategory = categorySelect.value;
    }
    $('#marketCategoryWrap')?.classList.toggle('hidden', state.marketFilter === 'all');

    const approved = listings.filter((listing) => {
      const matchesType =
        state.marketFilter === 'all' ||
        listing.type === (state.marketFilter === 'services' ? 'service' : 'product');
      const query = state.marketQuery.toLowerCase();
      const matchesQuery =
        !query || `${listing.title} ${listing.category} ${listing.notes}`.toLowerCase().includes(query);
      const matchesCategory = state.marketCategory === 'all' || listing.category === state.marketCategory;
      return listing.status === 'published' && matchesType && matchesQuery && (state.marketFilter === 'all' || matchesCategory);
    });
    approved.sort((first, second) => {
      if (state.marketSort === 'newest') return new Date(second.createdAt || 0) - new Date(first.createdAt || 0);
      if (state.marketSort === 'price-low') return Number(first.price || 0) - Number(second.price || 0);
      if (state.marketSort === 'price-high') return Number(second.price || 0) - Number(first.price || 0);
      return Number(second.isPremium) - Number(first.isPremium);
    });
    $('#marketActiveCount') && ($('#marketActiveCount').textContent = listings.filter((listing) => listing.status === 'published').length.toLocaleString('ar-EG'));
    $('#marketStoreCount') && ($('#marketStoreCount').textContent = new Set(listings.filter((listing) => listing.status === 'published').map((listing) => listing.ownerId)).size.toLocaleString('ar-EG'));
    $('#marketResults').classList.toggle('list-layout', state.marketLayout === 'list');

    const market = $('#marketResults');
    market.classList.toggle('is-empty', !approved.length);
    if (!approved.length) {
      const hasPublished = listings.some((listing) => listing.status === 'published');
      const hasSearch = Boolean(state.marketQuery);
      const marketPaused = state.marketStatus !== 'open';
      market.innerHTML = `
        <div class="empty-icon"><i data-lucide="${marketPaused ? 'pause-circle' : hasSearch || hasPublished ? 'search-x' : 'store'}"></i></div>
        <span class="section-kicker">${marketPaused ? 'السوق متوقف مؤقتًا' : hasSearch || hasPublished ? 'غيّر البحث' : 'السوق يتجهز'}</span>
        <h2>${marketPaused ? 'السوق مغلق مؤقتًا' : hasSearch || hasPublished ? 'لا توجد نتائج مطابقة' : 'لا توجد إعلانات منشورة بعد'}</h2>
        <p>${marketPaused ? 'سيعود التصفح والشراء عند إعادة فتح السوق.' : hasSearch ? 'ما لقيناش المنتج اللي بتدور عليه؟ أضفه في طلبات المنتجات.' : hasPublished ? 'جرّب كلمة أخرى أو اختر نوعًا مختلفًا من الإعلانات.' : 'تظهر الإعلانات هنا بعد اعتمادها من إدارة السوق.'}</p>
        ${marketPaused ? '' : hasSearch ? '<button class="primary-button" type="button" data-open-wanted-request><i data-lucide="plus"></i> أضف المنتج المطلوب</button>' : hasPublished ? '' : '<button class="primary-button" data-open-auth="signup"><i data-lucide="plus"></i> أنشئ أول إعلان</button>'}
      `;
      market.querySelector('[data-open-wanted-request]')?.addEventListener('click', () => {
        $('#wantedProductName').value = state.marketQuery;
        switchView('wanted-products');
      });
    } else {
      const groupedListings = categoryTypes
        .map((type) => ({
          type,
          categories: [...new Set(approved.filter((listing) => listing.type === type).map((listing) => listing.category || 'أخرى'))]
            .sort()
            .map((category) => ({
              category,
              listings: approved.filter((listing) => listing.type === type && (listing.category || 'أخرى') === category),
            })),
        }))
        .filter((group) => group.categories.length);

      market.innerHTML = `
        <div class="section-heading">
          <div>
            <span class="section-kicker">إعلانات السوق</span>
            <h2>اختيارات حسب النوع والتصنيف</h2>
          </div>
        </div>
        ${groupedListings.map((group) => `
          <section class="market-type-section">
            <div class="market-type-heading">
              <span class="market-type-icon"><i data-lucide="${group.type === 'service' ? 'briefcase-business' : 'package'}"></i></span>
              <div><span class="section-kicker">${group.type === 'service' ? 'خدمات' : 'منتجات'}</span><h3>${group.type === 'service' ? 'خدمات حسب التصنيف' : 'منتجات حسب التصنيف'}</h3></div>
            </div>
            ${group.categories.map((categoryGroup) => `
              <div class="market-category-group">
                <h4>${escapeHtml(categoryGroup.category)}</h4>
                <div class="listing-grid">
                  ${categoryGroup.listings.map(renderMarketListingCard).join('')}
                </div>
              </div>
            `).join('')}
          </section>
        `).join('')}
      `;
    }
    $('#marketFeedbackContainer').innerHTML = renderMarketFeedback();
    lucide.createIcons();
  }

  function renderWantedProducts() {
    const list = $('#wantedRequestList');
    if (!list) return;
    $('#wantedRequestCount').textContent = `${wantedRequests.length.toLocaleString('ar-EG')} طلب`;
    list.innerHTML = wantedRequests.length
      ? [...wantedRequests].reverse().map((request) => `
          <article class="wanted-request-card">
            <img src="${escapeHtml(request.imageData)}" alt="${escapeHtml(request.title)}" loading="lazy" />
            <div class="wanted-request-copy">
              <h3>${escapeHtml(request.title)}</h3>
              <p>${escapeHtml(request.description)}</p>
              <time datetime="${escapeHtml(request.createdAt)}">${escapeHtml(formatDate(request.createdAt))}</time>
            </div>
          </article>
        `).join('')
      : '<div class="wanted-request-empty"><i data-lucide="package-search"></i><h3>لسه مفيش طلبات</h3><p>أضف أول منتج بتدور عليه.</p></div>';
    lucide.createIcons();
  }

  async function handleWantedRequestSubmit(event) {
    event.preventDefault();
    const requestForm = event.currentTarget;
    const form = new FormData(requestForm);
    const file = $('#wantedProductImage').files[0];
    if (!file || !file.type.startsWith('image/')) return showToast('اختار صورة للمنتج');
    if (file.size > 2 * 1024 * 1024) return showToast('حجم الصورة يجب ألا يتجاوز ٢ ميجابايت');

    let imageData;
    try {
      imageData = await readFileAsDataUrl(file);
    } catch {
      return showToast('تعذر قراءة الصورة، جرّب صورة أخرى');
    }

    const request = {
      id: Date.now(),
      title: String(form.get('title')).trim(),
      description: String(form.get('description')).trim(),
      imageData,
      createdAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem('souq-wanted-products', JSON.stringify([...wantedRequests, request]));
    } catch {
      return showToast('تعذر حفظ الطلب، جرّب صورة أصغر');
    }
    wantedRequests.push(request);
    requestForm.reset();
    renderWantedProducts();
    showToast('تم نشر طلب المنتج');
  }

  function bindAuth() {
    $$('[data-open-auth]').forEach((button) => {
      button.onclick = () => openAuth(button.dataset.openAuth);
    });
  }

  function bindViewLinks() {
    $$('[data-view-link]').forEach((link) => {
      link.onclick = (event) => {
        event.preventDefault();
        const view = link.dataset.viewLink;
        if (view === 'admin') return (window.location.href = 'admin.html');
        if (view === 'wallet' && !currentUser) return openAuth('login');
        switchView(view);
      };
    });
  }

  function switchView(view) {
    if (view === 'admin') return (window.location.href = 'admin.html');
    $$('[data-view]').forEach((section) =>
      section.classList.toggle('hidden', section.dataset.view !== view),
    );
    $$('.main-nav a').forEach((link) =>
      link.classList.toggle('active', link.dataset.viewLink === view),
    );
    if ($('#userDropdown')) $('#userDropdown').classList.add('hidden');
    if (view === 'wallet') renderWallet();
    if (view === 'admin') renderAdmin();
    if (view === 'wanted-products') renderWantedProducts();
    updateBalanceWidget();
    history.replaceState(null, '', `#${view}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function routeFromHash() {
    const view = location.hash.slice(1) || 'home';
    if (!['home', 'market-listings', 'market-reviews', 'wanted-products', 'wallet', 'admin', 'help'].includes(view)) return;
    if (view === 'admin') return (window.location.href = 'admin.html');
    if (view === 'wallet' && !currentUser) return openAuth('login');
    if (view === 'admin' && currentUser?.role !== 'admin') {
      return showToast('هذه الصفحة للمدير فقط');
    }
    switchView(view);
  }

  function updateAccountActions() {
    const container = $('#accountActions');
    const adminAccessButton = $('#adminAccessButton');
    if (adminAccessButton) {
      adminAccessButton.classList.toggle('hidden', Boolean(currentUser || localStorage.getItem(API_TOKEN_KEY)));
    }
    if (!currentUser) {
      container.innerHTML = '<button class="outline-button" data-open-auth="login">تسجيل الدخول</button><button class="primary-button" data-open-auth="signup">إنشاء حساب</button>';
      bindAuth();
      bindViewLinks();
      updateBalanceWidget();
      updateWelcomeSection();
      updateNotificationsBadge();
      return;
    }

    const notificationsButton = $('#notificationsButton');
    if (notificationsButton) {
      notificationsButton.classList.remove('hidden');
    }

    container.innerHTML = `
      <div class="user-menu">
        <button class="user-button" id="userButton">
          <span class="profile-avatar ${currentUser.role === 'admin' ? 'admin-avatar' : ''}">${escapeHtml(currentUser.name[0])}</span>
          <span>${currentUser.role === 'admin' ? 'مدير النظام' : escapeHtml(currentUser.name)}</span>
          <i data-lucide="chevron-down"></i>
        </button>
        <div class="user-dropdown hidden" id="userDropdown">
          <button data-view-link="wallet"><i data-lucide="user-round"></i> الصفحة الشخصية</button>
          ${currentUser.role === 'admin' ? '<a href="admin.html"><i data-lucide="layout-dashboard"></i> لوحة الإدارة المنفصلة</a>' : '<button data-action="create-ad"><i data-lucide="plus"></i> إضافة إعلان</button>'}
          <button data-action="profile"><i data-lucide="user-round"></i> ملفي</button>
          <button data-action="notifications"><i data-lucide="bell"></i> إشعارات</button>
          <button id="logoutButton"><i data-lucide="log-out"></i> تسجيل الخروج</button>
        </div>
      </div>
    `;

    lucide.createIcons();
    bindAuth();
    bindViewLinks();

    const userButton = $('#userButton');
    if (userButton) {
      userButton.addEventListener('click', () => $('#userDropdown').classList.toggle('hidden'));
    }

    const logoutButton = $('#logoutButton');
    if (logoutButton) {
      logoutButton.addEventListener('click', () => {
        currentUser = null;
          localStorage.removeItem(API_TOKEN_KEY);
        localStorage.removeItem(STORAGE_KEYS.currentUser);
        updateAccountActions();
        switchView('home');
        showToast('تم تسجيل الخروج');
      });
    }

    $$('[data-action="create-ad"]').forEach((button) => {
      button.onclick = openListingModal;
    });
    $$('[data-action="profile"]').forEach((button) => {
      button.onclick = () => renderProfile(currentUser.id);
    });
    $$('[data-action="notifications"]').forEach((button) => {
      button.onclick = openNotifications;
    });

    updateBalanceWidget();
    updateWelcomeSection();
    updateNotificationsBadge();
  }

  function openNotifications() {
    if (!currentUser) return openAuth('login');
    $('#notificationsModal').classList.remove('hidden');
    renderNotifications();
  }

  function openListingModal() {
    if (!currentUser) return openAuth('login');
    if (currentUser.role === 'courier') return showToast('حساب المندوب مخصص لاستقبال طلبات التوصيل فقط');
    if (getUserRestrictions(currentUser).posting) {
      return showToast('تم تقييدك من نشر الإعلانات مؤقتًا');
    }
    $('#listingModal').classList.remove('hidden');
    $('#listingName').focus();
  }

  function closeListingModal() {
    $('#listingModal').classList.add('hidden');
    $('#listingForm').reset();
    updateFeePreview();
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('تعذر قراءة الملف'));
      reader.readAsDataURL(file);
    });
  }

  function updateFeePreview() {
    const price = Number($('#listingPrice').value || 0);
    const preview = $('#feePreview strong');
    if (!price) return (preview.textContent = 'أدخل السعر لمعرفة الرسوم');
    const fee = calculateFee(currentUser?.role || 'customer', $('#listingType').value, price);
    preview.textContent = `${formatMoney(fee)} (${formatFeeRate(getFeeRate(currentUser?.role || 'customer', $('#listingType').value, price))})`;
  }

  async function handleListingSubmit(event) {
    event.preventDefault();
    if (!currentUser) return openAuth('login');
    if (getUserRestrictions(currentUser).posting) {
      return showToast('تم تقييدك من نشر الإعلانات مؤقتًا');
    }
    const form = new FormData(event.currentTarget);
    const price = Number(form.get('price'));
    const file = $('#listingMedia').files[0];
    if (!price || price < 1) return showToast('اكتب سعرًا صحيحًا');
    if (file && file.size > 2 * 1024 * 1024) return showToast('حجم الملف يجب ألا يتجاوز ٢ ميجابايت');
    let mediaData = '';
    if (file) {
      try {
        mediaData = await readFileAsDataUrl(file);
      } catch {
        return showToast('تعذر قراءة الملف، جرّب ملفًا آخر');
      }
    }

    const listingData = {
      title: String(form.get('title')).trim(),
      type: String(form.get('type')),
      category: String(form.get('category')),
      price,
      notes: String(form.get('notes')).trim(),
      mediaType: file?.type || '',
      mediaData,
      facebookUrl: String(form.get('facebookUrl') || currentUser.facebook || '').trim(),
    };
    let created;
    try {
      created = await apiRequest('/listings', { method: 'POST', body: JSON.stringify(listingData) });
    } catch (error) {
      return showToast(error.message);
    }
    const listing = fromApiListing({ ...listingData, ...created, ownerId: currentUser.id, ownerName: currentUser.name, ownerPhone: currentUser.phone, status: created.status, createdAt: new Date().toISOString() });
    listings.unshift(listing);
    localStorage.setItem(STORAGE_KEYS.listings, JSON.stringify(listings));
    currentUser.ads = userListings(currentUser.id).length;
    saveCurrentUser();
    closeListingModal();
    renderMarket();
    renderWallet();
    showToast(created.status === 'published' ? 'تم نشر الإعلان في السوق' : 'تم إرسال الإعلان للمراجعة');
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const phone = (form.get('phone') || '').toString().trim();
    const password = form.get('password')?.toString();
    const passwordConfirm = form.get('passwordConfirm')?.toString();

    if (state.authMode === 'signup') {
      if (!phone) return showToast('رقم الموبايل مطلوب لإنشاء الحساب');
      if (password !== passwordConfirm) return showToast('كلمتا المرور غير متطابقتين');
      if (String(password || '').length < 10) return showToast('كلمة المرور يجب ألا تقل عن ١٠ أحرف');
    }
    const signingUp = state.authMode === 'signup';
    const path = signingUp ? '/auth/signup' : '/auth/login';
    const body = signingUp
      ? { name: String(form.get('name') || 'مستخدم ASTRA').trim(), phone, password, role: form.get('role') || 'customer', facebook: '', location: '' }
      : { phone, password };
    try {
      const result = await apiRequest(path, { method: 'POST', body: JSON.stringify(body) });
      if (signingUp) {
        showPendingSignup(fromApiUser(result.user));
        showToast('تم إرسال طلبك للتفعيل. لن تتمكن من النشر أو الشراء قبل موافقة المشرف.');
        return;
      }
      localStorage.setItem(API_TOKEN_KEY, result.token);
      currentUser = upsertMarketUser(fromApiUser(result.user));
      saveUsers();
      saveCurrentUser();
      $('#authModal').classList.add('hidden');
      updateAccountActions();
      await refreshMarketData().catch(() => {});
      if (!signingUp) switchView('market-listings');
      showToast(signingUp ? 'تم إنشاء حسابك ويمكنك البدء فورًا' : 'تم تسجيل الدخول');
    } catch (error) {
      showToast(error.message);
    }
  }

  async function handleRechargeSubmit(event) {
    event.preventDefault();
    if (!currentUser) return openAuth('login');
    if (getUserRestrictions(currentUser).recharge) {
      return showToast('تم تقييدك من شحن الرصيد مؤقتًا');
    }
    const amount = Number($('#customRechargeAmount').value);
    if (amount < 10) return showToast('اكتب قيمة شحن لا تقل عن ١٠ جنيهات');
    const proofType = $('input[name=proofType]:checked').value;
    const transferNumber = $('#transferNumber').value.trim();
    const receipt = $('#transferReceipt').files[0];
    if (proofType === 'number' && !transferNumber) return showToast('اكتب رقم الهاتف الذي حوّلت منه المبلغ');
    if (proofType === 'receipt' && !receipt) return showToast('اختر صورة إيصال التحويل أولاً');
    if (receipt && receipt.size > 5 * 1024 * 1024) return showToast('حجم صورة الإيصال يجب ألا يتجاوز ٥ ميجابايت');

    let request;
    try {
      request = await apiRequest('/recharges', {
        method: 'POST',
        body: JSON.stringify({ amount, proofType, transferNumber: proofType === 'number' ? transferNumber : '', receiptName: proofType === 'receipt' ? receipt.name : '' }),
      });
    } catch (error) {
      return showToast(error.message);
    }
    rechargeRequests.push({
      id: request.id,
      publicId: request.publicId,
      userId: currentUser.id,
      marketId: currentUser.marketId,
      userName: currentUser.name,
      amount,
      proofType,
      transferNumber: proofType === 'number' ? transferNumber : '',
      receiptName: proofType === 'receipt' ? receipt.name : '',
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    localStorage.setItem(STORAGE_KEYS.rechargeRequests, JSON.stringify(rechargeRequests));
    closeRechargeModal();
    const proofMessage = proofType === 'number' ? `رقم التحويل: ${transferNumber}` : `سأرفق صورة الإيصال (${receipt.name}) في هذه المحادثة`;
    const message = `طلب شحن رصيد - ASTRA\nالاسم: ${currentUser.name}\nالمعرّف: ${currentUser.marketId}\nالقيمة: ${formatMoney(amount)}\n${proofMessage}`;
    window.open(`https://wa.me/201037572742?text=${encodeURIComponent(message)}`, '_blank');
    showToast(proofType === 'receipt' ? 'تم تجهيز واتساب، أرفق صورة الإيصال في المحادثة' : 'تم إرسال الطلب وفتح واتساب');
  }

  const modalCloseHandlers = {
    'data-close-modal': '#authModal',
    'data-close-admin-access': '#adminAccessModal',
    'data-close-purchase': '#purchaseModal',
    'data-close-agents': '#agentsModal',
    'data-close-listing': '#listingModal',
    'data-close-recharge': '#rechargeModal',
    'data-close-transfer': '#transferModal',
    'data-close-edit-account': '#editAccountModal',
    'data-close-report': '#reportModal',
    'data-close-pending': '#authModal',
    'data-close-notifications': '#notificationsModal',
    'data-close-profile': '#profileModal',
    'data-close-chat': '#chatModal',
  };

  Object.entries(modalCloseHandlers).forEach(([selector, modalId]) => {
    document.querySelectorAll(`[${selector}]`).forEach((button) => {
      button.onclick = () => $(modalId).classList.add('hidden');
    });
  });

  $('#authModal').addEventListener('click', (event) => {
    if (event.target === $('#authModal')) $('#authModal').classList.add('hidden');
  });
  $('#adminAccessModal').addEventListener('click', (event) => {
    if (event.target === $('#adminAccessModal')) $('#adminAccessModal').classList.add('hidden');
  });
  $('#purchaseModal').addEventListener('click', (event) => {
    if (event.target === $('#purchaseModal')) $('#purchaseModal').classList.add('hidden');
  });
  $('#agentsModal').addEventListener('click', (event) => {
    if (event.target === $('#agentsModal')) $('#agentsModal').classList.add('hidden');
  });
  $('#listingModal').addEventListener('click', (event) => {
    if (event.target === $('#listingModal')) closeListingModal();
  });
  $('#rechargeModal').addEventListener('click', (event) => {
    if (event.target === $('#rechargeModal')) closeRechargeModal();
  });
  $('#transferModal').addEventListener('click', (event) => {
    if (event.target === $('#transferModal')) $('#transferModal').classList.add('hidden');
  });
  $('#editAccountModal').addEventListener('click', (event) => {
    if (event.target === $('#editAccountModal')) $('#editAccountModal').classList.add('hidden');
  });
  $('#reportModal').addEventListener('click', (event) => {
    if (event.target === $('#reportModal')) $('#reportModal').classList.add('hidden');
  });
  $('#notificationsModal').addEventListener('click', (event) => {
    if (event.target === $('#notificationsModal')) $('#notificationsModal').classList.add('hidden');
  });
  $('#profileModal').addEventListener('click', (event) => {
    if (event.target === $('#profileModal')) $('#profileModal').classList.add('hidden');
  });
  $('#chatModal').addEventListener('click', (event) => {
    if (event.target === $('#chatModal')) $('#chatModal').classList.add('hidden');
  });

  $$('[data-password-target]').forEach((button) =>
    button.addEventListener('click', () => {
      const input = $(`#${button.dataset.passwordTarget}`);
      input.type = input.type === 'password' ? 'text' : 'password';
      button.setAttribute(
        'aria-label',
        input.type === 'password' ? 'إظهار كلمة المرور' : 'إخفاء كلمة المرور',
      );
    }),
  );

  $('#authForm').addEventListener('submit', handleAuthSubmit);
  $('#wantedRequestForm').addEventListener('submit', handleWantedRequestSubmit);
  $('#listingForm').addEventListener('submit', handleListingSubmit);
  $('#purchaseForm').addEventListener('submit', (event) => {
    event.preventDefault();
    handlePurchaseSubmit();
  });
  $('#rechargeForm').addEventListener('submit', handleRechargeSubmit);
  $('#transferForm').addEventListener('submit', (event) => {
    event.preventDefault();
    handleTransfer();
  });
  $('#editAccountForm').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!currentUser) return;
    const name = $('#editAccountName').value.trim();
    const password = $('#editAccountPassword').value;
    if (!name) return showToast('أكمل اسم الحساب');
    if (password && password.length < 6) return showToast('كلمة المرور يجب ألا تقل عن ٦ أحرف');
    const user = users.find((item) => item.id === currentUser.id);
    if (!user) return;
    user.name = name;
    if (password) user.password = password;
    user.facebook = $('#editAccountFacebook').value.trim();
    user.location = $('#editAccountLocation').value.trim();
    recordTransaction({
      type: 'account-updated',
      userId: user.id,
      amount: 0,
      description: 'تعديل بيانات الحساب',
    });
    saveUsers();
    syncCurrentUser();
    $('#editAccountModal').classList.add('hidden');
    updateAccountActions();
    renderWallet();
    showToast('تم تحديث بيانات الحساب');
  });

  $$('[data-recharge-amount]').forEach((button) =>
    button.addEventListener('click', () => {
      $$('[data-recharge-amount]').forEach((item) => item.classList.remove('selected'));
      button.classList.add('selected');
      $('#customRechargeAmount').value = button.dataset.rechargeAmount;
    }),
  );

  $$('input[name="proofType"]').forEach((radio) =>
    radio.addEventListener('change', () => {
      const receipt = radio.value === 'receipt' && radio.checked;
      $('#transferNumberField').classList.toggle('hidden', receipt);
      $('#transferReceiptField').classList.toggle('hidden', !receipt);
    }),
  );

  $('#listingPrice').addEventListener('input', updateFeePreview);
  $('#listingType').addEventListener('change', updateFeePreview);

  $('[data-open-agents]').addEventListener('click', () => {
    renderDeliveryAgents();
    $('#agentsModal').classList.remove('hidden');
  });

  $('#adminAccessButton').addEventListener('click', () => {
    $('#adminAccessModal').classList.remove('hidden');
    lucide.createIcons();
  });

  $$('input[name="paymentMethod"], input[name="deliveryMethod"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const group = radio.name;
      $$(`input[name="${group}"]`).forEach((item) => {
        item.closest('.choice-card')?.classList.toggle('selected', item.checked);
      });
      if (group === 'deliveryMethod') {
        const courierSelected = radio.value === 'courier' && radio.checked;
        $('#purchaseCourierField').classList.toggle('hidden', !courierSelected);
      }
      updatePurchaseSummary();
    });
  });

  $('#marketSearchButton').addEventListener('click', () => {
    state.marketQuery = $('#marketSearch').value.trim();
    renderMarket();
    showToast(state.marketQuery ? 'تم تحديث نتائج البحث' : 'نعرض كل الإعلانات');
  });
  $('#marketSearch').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') $('#marketSearchButton').click();
  });

  $$('.market-filter button').forEach((button) =>
    button.addEventListener('click', () => {
      $$('.market-filter button').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      state.marketFilter = button.dataset.marketFilter;
      renderMarket();
    }),
  );

  $('#marketCategory').addEventListener('change', (event) => {
    state.marketCategory = event.currentTarget.value;
    renderMarket();
  });

  $('#marketSort').addEventListener('change', (event) => {
    state.marketSort = event.currentTarget.value;
    renderMarket();
  });

  $$('[data-market-layout]').forEach((button) => {
    button.addEventListener('click', () => {
      $$('[data-market-layout]').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      state.marketLayout = button.dataset.marketLayout;
      renderMarket();
    });
  });

  $$('[data-market-pill]').forEach((button) => {
    button.addEventListener('click', () => {
      $$('[data-market-pill]').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      state.marketQuery = button.dataset.marketPill === 'all' ? '' : button.textContent.trim();
      $('#marketSearch').value = state.marketQuery;
      renderMarket();
    });
  });

  document.addEventListener('click', async (event) => {
    const deleteListingButton = event.target.closest('[data-delete-listing]');
    if (deleteListingButton) {
      await deleteOwnListing(deleteListingButton.dataset.deleteListing);
      return;
    }

    const authTab = event.target.closest('[data-auth-tab]');
    if (authTab) {
      openAuth(authTab.dataset.authTab);
      return;
    }

    const profileButton = event.target.closest('[data-user-profile]');
    if (profileButton) {
      renderProfile(profileButton.dataset.userProfile);
      return;
    }

    const buyButton = event.target.closest('[data-buy-listing]');
    if (buyButton) {
      buyListing(buyButton.dataset.buyListing);
      return;
    }

    const deliveryStatusButton = event.target.closest('[data-delivery-status]');
    if (deliveryStatusButton) {
      const request = deliveryRequests.find((item) => String(item.id) === String(deliveryStatusButton.dataset.deliveryId));
      if (!request || String(request.courierId) !== String(currentUser?.id)) return;
      try {
        await apiRequest(`/courier/requests/${encodeURIComponent(request.id)}/status`, { method: 'PATCH', body: JSON.stringify({ status: deliveryStatusButton.dataset.deliveryStatus }) });
      } catch (error) {
        return showToast(error.message);
      }
      request.status = deliveryStatusButton.dataset.deliveryStatus === 'delivered' ? 'تم التسليم' : 'تم قبول الطلب';
      saveDeliveryRequests();
      renderWallet();
      showToast('تم تحديث حالة طلب التوصيل');
      return;
    }

    const focusChat = event.target.closest('[data-open-chat]');
    if (focusChat) {
      openChat(focusChat.dataset.openChat);
      return;
    }

    const toggleFollowButton = event.target.closest('[data-toggle-follow]');
    if (toggleFollowButton) {
      toggleFollow(toggleFollowButton.dataset.toggleFollow);
      return;
    }

    const pushNotification = event.target.closest('#notificationsButton');
    if (pushNotification) {
      openNotifications();
      return;
    }
  });

  document.addEventListener('submit', (event) => {
    if (event.target.matches('[data-market-review-form], [data-listing-review-form]')) {
      handleReviewSubmit(event);
    }
  });

  $('#chatForm').addEventListener('submit', sendChatMessage);

  updateAccountActions();
  renderMarket();
  renderWallet();
  refreshMarketData().catch(() => showToast('تعذر الاتصال بالسوق، أعد تحميل الصفحة'));
  window.addEventListener('focus', () => refreshMarketData().catch(() => {}));
  window.setInterval(() => refreshMarketData().catch(() => {}), 30000);
  window.addEventListener('hashchange', routeFromHash);
  routeFromHash();
  updateNotificationsBadge();
})();

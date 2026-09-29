import crypto from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { installCommerce } from './commerce.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const db = new DatabaseSync(process.env.ORBIT_DB_PATH || path.join(__dirname, 'orbit.sqlite'));
if (process.env.NODE_ENV === 'production' && (!process.env.ORBIT_JWT_SECRET || !process.env.ORBIT_ADMIN_PASSWORD || !process.env.ORBIT_ADMIN_PHONE)) {
  throw new Error('ORBIT_JWT_SECRET وبيانات المشرف مطلوبة في بيئة الإنتاج');
}
const jwtSecret = process.env.ORBIT_JWT_SECRET || 'orbit-development-secret-change-before-production';
const port = Number(process.env.PORT || 3000);

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.json({ limit: '7mb' }));
app.use('/private-uploads', (_req, res) => res.sendStatus(404));
app.use('/product-images', express.static(process.env.ORBIT_PRODUCT_IMAGES || path.join(__dirname, 'product-images'), { fallthrough: true, maxAge: '1d' }));
app.use((req, res, next) => {
  if (/^\/(?:orbit\.sqlite(?:-(?:wal|shm))?|server\.js|commerce\.js)(?:\/|$)/i.test(req.path)) return res.sendStatus(404);
  next();
});
app.use(express.static(__dirname));

db.exec('PRAGMA foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('customer', 'store', 'courier', 'admin')),
    status TEXT NOT NULL DEFAULT 'pending',
    balance REAL NOT NULL DEFAULT 0,
    facebook TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    review_listings INTEGER NOT NULL DEFAULT 1,
    reviewed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('product', 'service')),
    category TEXT NOT NULL,
    price REAL NOT NULL,
    notes TEXT NOT NULL,
    media_data TEXT NOT NULL DEFAULT '',
    media_type TEXT NOT NULL DEFAULT '',
    facebook_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    public_id TEXT
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    user_id TEXT REFERENCES users(id),
    sender_id TEXT REFERENCES users(id),
    recipient_id TEXT REFERENCES users(id),
    amount REAL NOT NULL DEFAULT 0,
    details TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    public_id TEXT
  );
  CREATE TABLE IF NOT EXISTS delivery_requests (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES listings(id),
    buyer_id TEXT NOT NULL REFERENCES users(id),
    seller_id TEXT NOT NULL REFERENCES users(id),
    courier_id TEXT REFERENCES users(id),
    buyer_location TEXT NOT NULL,
    seller_location TEXT NOT NULL,
    delivery_fee REAL NOT NULL,
    courier_fee REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL,
    public_id TEXT
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    listing_id TEXT REFERENCES listings(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    rating INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT 'comment',
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    public_id TEXT
  );
  CREATE TABLE IF NOT EXISTS public_ids (
    public_id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    UNIQUE(entity_type, entity_id)
  );
`);

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const publicIdPrefix = (role) => ({ customer: 'USR', store: 'STR', courier: 'CRY', admin: 'ADM' })[role] || 'USR';
const createPublicId = (prefix) => {
  let publicId;
  do { publicId = `${prefix}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`; }
  while (db.prepare('SELECT 1 FROM public_ids WHERE public_id=?').get(publicId));
  return publicId;
};
const registerPublicId = (publicId, entityType, entityId) => {
  db.prepare('INSERT INTO public_ids(public_id,entity_type,entity_id) VALUES(?,?,?)').run(publicId, entityType, entityId);
};
const existingUserColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
if (!existingUserColumns.includes('public_id')) db.exec('ALTER TABLE users ADD COLUMN public_id TEXT');
if (!existingUserColumns.includes('review_listings')) db.exec('ALTER TABLE users ADD COLUMN review_listings INTEGER NOT NULL DEFAULT 1');
if (!existingUserColumns.includes('reviewed_at')) {
  db.exec('ALTER TABLE users ADD COLUMN reviewed_at TEXT');
  db.exec('UPDATE users SET reviewed_at=created_at');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_public_id ON users(public_id) WHERE public_id IS NOT NULL');
db.prepare('SELECT id,role,public_id FROM users').all().forEach((account) => {
  if (account.public_id) {
    if (!db.prepare('SELECT 1 FROM public_ids WHERE public_id=?').get(account.public_id)) registerPublicId(account.public_id, 'user', account.id);
    return;
  }
  const publicId = createPublicId(publicIdPrefix(account.role));
  db.prepare('UPDATE users SET public_id=? WHERE id=?').run(publicId, account.id);
  registerPublicId(publicId, 'user', account.id);
});

function ensurePublicIds(table, entityType, prefix) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
  if (!columns.includes('public_id')) db.exec(`ALTER TABLE ${table} ADD COLUMN public_id TEXT`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_public_id ON ${table}(public_id) WHERE public_id IS NOT NULL`);
  db.prepare(`SELECT id,public_id FROM ${table}`).all().forEach((entity) => {
    if (entity.public_id) {
      if (!db.prepare('SELECT 1 FROM public_ids WHERE public_id=?').get(entity.public_id)) registerPublicId(entity.public_id, entityType, entity.id);
      return;
    }
    const publicId = createPublicId(prefix);
    db.prepare(`UPDATE ${table} SET public_id=? WHERE id=?`).run(publicId, entity.id);
    registerPublicId(publicId, entityType, entity.id);
  });
}

ensurePublicIds('listings', 'listing', 'LST');
ensurePublicIds('transactions', 'transaction', 'TXN');
ensurePublicIds('delivery_requests', 'delivery', 'DLV');
ensurePublicIds('reviews', 'review', 'REV');

function runTransaction(callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function recordMarketTransaction({ type, userId, senderId = null, recipientId = null, amount = 0, details = {} }) {
  const transactionId = id();
  const publicId = createPublicId('TXN');
  db.prepare('INSERT INTO transactions (id,type,user_id,sender_id,recipient_id,amount,details,created_at,public_id) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(transactionId, type, userId, senderId, recipientId, amount, JSON.stringify(details), now(), publicId);
  registerPublicId(publicId, 'transaction', transactionId);
  return { id: transactionId, publicId };
}
const primaryAdminPhone = process.env.ORBIT_ADMIN_PHONE || '01037572742';
const primaryAdminPassword = process.env.ORBIT_ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'Aa$992009');
const primaryAdmin = db.prepare('SELECT id FROM users WHERE phone = ?').get(primaryAdminPhone);
if (!primaryAdmin) {
  if (!primaryAdminPassword) throw new Error('ORBIT_ADMIN_PASSWORD مطلوب لإنشاء حساب المشرف');
  const publicId = createPublicId(publicIdPrefix('admin'));
  db.prepare("INSERT INTO users (id,name,phone,password_hash,role,status,balance,created_at,public_id,review_listings,reviewed_at) VALUES (?,?,?,?,?,'active',0,?,?,1,?)").run(
    'admin-primary',
    'مشرف ASTRA',
    primaryAdminPhone,
    bcrypt.hashSync(primaryAdminPassword, 12),
    'admin',
    now(),
    publicId,
    now(),
  );
  registerPublicId(publicId, 'user', 'admin-primary');
} else {
  if (process.env.ORBIT_ADMIN_PASSWORD) {
    db.prepare("UPDATE users SET name = ?, password_hash = ?, role = 'admin', status = 'active', admin_scope = 'super_admin' WHERE phone = ?").run(
      'مشرف ASTRA', bcrypt.hashSync(primaryAdminPassword, 12), primaryAdminPhone,
    );
  } else {
    db.prepare('UPDATE users SET reviewed_at=COALESCE(reviewed_at,created_at) WHERE id=?').run(primaryAdmin.id);
  }
}

const publicUser = (user) => user && {
  id: user.id,
  publicId: user.public_id || user.publicId || null,
  marketId: user.public_id || user.publicId || null,
  name: user.name,
  phone: user.phone,
  role: user.role,
  status: user.status,
  balance: user.balance,
  facebook: user.facebook,
  location: user.location,
  adminScope: user.admin_scope || null,
  reviewListings: Boolean(user.review_listings ?? user.reviewListings ?? true),
  reviewedAt: user.reviewed_at || user.reviewedAt || null,
};
const signToken = (user) => jwt.sign({ sub: user.id, role: user.role }, jwtSecret, { expiresIn: '7d' });

function auth(required = true) {
  return (req, res, next) => {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return required ? res.status(401).json({ error: 'تسجيل الدخول مطلوب' }) : next();
    try {
      req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(jwt.verify(token, jwtSecret).sub);
      if (!req.user) return res.status(401).json({ error: 'الحساب غير موجود' });
      if (req.user.status === 'pending') return res.status(403).json({ error: 'حسابك قيد المراجعة. لا يمكنك النشر أو الشراء قبل التفعيل.' });
      if (req.user.status !== 'active') return res.status(403).json({ error: 'الحساب غير نشط' });
      next();
    } catch {
      res.status(401).json({ error: 'جلسة الدخول غير صالحة' });
    }
  };
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin' || req.user.status !== 'active') return res.status(403).json({ error: 'صلاحية المشرف مطلوبة' });
  const access = {
    'GET /api/admin/listings': 'products.read',
    'PATCH /api/admin/listings/:listingId/status': 'products.write',
    'GET /api/admin/transactions': 'payments.read',
    'GET /api/admin/reports/:userId': 'payments.read',
  };
  const permission = access[`${req.method} ${req.route?.path}`];
  if (!permission && req.user.admin_scope !== 'super_admin') return res.status(403).json({ error: 'هذه العملية متاحة للمشرف الرئيسي فقط' });
  if (permission && req.user.admin_scope !== 'super_admin' && !db.prepare('SELECT 1 FROM role_permissions WHERE role=? AND permission=?').get(req.user.admin_scope, permission)) return res.status(403).json({ error: 'ليس لديك صلاحية لتنفيذ الإجراء' });
  next();
}

function rateLimit(maximum, durationMs) {
  const windows = new Map();
  return (req, res, next) => {
    const key = req.ip;
    const current = Date.now();
    const window = windows.get(key);
    if (!window || current - window.startedAt >= durationMs) {
      windows.set(key, { startedAt: current, count: 1 });
      return next();
    }
    if (window.count >= maximum) return res.status(429).json({ error: 'محاولات كثيرة، حاول مرة أخرى لاحقًا' });
    window.count += 1;
    next();
  };
}

installCommerce(app, db, {
  auth,
  createPublicId,
  registerPublicId,
  storageDirectory: process.env.ORBIT_PRIVATE_UPLOADS || path.join(__dirname, 'private-uploads'),
  productImagesDirectory: process.env.ORBIT_PRODUCT_IMAGES || path.join(__dirname, 'product-images'),
});

function marketSetting(key, fallback) {
  return db.prepare('SELECT setting_value FROM shop_settings WHERE setting_key=?').get(key)?.setting_value || fallback;
}

function saveMarketSetting(key, value) {
  db.prepare('INSERT INTO shop_settings(setting_key,setting_value,updated_at) VALUES(?,?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at')
    .run(key, String(value), now());
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'astra-market' }));
app.get('/api/market-settings', (_req, res) => res.json({
  listingsReview: marketSetting('listings_review', 'manual'),
  deliveryFeePercent: Number(marketSetting('delivery_fee_percent', '5')),
  marketStatus: marketSetting('market_status', 'open'),
}));
app.get('/api/admin/market-settings', auth(), adminOnly, (_req, res) => res.json({
  listingsReview: marketSetting('listings_review', 'manual'),
  deliveryFeePercent: Number(marketSetting('delivery_fee_percent', '5')),
  marketStatus: marketSetting('market_status', 'open'),
}));
app.patch('/api/admin/market-settings', auth(), adminOnly, (req, res) => {
  const listingsReview = ['manual', 'auto'].includes(req.body.listingsReview) ? req.body.listingsReview : null;
  const deliveryFeePercent = Number(req.body.deliveryFeePercent);
  const marketStatus = ['open', 'paused'].includes(req.body.marketStatus) ? req.body.marketStatus : null;
  if (!listingsReview || !Number.isFinite(deliveryFeePercent) || deliveryFeePercent < 0 || deliveryFeePercent > 100 || !marketStatus) return res.status(400).json({ error: 'إعدادات السوق غير صالحة' });
  saveMarketSetting('listings_review', listingsReview);
  saveMarketSetting('delivery_fee_percent', deliveryFeePercent);
  saveMarketSetting('market_status', marketStatus);
  res.json({ ok: true, listingsReview, deliveryFeePercent, marketStatus });
});

app.post('/api/auth/signup', rateLimit(10, 15 * 60 * 1000), (req, res) => {
  const { name, phone, password, role = 'customer', facebook = '', location = '' } = req.body;
  if (!name || !phone || !/^\+?[0-9]{8,16}$/.test(String(phone)) || !password || String(password).length < 10 || !['customer', 'store', 'courier'].includes(role)) return res.status(400).json({ error: 'أكمل البيانات، وكلمة المرور ١٠ أحرف على الأقل' });
  if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) return res.status(409).json({ error: 'رقم الموبايل مسجل بالفعل' });
  const user = { id: id(), name: String(name).trim(), phone: String(phone).trim(), passwordHash: bcrypt.hashSync(password, 12), role, facebook, location, createdAt: now() };
  const status = 'pending';
  const reviewListings = marketSetting('listings_review', 'manual') !== 'auto';
  const publicId = createPublicId(publicIdPrefix(role));
  db.prepare('INSERT INTO users (id,name,phone,password_hash,role,status,facebook,location,created_at,public_id,review_listings) VALUES (@id,@name,@phone,@passwordHash,@role,@status,@facebook,@location,@createdAt,@publicId,@reviewListings)').run({ ...user, status, publicId, reviewListings: reviewListings ? 1 : 0 });
  registerPublicId(publicId, 'user', user.id);
  const savedUser = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  res.status(201).json({ user: publicUser(savedUser), message: 'تم إنشاء الحساب. أرسل طلب التفعيل للمشرف عبر واتساب، ولن تتمكن من النشر أو الشراء قبل اعتماد الحساب.' });
});

app.post('/api/auth/login', rateLimit(8, 15 * 60 * 1000), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(req.body.phone);
  if (!user || !bcrypt.compareSync(req.body.password || '', user.password_hash)) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
  if (user.status !== 'active') return res.status(403).json({ error: 'الحساب قيد المراجعة' });
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.get('/api/auth/me', auth(), (req, res) => res.json({ user: publicUser(req.user) }));
app.get('/api/users', (_req, res) => res.json(db.prepare("SELECT id,public_id,name,role,location,facebook,status FROM users WHERE status='active' AND role!='admin' ORDER BY created_at DESC").all()));

app.get('/api/listings', auth(false), (req, res) => {
  if (marketSetting('market_status', 'open') !== 'open') return res.json([]);
  res.json(db.prepare(`SELECT l.*, u.name AS owner_name, u.location AS owner_location, u.phone AS owner_phone FROM listings l JOIN users u ON u.id = l.owner_id WHERE u.status='active' AND l.status!='archived' AND (l.status='published' OR l.owner_id=?) ORDER BY l.created_at DESC`).all(req.user?.id || ''));
});

app.post('/api/listings', auth(), (req, res) => {
  if (marketSetting('market_status', 'open') !== 'open') return res.status(403).json({ error: 'السوق متوقف مؤقتًا عن استقبال الإعلانات' });
  if (!['customer', 'store'].includes(req.user.role)) return res.status(403).json({ error: 'هذا الحساب لا ينشر إعلانات' });
  const title = String(req.body.title || '').trim();
  const type = ['product', 'service'].includes(req.body.type) ? req.body.type : '';
  const category = String(req.body.category || '').trim();
  const price = Number(req.body.price);
  if (!title || !type || !category || !Number.isFinite(price) || price < 1) return res.status(400).json({ error: 'بيانات الإعلان غير مكتملة' });
  const listing = { id: id(), publicId: createPublicId('LST'), ownerId: req.user.id, title, type, category, price, notes: String(req.body.notes || ''), mediaData: String(req.body.mediaData || ''), mediaType: String(req.body.mediaType || ''), facebookUrl: String(req.body.facebookUrl || ''), createdAt: now() };
  const status = req.user.review_listings ? 'pending' : 'published';
  runTransaction(() => {
    db.prepare(`INSERT INTO listings (id,owner_id,title,type,category,price,notes,media_data,media_type,facebook_url,status,created_at,public_id) VALUES (@id,@ownerId,@title,@type,@category,@price,@notes,@mediaData,@mediaType,@facebookUrl,@status,@createdAt,@publicId)`)
      .run({ ...listing, status });
    registerPublicId(listing.publicId, 'listing', listing.id);
    recordMarketTransaction({ type: 'listing-created', userId: req.user.id, amount: price, details: { listingId: listing.id, listingPublicId: listing.publicId, title } });
  });
  res.status(201).json({ id: listing.id, publicId: listing.publicId, status });
});

app.delete('/api/listings/:listingId', auth(), (req, res) => {
  const listing = db.prepare('SELECT owner_id,status FROM listings WHERE id=?').get(req.params.listingId);
  if (!listing || listing.status === 'archived') return res.status(404).json({ error: 'المنشور غير موجود' });
  if (String(listing.owner_id) !== String(req.user.id)) return res.status(403).json({ error: 'يمكنك حذف منشوراتك فقط' });
  db.prepare("UPDATE listings SET status='archived' WHERE id=?").run(req.params.listingId);
  res.json({ ok: true, status: 'archived' });
});

app.post('/api/reviews', auth(), (req, res) => {
  const review = { id: id(), publicId: createPublicId('REV'), userId: req.user.id, listingId: req.body.listingId || null, rating: Number(req.body.rating || 0), kind: req.body.kind || 'comment', text: String(req.body.text || '').trim(), createdAt: now() };
  if (!review.text) return res.status(400).json({ error: 'اكتب التعليق أولًا' });
  db.prepare('INSERT INTO reviews (id,listing_id,user_id,rating,kind,text,created_at,public_id) VALUES (@id,@listingId,@userId,@rating,@kind,@text,@createdAt,@publicId)').run(review);
  registerPublicId(review.publicId, 'review', review.id);
  res.status(201).json(review);
});

app.get('/api/reviews', (_req, res) => res.json(db.prepare('SELECT r.*, u.name AS user_name FROM reviews r JOIN users u ON u.id = r.user_id ORDER BY r.created_at DESC').all()));

app.post('/api/transfers', auth(), (req, res) => {
  const amount = Number(req.body.amount);
  const recipient = db.prepare('SELECT * FROM users WHERE id = ?').get(req.body.recipientId);
  if (!recipient || amount < 1 || req.user.balance < amount) return res.status(400).json({ error: 'تعذر تنفيذ التحويل' });
  let senderBalance;
  let recipientBalance;
  let transaction;
  runTransaction(() => {
    db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(amount, req.user.id);
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, recipient.id);
    transaction = recordMarketTransaction({ type: 'transfer', userId: req.user.id, senderId: req.user.id, recipientId: recipient.id, amount, details: { recipientName: recipient.name } });
    senderBalance = db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id).balance;
    recipientBalance = db.prepare('SELECT balance FROM users WHERE id=?').get(recipient.id).balance;
  });
  res.json({ ok: true, senderBalance, recipientBalance, transactionId: transaction.id, publicId: transaction.publicId });
});

app.post('/api/purchases', auth(), (req, res) => {
    if (marketSetting('market_status', 'open') !== 'open') return res.status(403).json({ error: 'السوق متوقف مؤقتًا عن استقبال الطلبات' });
  const listing = db.prepare("SELECT * FROM listings WHERE id=? AND status='published'").get(req.body.listingId);
  if (!listing) return res.status(404).json({ error: 'الإعلان غير متاح حاليًا' });
  if (listing.owner_id === req.user.id) return res.status(400).json({ error: 'لا يمكنك شراء إعلانك الخاص' });
  const seller = db.prepare("SELECT * FROM users WHERE id=? AND status='active'").get(listing.owner_id);
  if (!seller) return res.status(404).json({ error: 'البائع غير متاح' });
  const paymentMethod = req.body.paymentMethod === 'cash' ? 'cash' : 'balance';
  const deliveryMethod = req.body.deliveryMethod === 'courier' ? 'courier' : 'self';
  const price = Number(listing.price);
  const fee = price * (req.user.role === 'store' ? 0.001 : 0.002);
  const deliveryRate = Math.min(100, Math.max(0, Number(marketSetting('delivery_fee_percent', '5')))) / 100;
  const deliveryFee = deliveryMethod === 'courier' ? price * deliveryRate : 0;
  const courier = deliveryMethod === 'courier' ? db.prepare("SELECT * FROM users WHERE id=? AND role='courier' AND status='active'").get(req.body.courierId) : null;
  if (deliveryMethod === 'courier' && (!courier || !String(req.body.buyerLocation || '').trim() || !seller.location)) return res.status(400).json({ error: 'اختر مندوبًا فعليًا وأكمل مواقع التوصيل' });
  const total = price + fee + deliveryFee;
  if (paymentMethod === 'balance' && Number(req.user.balance) < total) return res.status(400).json({ error: 'رصيدك لا يكفي لإتمام الشراء' });
  let balances;
  let transaction;
  let deliveryRequest = null;
  runTransaction(() => {
    if (paymentMethod === 'balance') {
      db.prepare('UPDATE users SET balance=balance-? WHERE id=?').run(total, req.user.id);
      db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(price, seller.id);
      if (courier) db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(deliveryFee * 0.8, courier.id);
    }
    transaction = recordMarketTransaction({
      type: 'purchase', userId: req.user.id, senderId: req.user.id, recipientId: seller.id, amount: price,
      details: { listingId: listing.id, listingPublicId: listing.public_id, title: listing.title, fee, deliveryFee, total, paymentMethod, deliveryMethod, courierId: courier?.id || null },
    });
    if (courier) {
      deliveryRequest = { id: id(), publicId: createPublicId('DLV'), buyerId: req.user.id, sellerId: seller.id, courierId: courier.id };
      db.prepare('INSERT INTO delivery_requests (id,listing_id,buyer_id,seller_id,courier_id,buyer_location,seller_location,delivery_fee,courier_fee,created_at,public_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(deliveryRequest.id, listing.id, req.user.id, seller.id, courier.id, String(req.body.buyerLocation).trim(), seller.location, deliveryFee, deliveryFee * 0.8, now(), deliveryRequest.publicId);
      registerPublicId(deliveryRequest.publicId, 'delivery', deliveryRequest.id);
    }
    balances = {
      buyer: db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id).balance,
      seller: db.prepare('SELECT balance FROM users WHERE id=?').get(seller.id).balance,
      courier: courier ? db.prepare('SELECT balance FROM users WHERE id=?').get(courier.id).balance : null,
    };
  });
  res.status(201).json({ ok: true, transactionId: transaction.id, publicId: transaction.publicId, balances, delivery: deliveryRequest });
});

app.post('/api/recharges', auth(), (req, res) => {
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount < 10) return res.status(400).json({ error: 'قيمة الشحن غير صالحة' });
  const request = recordMarketTransaction({
    type: 'recharge', userId: req.user.id, amount,
    details: { status: 'pending', proofType: req.body.proofType === 'receipt' ? 'receipt' : 'number', transferNumber: String(req.body.transferNumber || '').slice(0, 30), receiptName: String(req.body.receiptName || '').slice(0, 160) },
  });
  res.status(201).json({ ok: true, id: request.id, publicId: request.publicId });
});

app.post('/api/delivery-requests', auth(), (req, res) => {
  const request = { ...req.body, id: id(), publicId: createPublicId('DLV'), buyerId: req.user.id, createdAt: now() };
  if (!request.listingId || !request.courierId || !request.buyerLocation || !request.sellerLocation) return res.status(400).json({ error: 'بيانات التوصيل غير مكتملة' });
  db.prepare(`INSERT INTO delivery_requests (id,listing_id,buyer_id,seller_id,courier_id,buyer_location,seller_location,delivery_fee,courier_fee,created_at,public_id) VALUES (@id,@listingId,@buyerId,@sellerId,@courierId,@buyerLocation,@sellerLocation,@deliveryFee,@courierFee,@createdAt,@publicId)`).run({ ...request, deliveryFee: Number(request.deliveryFee || 0), courierFee: Number(request.courierFee || 0), publicId: request.publicId });
  registerPublicId(request.publicId, 'delivery', request.id);
  res.status(201).json(request);
});

app.get('/api/courier/requests', auth(), (req, res) => {
  if (req.user.role !== 'courier') return res.status(403).json({ error: 'حساب المندوب فقط' });
  res.json(db.prepare('SELECT d.*,l.title AS listing_title FROM delivery_requests d JOIN listings l ON l.id=d.listing_id WHERE d.courier_id = ? ORDER BY d.created_at DESC').all(req.user.id));
});
app.patch('/api/courier/requests/:requestId/status', auth(), (req, res) => {
  if (req.user.role !== 'courier') return res.status(403).json({ error: 'حساب المندوب فقط' });
  const status = ['accepted', 'delivered'].includes(req.body.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: 'حالة التوصيل غير صالحة' });
  const result = db.prepare('UPDATE delivery_requests SET status=? WHERE id=? AND courier_id=?').run(status, req.params.requestId, req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'طلب التوصيل غير موجود' });
  res.json({ ok: true });
});

app.get('/api/admin/users', auth(), adminOnly, (_req, res) => res.json(db.prepare('SELECT id,public_id,name,phone,role,status,balance,facebook,location,created_at,review_listings,reviewed_at FROM users ORDER BY created_at DESC').all()));
app.get('/api/admin/users', auth(), adminOnly, (_req, res) => res.json(db.prepare('SELECT id,public_id,name,phone,role,status,admin_scope,balance,facebook,location,created_at,review_listings,reviewed_at FROM users ORDER BY created_at DESC').all()));
app.post('/api/admin/admins', auth(), adminOnly, (req, res) => {
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '');
  const scope = ['product_manager', 'order_manager', 'payment_manager', 'customer_manager', 'content_manager'].includes(req.body.scope) ? req.body.scope : 'product_manager';
  if (req.user.admin_scope !== 'super_admin') return res.status(403).json({ error: 'إنشاء المشرفين متاح للمشرف الرئيسي فقط' });
  if (!name || !/^\+?[0-9]{8,16}$/.test(phone) || password.length < 10) return res.status(400).json({ error: 'أكمل البيانات، ويجب ألا تقل كلمة المرور عن ١٠ أحرف' });
  if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) return res.status(409).json({ error: 'رقم الموبايل مسجل بالفعل' });
  const user = { id: id(), publicId: createPublicId(publicIdPrefix('admin')), name, phone, passwordHash: bcrypt.hashSync(password, 12), createdAt: now() };
  db.prepare("INSERT INTO users (id,name,phone,password_hash,role,status,admin_scope,created_at,public_id) VALUES (@id,@name,@phone,@passwordHash,'admin','pending',@scope,@createdAt,@publicId)").run({ ...user, scope });
  registerPublicId(user.publicId, 'user', user.id);
  res.status(201).json({ user: publicUser({ ...user, role: 'admin', status: 'pending', admin_scope: scope, balance: 0 }) });
});
app.patch('/api/admin/users/:userId/status', auth(), adminOnly, (req, res) => {
  const status = ['active', 'pending', 'suspended'].includes(req.body.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: 'حالة الحساب غير صالحة' });
  const result = db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, req.params.userId);
  if (!result.changes) return res.status(404).json({ error: 'المستخدم غير موجود' });
  res.json({ ok: true });
});
app.patch('/api/admin/users/:userId/review', auth(), adminOnly, (req, res) => {
  const action = req.body.action;
  if (!['approve', 'cancel'].includes(action)) return res.status(400).json({ error: 'قرار الحساب غير صالح' });
  const status = action === 'cancel' ? 'suspended' : 'active';
  const result = db.prepare('UPDATE users SET status=?,reviewed_at=? WHERE id=?').run(status, now(), req.params.userId);
  if (!result.changes) return res.status(404).json({ error: 'المستخدم غير موجود' });
  res.json({ ok: true, status });
});
app.patch('/api/admin/users/:userId/listing-review', auth(), adminOnly, (req, res) => {
  if (typeof req.body.required !== 'boolean') return res.status(400).json({ error: 'اختيار مراجعة الإعلانات غير صالح' });
  const result = db.prepare('UPDATE users SET review_listings=? WHERE id=?').run(req.body.required ? 1 : 0, req.params.userId);
  if (!result.changes) return res.status(404).json({ error: 'المستخدم غير موجود' });
  res.json({ ok: true, required: req.body.required });
});
app.get('/api/admin/listings', auth(), adminOnly, (_req, res) => res.json(db.prepare(`SELECT l.*, u.name AS owner_name FROM listings l JOIN users u ON u.id = l.owner_id ORDER BY l.created_at DESC`).all()));
app.patch('/api/admin/listings/:listingId/status', auth(), adminOnly, (req, res) => {
  const status = ['published', 'pending', 'rejected', 'archived'].includes(req.body.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: 'حالة الإعلان غير صالحة' });
  const result = db.prepare('UPDATE listings SET status = ? WHERE id = ?').run(status, req.params.listingId);
  if (!result.changes) return res.status(404).json({ error: 'الإعلان غير موجود' });
  res.json({ ok: true });
});
app.get('/api/admin/delivery-requests', auth(), adminOnly, (_req, res) => res.json(db.prepare(`SELECT d.*, l.title AS listing_title, b.name AS buyer_name, s.name AS seller_name, c.name AS courier_name FROM delivery_requests d JOIN listings l ON l.id = d.listing_id JOIN users b ON b.id = d.buyer_id JOIN users s ON s.id = d.seller_id LEFT JOIN users c ON c.id = d.courier_id ORDER BY d.created_at DESC`).all()));
app.get('/api/admin/transactions', auth(), adminOnly, (_req, res) => res.json(db.prepare(`SELECT t.*, s.name AS sender_name, r.name AS recipient_name FROM transactions t LEFT JOIN users s ON s.id = t.sender_id LEFT JOIN users r ON r.id = t.recipient_id ORDER BY t.created_at DESC`).all()));
app.get('/api/admin/reports/:userId', auth(), adminOnly, (req, res) => {
  const userId = req.params.userId;
  const involved = 'WHERE (t.user_id=? OR t.sender_id=? OR t.recipient_id=?)';
  const params = [userId, userId, userId];
  const transactions = db.prepare(`SELECT t.*, s.name AS sender_name, r.name AS recipient_name FROM transactions t LEFT JOIN users s ON s.id=t.sender_id LEFT JOIN users r ON r.id=t.recipient_id ${involved} AND t.type NOT IN ('listing-created','purchase','recharge') ORDER BY t.created_at DESC`).all(...params);
  const purchases = db.prepare(`SELECT t.*, s.name AS sender_name, r.name AS recipient_name FROM transactions t LEFT JOIN users s ON s.id=t.sender_id LEFT JOIN users r ON r.id=t.recipient_id ${involved} AND t.type='purchase' ORDER BY t.created_at DESC`).all(...params);
  const storeOrders = db.prepare('SELECT id,order_number AS public_id,total AS amount,order_status AS status,payment_status,created_at FROM orders WHERE customer_id=? ORDER BY created_at DESC').all(userId)
    .map((order) => ({ ...order, type: 'store-order', description: `طلب متجر ${order.public_id}` }));
  const topups = db.prepare(`SELECT t.*,s.name AS sender_name,r.name AS recipient_name FROM transactions t LEFT JOIN users s ON s.id=t.sender_id LEFT JOIN users r ON r.id=t.recipient_id WHERE t.user_id=? AND t.type='recharge' ORDER BY t.created_at DESC`).all(userId)
    .map((item) => ({ ...item, description: 'طلب شحن رصيد' }));
  const shipments = db.prepare(`SELECT d.*,l.title AS listing_title FROM delivery_requests d JOIN listings l ON l.id=d.listing_id WHERE d.buyer_id=? OR d.seller_id=? OR d.courier_id=? ORDER BY d.created_at DESC`).all(userId, userId, userId)
    .map((item) => ({ ...item, description: `توصيل ${item.listing_title}` }));
  res.json({
    transactions,
    publishing: db.prepare('SELECT l.id,l.public_id,l.title,l.type,l.category,l.price,l.status,l.created_at FROM listings l WHERE l.owner_id=? ORDER BY l.created_at DESC').all(userId),
    purchases: [...purchases, ...storeOrders].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    recharges: [...topups, ...shipments].sort((a, b) => b.created_at.localeCompare(a.created_at)),
  });
});

app.delete('/api/admin/users/:userId', auth(), adminOnly, (req, res) => {
  if (req.user.id === req.params.userId) return res.status(400).json({ error: 'لا يمكن حذف حساب المشرف الحالي' });
  const deleted = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId);
  if (!deleted) return res.status(404).json({ error: 'المستخدم غير موجود' });
  runTransaction(() => {
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(deleted.balance, req.user.id);
    db.prepare('INSERT INTO transactions (id,type,user_id,recipient_id,amount,details,created_at) VALUES (?,?,?,?,?,?,?)').run(id(), 'user-deleted', deleted.id, req.user.id, deleted.balance, JSON.stringify({ deletedUser: deleted.name }), now());
    db.prepare('DELETE FROM users WHERE id = ?').run(deleted.id);
  });
  res.json({ ok: true, transferredBalance: deleted.balance });
});

app.get('/store', (_req, res) => res.redirect(302, '/orbit-1.html#market-listings'));
app.get('/courier', (_req, res) => res.sendFile(path.join(__dirname, 'courier.html')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'orbit-1.html')));
app.listen(port, () => console.log(`ASTRA server running at http://localhost:${port}`));
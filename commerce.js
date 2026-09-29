import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const timestamp = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
const money = (value) => Math.round(Number(value || 0) * 100) / 100;
const cleanText = (value, max = 500) => String(value || '').trim().slice(0, max);
function createTransaction(database) {
  return (callback) => {
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      database.exec('COMMIT');
      return result;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  };
}
const roles = {
  super_admin: ['*'],
  product_manager: ['products.read', 'products.write', 'categories.write', 'inventory.read'],
  order_manager: ['orders.read', 'orders.write', 'shipping.write', 'agents.write'],
  payment_manager: ['payments.read', 'payments.write', 'proofs.read', 'proofs.write'],
  customer_manager: ['customers.read', 'customers.write'],
  content_manager: ['content.write', 'categories.write'],
};

export function installCommerce(app, db, { auth, createPublicId, registerPublicId, storageDirectory, productImagesDirectory }) {
  const transaction = createTransaction(db);
  fs.mkdirSync(storageDirectory, { recursive: true });
  fs.mkdirSync(productImagesDirectory, { recursive: true });
  const userColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
  if (!userColumns.includes('admin_scope')) db.exec("ALTER TABLE users ADD COLUMN admin_scope TEXT NOT NULL DEFAULT 'super_admin'");

  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '', sku TEXT NOT NULL UNIQUE,
      category_id TEXT REFERENCES categories(id), price REAL NOT NULL CHECK(price >= 0),
      sale_price REAL, cost_price REAL, stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
      low_stock_threshold INTEGER NOT NULL DEFAULT 5, status TEXT NOT NULL DEFAULT 'draft',
      featured INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS product_images (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      image_url TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS addresses (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_name TEXT NOT NULL, phone TEXT NOT NULL, city TEXT NOT NULL,
      area TEXT NOT NULL DEFAULT '', line1 TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cart_items (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL CHECK(quantity > 0), updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, product_id)
    );
    CREATE TABLE IF NOT EXISTS coupons (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
      value REAL NOT NULL, starts_at TEXT, ends_at TEXT, usage_limit INTEGER,
      usage_count INTEGER NOT NULL DEFAULT 0, min_order REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shop_settings (
      setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shipping_methods (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0,
      regions_json TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, order_number TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL REFERENCES users(id), address_id TEXT REFERENCES addresses(id),
      subtotal REAL NOT NULL, discount REAL NOT NULL DEFAULT 0, shipping REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL, coupon_id TEXT REFERENCES coupons(id),
      payment_method TEXT NOT NULL, payment_status TEXT NOT NULL DEFAULT 'pending',
      order_status TEXT NOT NULL DEFAULT 'new', shipping_status TEXT NOT NULL DEFAULT 'not_shipped',
      delivery_agent_id TEXT REFERENCES users(id), shipping_method_id TEXT REFERENCES shipping_methods(id),
      delivery_otp_hash TEXT, delivery_reason TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT REFERENCES products(id), name TEXT NOT NULL, sku TEXT NOT NULL,
      quantity INTEGER NOT NULL, unit_price REAL NOT NULL, line_total REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
      order_id TEXT REFERENCES orders(id), actor_id TEXT REFERENCES users(id),
      quantity_delta INTEGER NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      amount REAL NOT NULL, method TEXT NOT NULL, status TEXT NOT NULL,
      transaction_id TEXT, provider_reference TEXT NOT NULL DEFAULT '',
      collected_amount REAL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payment_proofs (
      id TEXT PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES payments(id),
      order_id TEXT NOT NULL REFERENCES orders(id), user_id TEXT NOT NULL REFERENCES users(id),
      stored_name TEXT NOT NULL, mime_type TEXT NOT NULL, transaction_id TEXT NOT NULL,
      claimed_amount REAL NOT NULL, transferred_at TEXT NOT NULL DEFAULT '',
      ocr_result TEXT NOT NULL DEFAULT 'unavailable', confidence REAL,
      review_status TEXT NOT NULL DEFAULT 'pending', reviewer_id TEXT REFERENCES users(id),
      reviewed_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shipments (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
      provider TEXT NOT NULL DEFAULT '', tracking_number TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS product_reviews (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
      order_id TEXT NOT NULL REFERENCES orders(id), user_id TEXT NOT NULL REFERENCES users(id),
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
      UNIQUE(product_id, order_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL, message TEXT NOT NULL, read_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL,
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      old_value TEXT NOT NULL DEFAULT '{}', new_value TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_products_status_category ON products(status, category_id);
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
    CREATE INDEX IF NOT EXISTS idx_orders_customer_date ON orders(customer_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_status_date ON orders(order_status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_agent_status ON orders(delivery_agent_id, order_status);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_proofs_review_status ON payment_proofs(review_status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_date ON notifications(user_id, created_at DESC);
  `);

  const productColumns = db.prepare('PRAGMA table_info(products)').all().map((column) => column.name);
  if (!productColumns.includes('public_id')) db.exec('ALTER TABLE products ADD COLUMN public_id TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_products_public_id ON products(public_id) WHERE public_id IS NOT NULL');
  db.prepare('SELECT id,public_id FROM products').all().forEach((product) => {
    if (product.public_id) {
      if (!db.prepare('SELECT 1 FROM public_ids WHERE public_id=?').get(product.public_id)) registerPublicId(product.public_id, 'product', product.id);
      return;
    }
    const publicId = createPublicId('PRD');
    db.prepare('UPDATE products SET public_id=? WHERE id=?').run(publicId, product.id);
    registerPublicId(publicId, 'product', product.id);
  });

  const rolesTable = db.prepare('CREATE TABLE IF NOT EXISTS role_permissions (role TEXT NOT NULL, permission TEXT NOT NULL, PRIMARY KEY(role, permission))');
  rolesTable.run();
  const seedPermission = db.prepare('INSERT OR IGNORE INTO role_permissions (role, permission) VALUES (?, ?)');
  Object.entries(roles).forEach(([role, permissions]) => permissions.forEach((permission) => seedPermission.run(role, permission)));
  if (!db.prepare('SELECT id FROM shipping_methods LIMIT 1').get()) {
    db.prepare('INSERT INTO shipping_methods (id,name,price,regions_json,created_at) VALUES (?,?,?,?,?)')
      .run('orbit-standard', 'توصيل ASTRA القياسي', 40, JSON.stringify([]), timestamp());
  }

  const hasPermission = (user, permission) => {
    if (user?.role !== 'admin') return false;
    const scope = user.admin_scope || 'super_admin';
    return Boolean(db.prepare('SELECT 1 FROM role_permissions WHERE role=? AND permission=?').get(scope, permission)
      || db.prepare('SELECT 1 FROM role_permissions WHERE role=? AND permission=?').get(scope, '*'));
  };
  const can = (permission) => (req, res, next) => {
    if (!hasPermission(req.user, permission)) return res.status(403).json({ error: 'ليس لديك صلاحية لتنفيذ الإجراء' });
    next();
  };
  const customer = (req, res, next) => req.user?.role === 'customer' ? next() : res.status(403).json({ error: 'هذه الخدمة مخصصة لحساب العميل' });
  const courier = (req, res, next) => req.user?.role === 'courier' ? next() : res.status(403).json({ error: 'حساب المندوب مطلوب' });
  const writeAudit = (actor, action, type, entityId, before = {}, after = {}) => {
    db.prepare('INSERT INTO audit_logs (id,actor_id,action,entity_type,entity_id,old_value,new_value,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(newId(), actor?.id || null, action, type, String(entityId), JSON.stringify(before), JSON.stringify(after), timestamp());
  };
  const notify = (userId, title, message) => db.prepare('INSERT INTO notifications (id,user_id,title,message,created_at) VALUES (?,?,?,?,?)')
    .run(newId(), userId, title, message, timestamp());
  const productRecord = (row) => row && ({
    ...row,
    public_id: row.public_id,
    price: Number(row.price), sale_price: row.sale_price === null ? null : Number(row.sale_price),
    stock: Number(row.stock), featured: Boolean(row.featured),
    average_rating: Number(db.prepare("SELECT COALESCE(AVG(rating),0) AS value FROM product_reviews WHERE product_id=? AND status='approved'").get(row.id)?.value || 0),
    review_count: Number(db.prepare("SELECT COUNT(*) AS value FROM product_reviews WHERE product_id=? AND status='approved'").get(row.id)?.value || 0),
    images: db.prepare('SELECT image_url FROM product_images WHERE product_id = ? ORDER BY position').all(row.id).map((image) => image.image_url),
  });
  const orderRecord = (row) => row && ({
    ...row,
    items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(row.id),
    payment: db.prepare('SELECT id,amount,method,status,transaction_id,created_at FROM payments WHERE order_id = ? ORDER BY created_at DESC LIMIT 1').get(row.id),
  });
  const saveProofImage = (dataUrl) => {
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!match) throw new Error('صيغة الصورة غير مدعومة');
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > 4 * 1024 * 1024) throw new Error('حجم الصورة يجب ألا يتجاوز ٤ ميجابايت');
    const validSignature = match[1] === 'image/jpeg' ? buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
      : match[1] === 'image/png' ? buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
        : buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
    if (!validSignature) throw new Error('محتوى الصورة لا يطابق نوع الملف');
    const extension = match[1] === 'image/jpeg' ? '.jpg' : match[1] === 'image/png' ? '.png' : '.webp';
    const fileName = `${newId()}${extension}`;
    fs.writeFileSync(path.join(storageDirectory, fileName), buffer, { flag: 'wx', mode: 0o600 });
    return { fileName, mimeType: match[1] };
  };
  const saveProductImage = (dataUrl) => {
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!match) throw new Error('صيغة الصورة غير مدعومة');
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > 4 * 1024 * 1024) throw new Error('حجم الصورة يجب ألا يتجاوز ٤ ميجابايت');
    const validSignature = match[1] === 'image/jpeg' ? buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
      : match[1] === 'image/png' ? buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
        : buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
    if (!validSignature) throw new Error('محتوى الصورة لا يطابق نوع الملف');
    const extension = match[1] === 'image/jpeg' ? '.jpg' : match[1] === 'image/png' ? '.png' : '.webp';
    const fileName = `${newId()}${extension}`;
    fs.writeFileSync(path.join(productImagesDirectory, fileName), buffer, { flag: 'wx', mode: 0o644 });
    return `/product-images/${fileName}`;
  };

  app.get('/api/store/categories', (_req, res) => {
    res.json(db.prepare('SELECT id,name,slug,description,image_url FROM categories WHERE active = 1 ORDER BY position,name').all());
  });
  app.get('/api/store/products', (req, res) => {
    const filters = ["p.status = 'published'"];
    const params = [];
    if (req.query.category) { filters.push('(c.slug = ? OR c.id = ?)'); params.push(String(req.query.category), String(req.query.category)); }
    if (req.query.q) { filters.push('(p.name LIKE ? OR p.description LIKE ? OR p.sku LIKE ?)'); const query = `%${cleanText(req.query.q, 80)}%`; params.push(query, query, query); }
    if (req.query.featured === 'true') filters.push('p.featured = 1');
    const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 24));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const rows = db.prepare(`SELECT p.*,c.name AS category_name,c.slug AS category_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE ${filters.join(' AND ')} ORDER BY p.featured DESC,p.created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset).map(productRecord);
    res.json({ items: rows, limit, offset });
  });
  app.get('/api/store/products/:slug', (req, res) => {
    const row = db.prepare("SELECT p.*,c.name AS category_name,c.slug AS category_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.slug=? AND p.status='published'").get(req.params.slug);
    if (!row) return res.status(404).json({ error: 'المنتج غير موجود' });
    res.json(productRecord(row));
  });
  app.get('/api/store/shipping-methods', (_req, res) => res.json(db.prepare('SELECT id,name,price,regions_json FROM shipping_methods WHERE active=1 ORDER BY price').all().map((row) => ({ ...row, regions: JSON.parse(row.regions_json || '[]') }))));
  app.get('/api/store/payment-instructions', (_req, res) => res.json({
    beneficiary: db.prepare("SELECT setting_value FROM shop_settings WHERE setting_key='transfer_beneficiary'").get()?.setting_value || process.env.ORBIT_TRANSFER_BENEFICIARY || '',
    channel: db.prepare("SELECT setting_value FROM shop_settings WHERE setting_key='transfer_channel'").get()?.setting_value || process.env.ORBIT_TRANSFER_CHANNEL || '',
    account: db.prepare("SELECT setting_value FROM shop_settings WHERE setting_key='transfer_account'").get()?.setting_value || process.env.ORBIT_TRANSFER_ACCOUNT || '',
    configured: Boolean((db.prepare("SELECT setting_value FROM shop_settings WHERE setting_key='transfer_beneficiary'").get()?.setting_value || process.env.ORBIT_TRANSFER_BENEFICIARY) && (db.prepare("SELECT setting_value FROM shop_settings WHERE setting_key='transfer_channel'").get()?.setting_value || process.env.ORBIT_TRANSFER_CHANNEL) && (db.prepare("SELECT setting_value FROM shop_settings WHERE setting_key='transfer_account'").get()?.setting_value || process.env.ORBIT_TRANSFER_ACCOUNT)),
  }));

  app.get('/api/store/cart', auth(), customer, (req, res) => {
    const items = db.prepare(`SELECT c.quantity,p.id AS product_id,p.name,p.slug,p.sku,p.price,p.sale_price,p.stock,
      (SELECT image_url FROM product_images WHERE product_id=p.id ORDER BY position LIMIT 1) AS image_url
      FROM cart_items c JOIN products p ON p.id=c.product_id WHERE c.user_id=? AND p.status='published' ORDER BY c.updated_at DESC`).all(req.user.id);
    res.json({ items: items.map((item) => ({ ...item, unit_price: Number(item.sale_price || item.price), line_total: money(Number(item.sale_price || item.price) * item.quantity) })) });
  });
  app.put('/api/store/cart/items/:productId', auth(), customer, (req, res) => {
    const quantity = Number(req.body.quantity);
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99) return res.status(400).json({ error: 'الكمية غير صالحة' });
    const product = db.prepare("SELECT id,stock,status FROM products WHERE id=?").get(req.params.productId);
    if (!product || product.status !== 'published') return res.status(404).json({ error: 'المنتج غير متاح' });
    if (quantity > product.stock) return res.status(409).json({ error: 'الكمية المطلوبة أكبر من المخزون المتاح' });
    if (quantity === 0) db.prepare('DELETE FROM cart_items WHERE user_id=? AND product_id=?').run(req.user.id, product.id);
    else db.prepare('INSERT INTO cart_items(user_id,product_id,quantity,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,product_id) DO UPDATE SET quantity=excluded.quantity,updated_at=excluded.updated_at').run(req.user.id, product.id, quantity, timestamp());
    res.json({ ok: true });
  });
  app.post('/api/store/coupons/quote', auth(), customer, (req, res) => {
    const coupon = db.prepare('SELECT * FROM coupons WHERE code=? COLLATE NOCASE AND active=1').get(cleanText(req.body.code, 40));
    const cart = db.prepare("SELECT c.quantity,p.price,p.sale_price FROM cart_items c JOIN products p ON p.id=c.product_id WHERE c.user_id=? AND p.status='published'").all(req.user.id);
    const subtotal = money(cart.reduce((sum, item) => sum + Number(item.sale_price || item.price) * item.quantity, 0));
    const current = Date.now();
    if (!coupon || (coupon.starts_at && Date.parse(coupon.starts_at) > current) || (coupon.ends_at && Date.parse(coupon.ends_at) < current) || (coupon.usage_limit && coupon.usage_count >= coupon.usage_limit) || subtotal < coupon.min_order) return res.status(400).json({ error: 'الكوبون غير صالح أو لا ينطبق على السلة' });
    const discount = Math.min(subtotal, money(coupon.kind === 'percent' ? subtotal * coupon.value / 100 : coupon.value));
    res.json({ code: coupon.code, discount, subtotal });
  });

  app.get('/api/store/addresses', auth(), customer, (req, res) => {
    res.json(db.prepare('SELECT id,recipient_name,phone,city,area,line1,notes,is_default FROM addresses WHERE user_id=? ORDER BY is_default DESC,created_at DESC').all(req.user.id));
  });

  app.post('/api/store/orders', auth(), customer, (req, res) => {
    const paymentMethod = String(req.body.paymentMethod || '');
    if (!['cod', 'bank_transfer'].includes(paymentMethod)) return res.status(400).json({ error: 'طريقة الدفع غير متاحة حاليًا' });
    const savedAddress = req.body.addressId ? db.prepare('SELECT * FROM addresses WHERE id=? AND user_id=?').get(req.body.addressId, req.user.id) : null;
    if (req.body.addressId && !savedAddress) return res.status(404).json({ error: 'العنوان المحفوظ غير موجود' });
    const address = savedAddress || req.body.address || {};
    const requiredAddress = ['recipient_name', 'phone', 'city', 'line1'];
    if (requiredAddress.some((key) => !cleanText(address[key], 150))) return res.status(400).json({ error: 'أكمل بيانات عنوان التوصيل' });
    const requestedItems = Array.isArray(req.body.items) ? req.body.items : [];
    const cartItems = requestedItems.length ? requestedItems : db.prepare('SELECT product_id,quantity FROM cart_items WHERE user_id=?').all(req.user.id);
    const quantities = new Map();
    for (const item of cartItems) {
      const productId = cleanText(item.productId || item.product_id, 80);
      const quantity = Number(item.quantity);
      if (!productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) return res.status(400).json({ error: 'يوجد منتج أو كمية غير صالحة' });
      quantities.set(productId, (quantities.get(productId) || 0) + quantity);
    }
    if (!quantities.size) return res.status(400).json({ error: 'سلة التسوق فارغة' });
    const products = [];
    for (const [productId, quantity] of quantities) {
      const product = db.prepare("SELECT * FROM products WHERE id=? AND status='published'").get(productId);
      if (!product || product.stock < quantity) return res.status(409).json({ error: `المخزون غير كافٍ للمنتج ${product?.name || ''}` });
      products.push({ ...product, quantity, unitPrice: Number(product.sale_price || product.price) });
    }
    const method = db.prepare('SELECT * FROM shipping_methods WHERE id=? AND active=1').get(req.body.shippingMethodId || 'orbit-standard');
    if (!method) return res.status(400).json({ error: 'طريقة الشحن غير متاحة' });
    const supportedRegions = JSON.parse(method.regions_json || '[]');
    if (supportedRegions.length && !supportedRegions.includes(cleanText(address.city, 100)) && !supportedRegions.includes(cleanText(address.area, 100))) return res.status(400).json({ error: 'طريقة الشحن غير متاحة في المنطقة المحددة' });
    const subtotal = money(products.reduce((sum, product) => sum + product.unitPrice * product.quantity, 0));
    let coupon = null;
    let discount = 0;
    if (req.body.coupon) {
      coupon = db.prepare('SELECT * FROM coupons WHERE code=? COLLATE NOCASE AND active=1').get(cleanText(req.body.coupon, 40));
      const current = Date.now();
      if (!coupon || (coupon.starts_at && Date.parse(coupon.starts_at) > current) || (coupon.ends_at && Date.parse(coupon.ends_at) < current) || (coupon.usage_limit && coupon.usage_count >= coupon.usage_limit) || subtotal < coupon.min_order) return res.status(400).json({ error: 'الكوبون غير صالح أو لا ينطبق على الطلب' });
      discount = money(coupon.kind === 'percent' ? subtotal * coupon.value / 100 : coupon.value);
      discount = Math.min(discount, subtotal);
    }
    const shipping = money(Number(method.price));
    const total = money(subtotal - discount + shipping);
    const id = newId();
    const orderNumber = `ORB-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const createdAt = timestamp();
    const orderStatus = paymentMethod === 'cod' ? 'new' : 'payment_pending';
    const paymentStatus = paymentMethod === 'cod' ? 'unpaid' : 'pending';
    try {
      transaction(() => {
        const orderAddressId = savedAddress?.id || newId();
        if (!savedAddress) db.prepare('INSERT INTO addresses(id,user_id,recipient_name,phone,city,area,line1,notes,is_default,created_at) VALUES(?,?,?,?,?,?,?,?,0,?)')
          .run(orderAddressId, req.user.id, cleanText(address.recipient_name, 100), cleanText(address.phone, 30), cleanText(address.city, 100), cleanText(address.area, 100), cleanText(address.line1, 250), cleanText(address.notes, 500), createdAt);
        db.prepare(`INSERT INTO orders(id,order_number,customer_id,address_id,subtotal,discount,shipping,total,coupon_id,payment_method,payment_status,order_status,shipping_status,shipping_method_id,notes,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, orderNumber, req.user.id, orderAddressId, subtotal, discount, shipping, total, coupon?.id || null, paymentMethod, paymentStatus, orderStatus, 'not_shipped', method.id, cleanText(req.body.notes, 500), createdAt, createdAt);
        for (const product of products) {
          const update = db.prepare('UPDATE products SET stock=stock-?,updated_at=? WHERE id=? AND stock>=?').run(product.quantity, createdAt, product.id, product.quantity);
          if (!update.changes) throw new Error('المخزون تغير، حدّث السلة وحاول مرة أخرى');
          db.prepare('INSERT INTO inventory_transactions(id,product_id,order_id,actor_id,quantity_delta,reason,created_at) VALUES(?,?,?,?,?,?,?)').run(newId(), product.id, id, req.user.id, -product.quantity, 'order_reserved', createdAt);
          db.prepare('INSERT INTO order_items(id,order_id,product_id,name,sku,quantity,unit_price,line_total) VALUES(?,?,?,?,?,?,?,?)')
            .run(newId(), id, product.id, product.name, product.sku, product.quantity, product.unitPrice, money(product.unitPrice * product.quantity));
        }
        db.prepare('INSERT INTO payments(id,order_id,amount,method,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
          .run(newId(), id, total, paymentMethod, paymentStatus, createdAt, createdAt);
        if (coupon) db.prepare('UPDATE coupons SET usage_count=usage_count+1 WHERE id=?').run(coupon.id);
        db.prepare('DELETE FROM cart_items WHERE user_id=?').run(req.user.id);
        writeAudit(req.user, 'order.created', 'order', id, {}, { orderNumber, total, paymentMethod });
      });
    } catch (error) {
      return res.status(409).json({ error: error.message || 'تعذر إنشاء الطلب' });
    }
    notify(req.user.id, 'تم استلام طلبك', `رقم الطلب ${orderNumber}`);
    res.status(201).json(orderRecord(db.prepare('SELECT * FROM orders WHERE id=?').get(id)));
  });

  app.get('/api/store/orders', auth(), customer, (req, res) => {
    res.json(db.prepare('SELECT * FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 100').all(req.user.id).map(orderRecord));
  });
  app.get('/api/store/orders/:orderId', auth(), (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (order.customer_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'لا يمكنك عرض هذا الطلب' });
    if (order.customer_id !== req.user.id && !hasPermission(req.user, 'orders.read')) return res.status(403).json({ error: 'ليس لديك صلاحية لعرض الطلب' });
    const address = db.prepare('SELECT recipient_name,phone,city,area,line1,notes FROM addresses WHERE id=?').get(order.address_id);
    const history = db.prepare("SELECT action,old_value,new_value,created_at FROM audit_logs WHERE entity_type='order' AND entity_id=? ORDER BY created_at").all(order.id);
    res.json({ ...orderRecord(order), address, history });
  });
  app.post('/api/store/orders/:orderId/cancel', auth(), customer, (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id=? AND customer_id=?').get(req.params.orderId, req.user.id);
    if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (!['new', 'payment_pending', 'payment_failed'].includes(order.order_status)) return res.status(409).json({ error: 'لا يمكن إلغاء الطلب بعد بدء تجهيزه' });
    transaction(() => {
      db.prepare('UPDATE products SET stock=stock+(SELECT quantity FROM order_items WHERE order_id=? AND product_id=products.id),updated_at=? WHERE id IN (SELECT product_id FROM order_items WHERE order_id=?)').run(order.id, timestamp(), order.id);
      db.prepare('SELECT product_id,quantity FROM order_items WHERE order_id=?').all(order.id).forEach((item) => db.prepare('INSERT INTO inventory_transactions(id,product_id,order_id,actor_id,quantity_delta,reason,created_at) VALUES(?,?,?,?,?,?,?)').run(newId(), item.product_id, order.id, req.user.id, item.quantity, 'customer_order_cancelled', timestamp()));
      db.prepare("UPDATE orders SET order_status='cancelled',payment_status=CASE WHEN payment_status='paid' THEN payment_status ELSE 'cancelled' END,updated_at=? WHERE id=?").run(timestamp(), order.id);
      db.prepare("UPDATE payments SET status='cancelled',updated_at=? WHERE order_id=? AND status IN ('pending','processing','unpaid','failed')").run(timestamp(), order.id);
      writeAudit(req.user, 'order.cancelled', 'order', order.id, { order_status: order.order_status }, { order_status: 'cancelled' });
    });
    res.json({ ok: true });
  });

  app.post('/api/store/orders/:orderId/proofs', auth(), customer, (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id=? AND customer_id=?').get(req.params.orderId, req.user.id);
    if (!order || order.payment_method !== 'bank_transfer') return res.status(404).json({ error: 'طلب التحويل غير موجود' });
    if (!['pending', 'failed', 'processing'].includes(order.payment_status) || order.order_status === 'cancelled') return res.status(409).json({ error: 'لا يمكن إضافة إثبات لهذا الطلب' });
    const transactionId = cleanText(req.body.transactionId, 100);
    const amount = money(req.body.amount);
    if (!transactionId || !amount || amount !== Number(order.total)) return res.status(400).json({ error: 'راجع رقم العملية والمبلغ المطابق لإجمالي الطلب' });
    if (db.prepare('SELECT id FROM payment_proofs WHERE transaction_id=?').get(transactionId)) return res.status(409).json({ error: 'رقم العملية مستخدم في إثبات آخر' });
    let stored;
    try { stored = saveProofImage(req.body.imageData); } catch (error) { return res.status(400).json({ error: error.message }); }
    const payment = db.prepare('SELECT id FROM payments WHERE order_id=? ORDER BY created_at DESC LIMIT 1').get(order.id);
    const proofId = newId();
    const createdAt = timestamp();
    transaction(() => {
      db.prepare('INSERT INTO payment_proofs(id,payment_id,order_id,user_id,stored_name,mime_type,transaction_id,claimed_amount,transferred_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(proofId, payment.id, order.id, req.user.id, stored.fileName, stored.mimeType, transactionId, amount, cleanText(req.body.transferredAt, 40), createdAt);
      db.prepare("UPDATE orders SET payment_status='processing',order_status='payment_pending',updated_at=? WHERE id=?").run(createdAt, order.id);
      db.prepare("UPDATE payments SET status='processing',transaction_id=?,updated_at=? WHERE id=?").run(transactionId, createdAt, payment.id);
      writeAudit(req.user, 'payment.proof_submitted', 'payment_proof', proofId, {}, { order_id: order.id, transactionId, amount });
    });
    const admins = db.prepare("SELECT id FROM users WHERE role='admin' AND status='active'").all();
    admins.forEach((admin) => notify(admin.id, 'إثبات دفع جديد', `طلب ${order.order_number} يحتاج مراجعة`));
    res.status(201).json({ id: proofId, reviewStatus: 'pending', message: 'وصل الإثبات للمراجعة ولا يعد الدفع مؤكدًا حتى اعتماده' });
  });

  app.get('/api/store/notifications', auth(), (req, res) => {
    res.json(db.prepare('SELECT id,title,message,read_at,created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(req.user.id));
  });
  app.patch('/api/store/notifications/:id/read', auth(), (req, res) => {
    const result = db.prepare('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?').run(timestamp(), req.params.id, req.user.id);
    res.json({ ok: Boolean(result.changes) });
  });

  app.get('/api/admin/store/dashboard', auth(), can('orders.read'), (_req, res) => {
    const count = (sql) => Number(db.prepare(sql).get().count || 0);
    res.json({
      sales: Number(db.prepare("SELECT COALESCE(SUM(total),0) AS total FROM orders WHERE payment_status IN ('paid','collected')").get().total),
      orders: count('SELECT COUNT(*) AS count FROM orders'),
      newOrders: count("SELECT COUNT(*) AS count FROM orders WHERE order_status IN ('new','payment_pending')"),
      preparing: count("SELECT COUNT(*) AS count FROM orders WHERE order_status='preparing'"),
      ready: count("SELECT COUNT(*) AS count FROM orders WHERE order_status='ready_for_delivery'"),
      delivering: count("SELECT COUNT(*) AS count FROM orders WHERE order_status='out_for_delivery'"),
      completed: count("SELECT COUNT(*) AS count FROM orders WHERE order_status='delivered'"),
      cancelled: count("SELECT COUNT(*) AS count FROM orders WHERE order_status='cancelled'"),
      customers: count("SELECT COUNT(*) AS count FROM users WHERE role='customer'"),
      pendingProofs: count("SELECT COUNT(*) AS count FROM payment_proofs WHERE review_status='pending'"),
      lowStock: count("SELECT COUNT(*) AS count FROM products WHERE status='published' AND stock<=low_stock_threshold"),
    });
  });
  app.get('/api/admin/store/orders', auth(), can('orders.read'), (req, res) => {
    const status = cleanText(req.query.status, 40);
    const q = cleanText(req.query.q, 80);
    const filters = ['1=1']; const params = [];
    if (status) { filters.push('o.order_status=?'); params.push(status); }
    if (q) { filters.push('(o.order_number LIKE ? OR u.name LIKE ? OR u.phone LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    res.json(db.prepare(`SELECT o.*,u.name AS customer_name,u.phone AS customer_phone FROM orders o JOIN users u ON u.id=o.customer_id WHERE ${filters.join(' AND ')} ORDER BY o.created_at DESC LIMIT 200`).all(...params).map(orderRecord));
  });
  app.patch('/api/admin/store/orders/:id/status', auth(), can('orders.write'), (req, res) => {
    const transitions = new Set(['preparing', 'ready_for_delivery', 'cancelled']);
    const status = cleanText(req.body.status, 40);
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (!transitions.has(status)) return res.status(400).json({ error: 'حالة الطلب غير صالحة' });
    if (status === 'preparing' && !['paid', 'unpaid'].includes(order.payment_status)) return res.status(409).json({ error: 'لا يمكن تجهيز طلب بانتظار مراجعة الدفع' });
    if (status === 'preparing' && !['new', 'payment_failed'].includes(order.order_status)) return res.status(409).json({ error: 'لا يمكن نقل الطلب لهذه الحالة' });
    if (status === 'ready_for_delivery' && order.order_status !== 'preparing') return res.status(409).json({ error: 'جهّز الطلب قبل إرساله للتوصيل' });
    if (status === 'cancelled' && (!['new', 'payment_pending', 'payment_failed', 'preparing'].includes(order.order_status) || ['paid', 'collected'].includes(order.payment_status))) return res.status(409).json({ error: 'لا يمكن الإلغاء بعد تأكيد الدفع أو بدء التوصيل' });
    if (status === 'cancelled') {
      transaction(() => {
        db.prepare('UPDATE products SET stock=stock+(SELECT quantity FROM order_items WHERE order_id=? AND product_id=products.id),updated_at=? WHERE id IN (SELECT product_id FROM order_items WHERE order_id=?)').run(order.id, timestamp(), order.id);
        db.prepare('SELECT product_id,quantity FROM order_items WHERE order_id=?').all(order.id).forEach((item) => db.prepare('INSERT INTO inventory_transactions(id,product_id,order_id,actor_id,quantity_delta,reason,created_at) VALUES(?,?,?,?,?,?,?)').run(newId(), item.product_id, order.id, req.user.id, item.quantity, 'admin_order_cancelled', timestamp()));
        db.prepare("UPDATE payments SET status='cancelled',updated_at=? WHERE order_id=? AND status IN ('pending','processing','unpaid','failed')").run(timestamp(), order.id);
        db.prepare('UPDATE orders SET order_status=?,updated_at=? WHERE id=?').run(status, timestamp(), order.id);
        writeAudit(req.user, 'order.status_changed', 'order', order.id, { order_status: order.order_status }, { order_status: status });
      });
    } else {
      db.prepare('UPDATE orders SET order_status=?,updated_at=? WHERE id=?').run(status, timestamp(), order.id);
      writeAudit(req.user, 'order.status_changed', 'order', order.id, { order_status: order.order_status }, { order_status: status });
    }
    notify(order.customer_id, 'تحديث حالة الطلب', `حالة الطلب ${order.order_number}: ${status}`);
    res.json({ ok: true });
  });
  app.post('/api/admin/store/orders/:id/assign', auth(), can('agents.write'), (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
    const agent = db.prepare("SELECT id FROM users WHERE id=? AND role='courier' AND status='active'").get(req.body.agentId);
    if (!order || !agent) return res.status(404).json({ error: 'الطلب أو المندوب غير موجود' });
    if (!['ready_for_delivery', 'assigned', 'failed_delivery'].includes(order.order_status)) return res.status(409).json({ error: 'جهّز الطلب قبل تعيين المندوب' });
    const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const hash = crypto.createHash('sha256').update(otp).digest('hex');
    db.prepare("UPDATE orders SET delivery_agent_id=?,order_status='assigned',shipping_status='assigned',delivery_otp_hash=?,updated_at=? WHERE id=?").run(agent.id, hash, timestamp(), order.id);
    db.prepare('INSERT INTO shipments(id,order_id,status,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at')
      .run(newId(), order.id, 'assigned', timestamp(), timestamp());
    notify(agent.id, 'طلب توصيل جديد', `تم تعيين الطلب ${order.order_number}`);
    notify(order.customer_id, 'رمز تأكيد التوصيل', `رمزك لتأكيد استلام ${order.order_number}: ${otp}`);
    writeAudit(req.user, 'order.agent_assigned', 'order', order.id, { delivery_agent_id: order.delivery_agent_id }, { delivery_agent_id: agent.id });
    res.json({ ok: true, message: 'تم تعيين المندوب وإرسال رمز التأكيد للعميل' });
  });
  app.get('/api/admin/store/proofs', auth(), can('proofs.read'), (_req, res) => {
    res.json(db.prepare(`SELECT p.id,p.order_id,p.user_id,p.transaction_id,p.claimed_amount,p.transferred_at,p.ocr_result,p.confidence,p.review_status,p.created_at,o.order_number,u.name AS customer_name FROM payment_proofs p JOIN orders o ON o.id=p.order_id JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 200`).all());
  });
  app.get('/api/store/proofs/:id/image', auth(), (req, res) => {
    const proof = db.prepare('SELECT * FROM payment_proofs WHERE id=?').get(req.params.id);
    if (!proof || (proof.user_id !== req.user.id && req.user.role !== 'admin')) return res.status(404).json({ error: 'الإثبات غير موجود' });
    if (proof.user_id !== req.user.id && !hasPermission(req.user, 'payments.read')) return res.status(403).json({ error: 'ليس لديك صلاحية لعرض الإيصال' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(proof.mime_type).sendFile(path.join(storageDirectory, proof.stored_name));
  });
  app.patch('/api/admin/store/proofs/:id/review', auth(), can('proofs.write'), (req, res) => {
    const action = req.body.action;
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'قرار المراجعة غير صالح' });
    const proof = db.prepare('SELECT * FROM payment_proofs WHERE id=?').get(req.params.id);
    if (!proof || proof.review_status !== 'pending') return res.status(404).json({ error: 'الإثبات غير موجود أو تمت مراجعته' });
    const status = action === 'approve' ? 'paid' : 'payment_pending';
    const paymentStatus = action === 'approve' ? 'paid' : 'failed';
    transaction(() => {
      db.prepare('UPDATE payment_proofs SET review_status=?,reviewer_id=?,reviewed_at=? WHERE id=?').run(action === 'approve' ? 'approved' : 'rejected', req.user.id, timestamp(), proof.id);
      db.prepare('UPDATE payments SET status=?,updated_at=? WHERE id=?').run(paymentStatus, timestamp(), proof.payment_id);
      db.prepare("UPDATE orders SET payment_status=?,order_status=CASE WHEN ?='paid' THEN 'preparing' ELSE ? END,updated_at=? WHERE id=?").run(paymentStatus, paymentStatus, status, timestamp(), proof.order_id);
      writeAudit(req.user, `payment_proof.${action}`, 'payment_proof', proof.id, { review_status: 'pending' }, { review_status: action === 'approve' ? 'approved' : 'rejected' });
    });
    const order = db.prepare('SELECT customer_id,order_number FROM orders WHERE id=?').get(proof.order_id);
    notify(order.customer_id, action === 'approve' ? 'تم تأكيد الدفع' : 'إثبات الدفع يحتاج مراجعة', `${order.order_number}: ${action === 'approve' ? 'تم اعتماد التحويل وتجهيز الطلب' : 'لم يتم اعتماد الإثبات'}`);
    res.json({ ok: true });
  });

  app.get('/api/admin/store/products', auth(), can('products.read'), (_req, res) => res.json(db.prepare('SELECT p.*,c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.updated_at DESC').all().map(productRecord)));
  app.post('/api/admin/store/products', auth(), can('products.write'), (req, res) => {
    const name = cleanText(req.body.name, 160);
    const sku = cleanText(req.body.sku, 80) || `ORB-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const price = money(req.body.price);
    const stock = Number(req.body.stock);
    if (!name || price <= 0 || !Number.isInteger(stock) || stock < 0) return res.status(400).json({ error: 'راجع اسم المنتج والسعر والمخزون' });
    const salePrice = req.body.salePrice ? money(req.body.salePrice) : null;
    if (salePrice !== null && (salePrice <= 0 || salePrice > price)) return res.status(400).json({ error: 'سعر العرض يجب أن يكون أكبر من صفر وأقل من السعر الأساسي' });
    const id = newId(); const publicId = createPublicId('PRD'); const slug = `${cleanText(req.body.slug, 120).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-') || id.slice(0, 8)}-${id.slice(0, 6)}`;
    const images = Array.isArray(req.body.images) ? req.body.images.slice(0, 8).map((image) => cleanText(image, 500)).filter((image) => /^https:\/\//i.test(image) || /^\/(?!\/)/.test(image)) : [];
    if (req.body.imageData) {
      try { images.unshift(saveProductImage(req.body.imageData)); }
      catch (error) { return res.status(400).json({ error: error.message }); }
    }
    const createdAt = timestamp();
    try {
      transaction(() => {
        db.prepare('INSERT INTO products(id,name,slug,description,sku,category_id,price,sale_price,cost_price,stock,low_stock_threshold,status,featured,created_at,updated_at,public_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(id, name, slug, cleanText(req.body.description, 5000), sku, req.body.categoryId || null, price, salePrice, req.body.costPrice ? money(req.body.costPrice) : null, stock, Math.max(0, Number(req.body.lowStockThreshold) || 5), req.body.status === 'published' ? 'published' : 'draft', req.body.featured ? 1 : 0, createdAt, createdAt, publicId);
        registerPublicId(publicId, 'product', id);
        if (stock) db.prepare('INSERT INTO inventory_transactions(id,product_id,quantity_delta,reason,created_at) VALUES(?,?,?,?,?)').run(newId(), id, stock, 'initial_stock', createdAt);
        images.forEach((image, position) => db.prepare('INSERT INTO product_images(id,product_id,image_url,position) VALUES(?,?,?,?)').run(newId(), id, image, position));
        writeAudit(req.user, 'product.created', 'product', id, {}, { name, sku, price, stock });
      });
    } catch (error) {
      console.error('Product creation failed:', error);
      return res.status(409).json({ error: error.message.includes('UNIQUE') ? 'رمز SKU مستخدم بالفعل' : 'تعذر حفظ المنتج' });
    }
    res.status(201).json(productRecord(db.prepare('SELECT * FROM products WHERE id=?').get(id)));
  });
  app.patch('/api/admin/store/products/:id', auth(), can('products.write'), (req, res) => {
    const product = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
    if (!product) return res.status(404).json({ error: 'المنتج غير موجود' });
    const name = cleanText(req.body.name ?? product.name, 160);
    const price = money(req.body.price ?? product.price);
    const stock = Number(req.body.stock ?? product.stock);
    if (!name || price <= 0 || !Number.isInteger(stock) || stock < 0) return res.status(400).json({ error: 'بيانات المنتج غير صالحة' });
    const status = ['draft', 'published', 'archived'].includes(req.body.status) ? req.body.status : product.status;
    const salePrice = req.body.salePrice === undefined ? product.sale_price : req.body.salePrice === null ? null : money(req.body.salePrice);
    if (salePrice !== null && (salePrice <= 0 || salePrice > price)) return res.status(400).json({ error: 'سعر العرض يجب أن يكون أكبر من صفر وأقل من السعر الأساسي' });
    db.prepare('UPDATE products SET name=?,description=?,price=?,sale_price=?,cost_price=?,stock=?,category_id=?,status=?,featured=?,updated_at=? WHERE id=?')
      .run(name, cleanText(req.body.description ?? product.description, 5000), price, salePrice, req.body.costPrice === undefined ? product.cost_price : req.body.costPrice === null ? null : money(req.body.costPrice), stock, req.body.categoryId ?? product.category_id, status, req.body.featured === undefined ? product.featured : req.body.featured ? 1 : 0, timestamp(), product.id);
    if (stock !== Number(product.stock)) db.prepare('INSERT INTO inventory_transactions(id,product_id,actor_id,quantity_delta,reason,created_at) VALUES(?,?,?,?,?,?)').run(newId(), product.id, req.user.id, stock - Number(product.stock), 'admin_stock_adjustment', timestamp());
    writeAudit(req.user, 'product.updated', 'product', product.id, product, { name, price, stock, status });
    res.json(productRecord(db.prepare('SELECT * FROM products WHERE id=?').get(product.id)));
  });
  app.post('/api/admin/store/categories', auth(), can('categories.write'), (req, res) => {
    const name = cleanText(req.body.name, 100);
    if (!name) return res.status(400).json({ error: 'اسم التصنيف مطلوب' });
    const id = newId(); const slug = `${name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-')}-${id.slice(0, 6)}`;
    try {
      db.prepare('INSERT INTO categories(id,name,slug,description,image_url,position,created_at) VALUES(?,?,?,?,?,?,?)').run(id, name, slug, cleanText(req.body.description, 500), cleanText(req.body.imageUrl, 500), Number(req.body.position) || 0, timestamp());
    } catch { return res.status(409).json({ error: 'تعذر إنشاء التصنيف' }); }
    writeAudit(req.user, 'category.created', 'category', id, {}, { name, slug });
    res.status(201).json({ id, name, slug });
  });

  app.get('/api/store/products/:slug/reviews', (req, res) => {
    const product = db.prepare("SELECT id FROM products WHERE slug=? AND status='published'").get(req.params.slug);
    if (!product) return res.status(404).json({ error: 'المنتج غير موجود' });
    res.json(db.prepare("SELECT r.id,r.rating,r.text,r.created_at,u.name AS customer_name FROM product_reviews r JOIN users u ON u.id=r.user_id WHERE r.product_id=? AND r.status='approved' ORDER BY r.created_at DESC LIMIT 100").all(product.id));
  });
  app.post('/api/store/products/:productId/reviews', auth(), customer, (req, res) => {
    const rating = Number(req.body.rating);
    const text = cleanText(req.body.text, 1000);
    const order = db.prepare("SELECT o.id FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.id=? AND o.customer_id=? AND i.product_id=? AND o.order_status='delivered'").get(req.body.orderId, req.user.id, req.params.productId);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || !order) return res.status(400).json({ error: 'التقييم متاح بعد استلام المنتج' });
    const reviewId = newId();
    try { db.prepare('INSERT INTO product_reviews(id,product_id,order_id,user_id,rating,text,created_at) VALUES(?,?,?,?,?,?,?)').run(reviewId, req.params.productId, order.id, req.user.id, rating, text, timestamp()); }
    catch { return res.status(409).json({ error: 'سبق تقييم المنتج في هذا الطلب' }); }
    res.status(201).json({ id: reviewId, status: 'pending' });
  });
  app.get('/api/admin/store/reviews', auth(), can('products.read'), (_req, res) => res.json(db.prepare('SELECT r.*,p.name AS product_name,u.name AS customer_name,o.order_number FROM product_reviews r JOIN products p ON p.id=r.product_id JOIN users u ON u.id=r.user_id JOIN orders o ON o.id=r.order_id ORDER BY r.created_at DESC LIMIT 200').all()));
  app.patch('/api/admin/store/reviews/:id', auth(), can('products.write'), (req, res) => {
    const status = ['approved', 'rejected'].includes(req.body.status) ? req.body.status : null;
    if (!status) return res.status(400).json({ error: 'حالة التقييم غير صالحة' });
    const review = db.prepare('SELECT * FROM product_reviews WHERE id=?').get(req.params.id);
    if (!review) return res.status(404).json({ error: 'التقييم غير موجود' });
    db.prepare('UPDATE product_reviews SET status=? WHERE id=?').run(status, review.id);
    writeAudit(req.user, 'product_review.moderated', 'product_review', review.id, { status: review.status }, { status });
    res.json({ ok: true });
  });

  app.get('/api/admin/store/coupons', auth(), can('payments.write'), (_req, res) => res.json(db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all()));
  app.post('/api/admin/store/coupons', auth(), can('payments.write'), (req, res) => {
    const code = cleanText(req.body.code, 40).toUpperCase();
    const kind = req.body.kind;
    const value = money(req.body.value);
    const usageLimit = req.body.usageLimit ? Number(req.body.usageLimit) : null;
    if (!code || !['percent', 'fixed'].includes(kind) || value <= 0 || (kind === 'percent' && value > 100) || (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit < 1))) return res.status(400).json({ error: 'بيانات الكوبون غير صالحة' });
    const couponId = newId();
    try { db.prepare('INSERT INTO coupons(id,code,kind,value,starts_at,ends_at,usage_limit,min_order,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(couponId, code, kind, value, req.body.startsAt || null, req.body.endsAt || null, usageLimit, money(req.body.minOrder), req.body.active === false ? 0 : 1, timestamp()); }
    catch { return res.status(409).json({ error: 'كود الكوبون مستخدم بالفعل' }); }
    writeAudit(req.user, 'coupon.created', 'coupon', couponId, {}, { code, kind, value });
    res.status(201).json({ id: couponId, code });
  });

  app.get('/api/admin/store/customers', auth(), can('customers.read'), (req, res) => {
    const search = cleanText(req.query.q, 80);
    res.json(db.prepare(`SELECT u.id,u.name,u.phone,u.status,u.created_at,COUNT(DISTINCT o.id) AS orders,COALESCE(SUM(CASE WHEN o.payment_status IN ('paid','collected') THEN o.total ELSE 0 END),0) AS purchases FROM users u LEFT JOIN orders o ON o.customer_id=u.id WHERE u.role='customer' AND (?='' OR u.name LIKE ? OR u.phone LIKE ?) GROUP BY u.id ORDER BY u.created_at DESC LIMIT 200`).all(search, `%${search}%`, `%${search}%`));
  });
  app.patch('/api/admin/store/customers/:id/status', auth(), can('customers.write'), (req, res) => {
    const status = ['active', 'suspended'].includes(req.body.status) ? req.body.status : null;
    if (!status) return res.status(400).json({ error: 'حالة العميل غير صالحة' });
    const customerRow = db.prepare("SELECT id,status FROM users WHERE id=? AND role='customer'").get(req.params.id);
    if (!customerRow) return res.status(404).json({ error: 'العميل غير موجود' });
    db.prepare('UPDATE users SET status=? WHERE id=?').run(status, customerRow.id);
    writeAudit(req.user, 'customer.status_changed', 'user', customerRow.id, { status: customerRow.status }, { status });
    res.json({ ok: true });
  });
  app.get('/api/admin/store/payments', auth(), can('payments.read'), (req, res) => {
    const status = cleanText(req.query.status, 30);
    const condition = status ? 'WHERE p.status=?' : '';
    res.json(db.prepare(`SELECT p.*,o.order_number,u.name AS customer_name FROM payments p JOIN orders o ON o.id=p.order_id JOIN users u ON u.id=o.customer_id ${condition} ORDER BY p.created_at DESC LIMIT 300`).all(...(status ? [status] : [])));
  });
  app.get('/api/admin/store/audit', auth(), can('orders.read'), (_req, res) => res.json(db.prepare('SELECT a.*,u.name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 300').all()));
  app.get('/api/admin/store/reports', auth(), can('orders.read'), (_req, res) => {
    res.json({
      products: db.prepare("SELECT p.id,p.name,p.sku,p.stock,p.low_stock_threshold,COALESCE(SUM(CASE WHEN o.order_status='delivered' THEN i.quantity ELSE 0 END),0) AS sold FROM products p LEFT JOIN order_items i ON i.product_id=p.id LEFT JOIN orders o ON o.id=i.order_id GROUP BY p.id ORDER BY sold DESC").all(),
      monthlySales: db.prepare("SELECT strftime('%Y-%m',created_at) AS month,COUNT(*) AS orders,COALESCE(SUM(total),0) AS total FROM orders WHERE payment_status IN ('paid','collected') GROUP BY month ORDER BY month DESC LIMIT 12").all(),
      delivery: db.prepare("SELECT u.name,COUNT(*) AS total,SUM(CASE WHEN o.order_status='delivered' THEN 1 ELSE 0 END) AS completed,SUM(CASE WHEN o.order_status='failed_delivery' THEN 1 ELSE 0 END) AS failed FROM users u JOIN orders o ON o.delivery_agent_id=u.id WHERE u.role='courier' GROUP BY u.id").all(),
    });
  });
  app.get('/api/admin/store/settings', auth(), can('payments.read'), (_req, res) => {
    const settings = Object.fromEntries(db.prepare('SELECT setting_key,setting_value FROM shop_settings').all().map((row) => [row.setting_key, row.setting_value]));
    res.json({ transferBeneficiary: settings.transfer_beneficiary || process.env.ORBIT_TRANSFER_BENEFICIARY || '', transferChannel: settings.transfer_channel || process.env.ORBIT_TRANSFER_CHANNEL || '', transferAccount: settings.transfer_account || process.env.ORBIT_TRANSFER_ACCOUNT || '' });
  });
  app.put('/api/admin/store/settings', auth(), can('payments.write'), (req, res) => {
    const entries = [['transfer_beneficiary', cleanText(req.body.transferBeneficiary, 120)], ['transfer_channel', cleanText(req.body.transferChannel, 120)], ['transfer_account', cleanText(req.body.transferAccount, 120)]];
    transaction(() => entries.forEach(([key, value]) => db.prepare('INSERT INTO shop_settings(setting_key,setting_value,updated_at) VALUES(?,?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at').run(key, value, timestamp())));
    writeAudit(req.user, 'payment_instructions.updated', 'shop_settings', 'transfer', {}, { configured: entries.every(([, value]) => Boolean(value)) });
    res.json({ ok: true });
  });

  app.get('/api/admin/store/shipping-methods', auth(), can('shipping.write'), (_req, res) => res.json(db.prepare('SELECT * FROM shipping_methods ORDER BY created_at DESC').all()));
  app.post('/api/admin/store/shipping-methods', auth(), can('shipping.write'), (req, res) => {
    const name = cleanText(req.body.name, 100); const price = money(req.body.price);
    if (!name || price < 0) return res.status(400).json({ error: 'بيانات الشحن غير صالحة' });
    const id = newId();
    db.prepare('INSERT INTO shipping_methods(id,name,price,regions_json,active,created_at) VALUES(?,?,?,?,?,?)').run(id, name, price, JSON.stringify(Array.isArray(req.body.regions) ? req.body.regions.slice(0, 50).map((item) => cleanText(item, 80)) : []), req.body.active === false ? 0 : 1, timestamp());
    writeAudit(req.user, 'shipping_method.created', 'shipping_method', id, {}, { name, price });
    res.status(201).json({ id, name, price });
  });
  app.get('/api/admin/store/agents', auth(), can('agents.write'), (_req, res) => res.json(db.prepare(`SELECT u.id,u.public_id,u.name,u.phone,u.location,u.status,
    SUM(CASE WHEN o.order_status IN ('assigned','out_for_delivery') THEN 1 ELSE 0 END) AS current_orders,
    SUM(CASE WHEN o.order_status='delivered' THEN 1 ELSE 0 END) AS completed_orders,
    SUM(CASE WHEN o.order_status='failed_delivery' THEN 1 ELSE 0 END) AS failed_orders
    FROM users u LEFT JOIN orders o ON o.delivery_agent_id=u.id WHERE u.role='courier' GROUP BY u.id ORDER BY u.name`).all()));
  app.post('/api/admin/store/agents', auth(), can('agents.write'), (req, res) => {
    const name = cleanText(req.body.name, 120); const phone = cleanText(req.body.phone, 30); const password = String(req.body.password || '');
    if (!name || !/^\+?[0-9]{8,16}$/.test(phone) || password.length < 10) return res.status(400).json({ error: 'أكمل البيانات وكلمة المرور ١٠ أحرف على الأقل' });
    const userId = newId(); const publicId = createPublicId('CRY');
    try {
      transaction(() => {
        db.prepare("INSERT INTO users(id,name,phone,password_hash,role,status,location,created_at,public_id) VALUES(?,?,?,?, 'courier','active',?,?,?)").run(userId, name, phone, bcrypt.hashSync(password, 12), cleanText(req.body.area, 100), timestamp(), publicId);
        registerPublicId(publicId, 'user', userId);
      });
    }
    catch { return res.status(409).json({ error: 'رقم الهاتف مستخدم بالفعل' }); }
    writeAudit(req.user, 'courier.created', 'user', userId, {}, { name, phone });
    res.status(201).json({ id: userId, publicId, name, phone, status: 'active' });
  });

  app.get('/api/courier/dashboard', auth(), courier, (req, res) => {
    const count = (status) => Number(db.prepare('SELECT COUNT(*) AS count FROM orders WHERE delivery_agent_id=? AND order_status=?').get(req.user.id, status).count);
    res.json({ assigned: count('assigned'), today: Number(db.prepare("SELECT COUNT(*) AS count FROM orders WHERE delivery_agent_id=? AND date(created_at)=date('now') AND order_status NOT IN ('delivered','cancelled')").get(req.user.id).count), outForDelivery: count('out_for_delivery'), completed: count('delivered'), failed: count('failed_delivery') });
  });
  app.get('/api/courier/orders', auth(), courier, (req, res) => res.json(db.prepare(`SELECT o.*,u.name AS customer_name,u.phone AS customer_phone,a.city,a.area,a.line1,a.notes AS delivery_notes
    FROM orders o JOIN users u ON u.id=o.customer_id LEFT JOIN addresses a ON a.id=o.address_id
    WHERE o.delivery_agent_id=? AND o.order_status IN ('assigned','out_for_delivery','failed_delivery') ORDER BY o.created_at DESC`).all(req.user.id).map(orderRecord)));
  app.patch('/api/courier/orders/:id/respond', auth(), courier, (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id=? AND delivery_agent_id=?').get(req.params.id, req.user.id);
    if (!order || order.order_status !== 'assigned') return res.status(404).json({ error: 'طلب التوصيل غير موجود' });
    if (!['accept', 'reject'].includes(req.body.action)) return res.status(400).json({ error: 'اختيار غير صالح' });
    if (req.body.action === 'reject' && !cleanText(req.body.reason, 300)) return res.status(400).json({ error: 'اذكر سبب رفض الطلب' });
    const status = req.body.action === 'accept' ? 'assigned' : 'ready_for_delivery';
    const shippingStatus = req.body.action === 'accept' ? 'accepted' : 'pending';
    db.prepare("UPDATE orders SET delivery_agent_id=?,order_status=?,shipping_status=?,delivery_otp_hash=CASE WHEN ?='reject' THEN NULL ELSE delivery_otp_hash END,delivery_reason=?,updated_at=? WHERE id=?").run(req.body.action === 'accept' ? req.user.id : null, status, shippingStatus, req.body.action, req.body.action === 'reject' ? cleanText(req.body.reason, 300) : '', timestamp(), order.id);
    if (req.body.action === 'reject') {
      db.prepare("UPDATE shipments SET status='pending',updated_at=? WHERE order_id=?").run(timestamp(), order.id);
      notify(order.customer_id, 'تحديث التوصيل', `سيتم إعادة تعيين مندوب لطلب ${order.order_number}`);
    }
    writeAudit(req.user, `courier.${req.body.action}`, 'order', order.id, { delivery_agent_id: req.user.id }, { delivery_agent_id: req.body.action === 'accept' ? req.user.id : null, reason: cleanText(req.body.reason, 300) });
    res.json({ ok: true });
  });
  app.post('/api/courier/orders/:id/start', auth(), courier, (req, res) => {
    const result = db.prepare("UPDATE orders SET order_status='out_for_delivery',shipping_status='out_for_delivery',updated_at=? WHERE id=? AND delivery_agent_id=? AND order_status='assigned' AND shipping_status='accepted'").run(timestamp(), req.params.id, req.user.id);
    if (!result.changes) return res.status(409).json({ error: 'لا يمكن بدء هذا الطلب' });
    db.prepare("UPDATE shipments SET status='out_for_delivery',updated_at=? WHERE order_id=?").run(timestamp(), req.params.id);
    res.json({ ok: true });
  });
  app.post('/api/courier/orders/:id/deliver', auth(), courier, (req, res) => {
    const order = db.prepare("SELECT * FROM orders WHERE id=? AND delivery_agent_id=? AND order_status='out_for_delivery'").get(req.params.id, req.user.id);
    if (!order) return res.status(404).json({ error: 'الطلب غير متاح للتسليم' });
    const otpHash = crypto.createHash('sha256').update(String(req.body.otp || '')).digest('hex');
    if (!order.delivery_otp_hash || otpHash !== order.delivery_otp_hash) return res.status(400).json({ error: 'رمز التسليم غير صحيح' });
    const payment = db.prepare('SELECT * FROM payments WHERE order_id=? ORDER BY created_at DESC LIMIT 1').get(order.id);
    const collected = payment.method === 'cod' ? money(req.body.collectedAmount) : 0;
    if (payment.method === 'cod' && collected !== Number(order.total)) return res.status(409).json({ error: `يجب تحصيل المبلغ كاملًا: ${order.total} جنيه` });
    transaction(() => {
      db.prepare("UPDATE orders SET order_status='delivered',shipping_status='delivered',payment_status=CASE WHEN payment_method='cod' THEN 'collected' ELSE payment_status END,delivery_otp_hash=NULL,updated_at=? WHERE id=?").run(timestamp(), order.id);
      if (payment.method === 'cod') db.prepare("UPDATE payments SET status='collected',collected_amount=?,updated_at=? WHERE id=?").run(collected, timestamp(), payment.id);
      db.prepare("UPDATE shipments SET status='delivered',updated_at=? WHERE order_id=?").run(timestamp(), order.id);
      writeAudit(req.user, 'order.delivered', 'order', order.id, { order_status: 'out_for_delivery' }, { order_status: 'delivered', collectedAmount: collected });
    });
    notify(order.customer_id, 'تم تسليم طلبك', `تم تسليم الطلب ${order.order_number}`);
    res.json({ ok: true });
  });
  app.post('/api/courier/orders/:id/fail', auth(), courier, (req, res) => {
    const order = db.prepare("SELECT * FROM orders WHERE id=? AND delivery_agent_id=? AND order_status='out_for_delivery'").get(req.params.id, req.user.id);
    const reason = cleanText(req.body.reason, 300);
    if (!order || !reason) return res.status(400).json({ error: 'اختر سبب تعذر التسليم' });
    db.prepare("UPDATE orders SET order_status='failed_delivery',shipping_status='failed_delivery',delivery_reason=?,updated_at=? WHERE id=?").run(reason, timestamp(), order.id);
    notify(order.customer_id, 'تعذر تسليم الطلب', `${order.order_number}: ${reason}`);
    const admins = db.prepare("SELECT id FROM users WHERE role='admin' AND status='active'").all();
    admins.forEach((admin) => notify(admin.id, 'فشل تسليم طلب', `${order.order_number}: ${reason}`));
    writeAudit(req.user, 'order.failed_delivery', 'order', order.id, { order_status: 'out_for_delivery' }, { order_status: 'failed_delivery', reason });
    res.json({ ok: true });
  });
}
#!/usr/bin/env node
/**
 * 截图/演示专用数据播种：在已运行的实例上通过 API + 直连 DB 造出"看起来像真在运营"的场景。
 * 幂等：重复执行会先清理上次由本脚本造的演示数据（按固定 slug / sku 前缀识别）。
 *
 * 用法：DATABASE_URL=... BASE=http://127.0.0.1:3300 node scripts/capture/seed-demo.mjs
 */
import postgres from 'postgres';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3300';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[seed-demo] DATABASE_URL is required');
  process.exit(1);
}
const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
const SELLER_CODE = process.env.SELLER_REGISTRATION_CODE ?? 'smoke-secret';
const runId = 'demo';

async function api(method, path, { cookie, json, expect = [200, 201] } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const body = await res.json().catch(() => null);
  if (!expect.includes(res.status)) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(body)}`);
  }
  return { body, cookie: setCookie.map((c) => c.split(';')[0]).join('; ') };
}

async function loginOrRegister(creds, role) {
  const loginRes = await api('POST', '/api/auth/login', { json: creds, expect: [200, 201, 401] });
  if (loginRes.body?.user) return loginRes.cookie;

  const registerRes = await api('POST', '/api/auth/register', {
    json: { ...creds, name: role === 'seller' ? 'Flow Seller' : 'Flow Buyer', role, ...(role === 'seller' ? { sellerCode: SELLER_CODE } : {}) },
  });
  return registerRes.cookie;
}

const PRODUCTS = [
  { key: 'cup', titleZh: '便携折叠水杯 500ml', titleEn: 'Portable Folding Cup 500ml', cat: 'outdoor', price: '12.90', px: '18.90', stock: 268, sold: 1240, weight: '0.300',
    descZh: '食品级硅胶折叠水杯，折叠后仅 3cm 厚，适合徒步、露营与通勤。', descEn: 'Food-grade silicone folding cup, 3cm flat when folded — great for hiking, camping and commuting.',
    bullets: ['折叠后仅 3cm，可放进口袋', '食品级硅胶，-40℃~230℃耐温', '防漏旋盖，倒置不漏水', '附登山扣，可挂背包', '可进洗碗机'] },
  { key: 'cushion', titleZh: '棉麻北欧抱枕套 45×45cm', titleEn: 'Linen Cushion Cover 45×45cm', cat: 'home', price: '9.50', px: '14.90', stock: 512, sold: 986, weight: '0.200',
    descZh: '天然棉麻面料，隐形拉链，机洗可用，为沙发与床品增添北欧质感。', descEn: 'Natural linen-cotton blend with hidden zipper, machine washable — a Nordic touch for sofa and bed.',
    bullets: ['天然棉麻混纺，透气亲肤', '隐形拉链，美观不刮手', '可机洗，色牢度 4 级', '45×45cm 通用尺寸', '多色可选'] },
  { key: 'bottle', titleZh: '户外真空保温壶 1L', titleEn: 'Vacuum Insulated Bottle 1L', cat: 'outdoor', price: '24.00', px: '32.00', stock: 174, sold: 1520, weight: '0.560',
    descZh: '双层真空不锈钢保温壶，保温 24 小时、保冷 12 小时，附便携提手。', descEn: 'Double-wall vacuum stainless steel — 24h hot / 12h cold, with a carry handle.',
    bullets: ['316 不锈钢内胆', '保温 24h / 保冷 12h', '一体成型无焊缝', '防滑硅胶底垫', '附便携提手'] },
  { key: 'lamp', titleZh: '护眼折叠台灯（三档调光）', titleEn: 'Foldable Desk Lamp (3-Level Dimming)', cat: 'home', price: '19.90', px: '28.00', stock: 96, sold: 640, weight: '0.480',
    descZh: '无频闪护眼台灯，三档色温调节，USB-C 供电，可折叠收纳。', descEn: 'Flicker-free desk lamp with 3 color temperatures, USB-C powered and foldable.',
    bullets: ['无频闪，护眼认证', '三档色温可调', 'USB-C 供电口', '触控无级调光', '可折叠出行携带'] },
  { key: 'backpack', titleZh: '轻量通勤双肩包 20L', titleEn: 'Lightweight Commuter Backpack 20L', cat: 'outdoor', price: '35.00', px: '49.00', stock: 143, sold: 820, weight: '0.720',
    descZh: '20L 轻量通勤双肩包，防泼水面料，独立 15.6 寸笔记本仓。', descEn: '20L commuter backpack with water-repellent fabric and a padded 15.6" laptop sleeve.',
    bullets: ['防泼水涤纶面料', '独立 15.6 寸笔电仓', '背部透气网孔', '行李箱拉杆带', 'YKK 拉链'] },
  { key: 'speaker', titleZh: '迷你蓝牙音箱（防水）', titleEn: 'Mini Bluetooth Speaker (Waterproof)', cat: 'digital', price: '22.50', px: '29.90', stock: 210, sold: 1130, weight: '0.310',
    descZh: 'IPX7 防水迷你蓝牙音箱，10 小时续航，支持双机串联立体声。', descEn: 'IPX7 waterproof mini speaker, 10h battery, supports stereo pairing.',
    bullets: ['IPX7 级防水', '10 小时续航', '双机串联立体声', '蓝牙 5.3 低延迟', '附挂绳'] },
];

const CATEGORIES = [
  { slug: 'home', nameZh: '家居生活', nameEn: 'Home & Living', sort: 1 },
  { slug: 'outdoor', nameZh: '户外运动', nameEn: 'Sports & Outdoors', sort: 2 },
  { slug: 'digital', nameZh: '数码配件', nameEn: 'Digital Accessories', sort: 3 },
];

try {
  // ---------- 清理上次演示数据 ----------
  // Order matters: children first, otherwise the product delete trips the
  // order_items foreign key on a second run.
  await sql`DELETE FROM refunds WHERE order_id IN (SELECT id FROM orders WHERE seller_id IN (SELECT id FROM users WHERE email = 'seller@example.com'))`;
  await sql`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE seller_id IN (SELECT id FROM users WHERE email = 'seller@example.com'))`;
  await sql`DELETE FROM order_notes WHERE order_id IN (SELECT id FROM orders WHERE seller_id IN (SELECT id FROM users WHERE email = 'seller@example.com'))`;
  await sql`DELETE FROM orders WHERE seller_id IN (SELECT id FROM users WHERE email = 'seller@example.com')`;
  await sql`DELETE FROM reviews WHERE product_id IN (SELECT id FROM products WHERE seller_id IN (SELECT id FROM users WHERE email = 'seller@example.com'))`;
  await sql`DELETE FROM favorites WHERE product_id IN (SELECT id FROM products WHERE seller_id IN (SELECT id FROM users WHERE email = 'seller@example.com'))`;
  await sql`DELETE FROM cart_items WHERE product_id IN (SELECT id FROM products WHERE seller_id IN (SELECT id FROM users WHERE email = 'seller@example.com'))`;
  await sql`DELETE FROM collection_products WHERE collection_id IN (SELECT id FROM collections WHERE slug LIKE ${'demo-%'})`;
  await sql`DELETE FROM collections WHERE slug LIKE ${'demo-%'}`;
  await sql`DELETE FROM cms_pages WHERE slug IN ('about','faq','privacy','terms','shipping-info','returns','payment-methods','how-to-order','help','contact','demo-faq')`;
  // 批次与分仓库存必须先删：它们外键指向 product_variants，直接删商品会被约束拦住。
  await sql`DELETE FROM stock_batches WHERE variant_id IN (
    SELECT id FROM product_variants WHERE sku LIKE ${'DEMO-%'}
  )`;
  await sql`DELETE FROM stock_reservations WHERE variant_id IN (
    SELECT id FROM product_variants WHERE sku LIKE ${'DEMO-%'}
  )`;
  await sql`DELETE FROM warehouse_stock WHERE variant_id IN (
    SELECT id FROM product_variants WHERE sku LIKE ${'DEMO-%'}
  )`;
  await sql`DELETE FROM products WHERE id IN (
    SELECT DISTINCT product_id FROM product_variants WHERE sku LIKE ${'DEMO-%'}
  )`;
  await sql`DELETE FROM categories WHERE slug IN ${sql([...CATEGORIES.map((c) => c.slug), 'home-living', 'sports-outdoors'])}`;
  console.log('[seed-demo] 旧演示数据已清理');

  // ---------- 账号 ----------
  const sellerCookie = await loginOrRegister({ email: 'seller@example.com', password: 'seller123' }, 'seller');
  const buyerCookie = await loginOrRegister({ email: 'buyer@example.com', password: 'buyer123' }, 'buyer');
  const sellerId = (await sql`SELECT id FROM users WHERE email = 'seller@example.com'`)[0].id;
  console.log('[seed-demo] 买卖家账号就绪');

  // ---------- 分类 ----------
  const catIds = {};
  for (const c of CATEGORIES) {
    const [row] = await sql`
      INSERT INTO categories (name_zh, name_en, slug, sort_order, updated_by)
      VALUES (${c.nameZh}, ${c.nameEn}, ${c.slug}, ${c.sort}, ${sellerId})
      RETURNING id`;
    catIds[c.slug] = row.id;
  }

  // ---------- 默认仓 ----------
  // 分仓库存是下单时的真相来源，批次是 FEFO 扣减的依据。
  // 三者（聚合 / 分仓 / 批次）必须同时写入，否则演示环境一下单就 409。
  await sql`DELETE FROM warehouses WHERE seller_id = ${sellerId} AND code = 'DEFAULT'`;
  const [demoWarehouse] = await sql`
    INSERT INTO warehouses (seller_id, name, code, country, is_default, priority)
    VALUES (${sellerId}, '默认仓', 'DEFAULT', 'CN', true, 100)
    RETURNING id`;
  console.log('[seed-demo] 默认仓已创建');

  // ---------- 商品 ----------
  const productIds = {};
  for (const p of PRODUCTS) {
    const imgs = [`/demo/${p.key}.png`];
    const [prod] = await sql`
      INSERT INTO products (
        seller_id, title_zh, title_en, desc_zh, desc_en, long_desc_zh, long_desc_en,
        category_id, cover_image, images, bullet_points_zh, bullet_points_en,
        seo_keywords_zh, seo_keywords_en, status, weight, total_stock, total_sold, updated_by, avg_rating, review_count
      ) VALUES (
        ${sellerId}, ${p.titleZh}, ${p.titleEn}, ${p.descZh}, ${p.descEn},
        ${p.descZh + '\n\n' + p.bullets.map((b) => '· ' + b).join('\n')},
        ${p.descEn + '\n\n' + p.bullets.map((b) => '· ' + b).join('\n')},
        ${catIds[p.cat]}, ${imgs[0]}, ${imgs},
        ${p.bullets}, ${p.bullets},
        ${p.titleZh}, ${p.titleEn}, 'active', ${p.weight}, ${p.stock}, ${p.sold}, ${sellerId}, 4.8, 128
      ) RETURNING id`;
    const [variant] = await sql`
      INSERT INTO product_variants (product_id, sku, option_values, price, original_price, stock, sold, variant_image, status)
      VALUES (${prod.id}, ${'DEMO-' + p.key.toUpperCase()}, ${sql.array([])}, ${p.price}, ${p.px}, ${p.stock}, ${p.sold}, ${imgs[0]}, 'active')
      RETURNING id`;

    // 分仓库存 + 批次：与聚合库存同时写入，保证 FEFO 能扣出货
    await sql`
      INSERT INTO warehouse_stock (warehouse_id, variant_id, stock, safety_stock)
      VALUES (${demoWarehouse.id}, ${variant.id}, ${p.stock}, 0)`;
    await sql`
      INSERT INTO stock_batches (seller_id, variant_id, warehouse_id, batch_no, quantity, source, note)
      VALUES (${sellerId}, ${variant.id}, ${demoWarehouse.id}, 'DEMO-DEFAULT', ${p.stock}, 'supplier',
        '演示数据默认批次（无保质期）')`;

    productIds[p.key] = prod.id;
  }
  console.log('[seed-demo] 商品 ×', PRODUCTS.length, '已写入（含图片与变体）');

  // ---------- 运费模板 ----------
  await sql`DELETE FROM shipping_templates WHERE name = '标准跨境运费'`;
  // Only one template may be the default per seller; the bootstrap seed already
  // creates one, so demote it before adding the demo template.
  await sql`UPDATE shipping_templates SET is_default = false WHERE seller_id = ${sellerId}`;
  await sql`
    INSERT INTO shipping_templates (seller_id, name, free_shipping_threshold, base_fee, extra_fee_per_unit, unit_type, is_default, special_zones)
    VALUES (${sellerId}, '标准跨境运费', '100.00', '5.00', '2.00', 'quantity', true,
      ${JSON.stringify([{ countries: ['US', 'CA'], extraFee: '3.00' }])})`;

  // ---------- 优惠券 ----------
  await sql`DELETE FROM coupons WHERE code IN ('WELCOME10', 'FREESHIP', 'SAVE5')`;
  await sql`
    INSERT INTO coupons (seller_id, code, type, value, applies_to, min_order_amount, total_quantity, per_user_limit, expires_at, active)
    VALUES
      (${sellerId}, 'WELCOME10', 'percent', '10.00', 'all', '20.00', 1000, 1, now() + interval '90 days', true),
      (${sellerId}, 'SAVE5', 'fixed', '5.00', 'all', '30.00', 500, 1, now() + interval '60 days', true),
      (${sellerId}, 'FREESHIP', 'free_shipping', '0', 'all', '50.00', 300, 1, now() + interval '30 days', true)`;

  // ---------- 集合（首页楼层）----------
  const COLLECTIONS = [
    { slug: 'demo-summer', zh: '夏日出行精选', en: 'Summer Travel Picks', dzh: '为夏日出行准备的轻便好物', den: 'Lightweight essentials for summer trips', keys: ['cup', 'bottle', 'backpack', 'speaker'], featured: true, sort: 0 },
    { slug: 'demo-home', zh: '居家焕新', en: 'Home Refresh', dzh: '用细节提升居家质感', den: 'Small details, better living', keys: ['cushion', 'lamp'], featured: true, sort: 1 },
    { slug: 'demo-hot', zh: '本周热销榜', en: 'Best Sellers This Week', dzh: '真实销量排行，跟着买不出错', den: 'Ranked by real sales', keys: ['bottle', 'speaker', 'cup'], featured: true, sort: 2 },
  ];
  const collectionIds = {};
  for (const c of COLLECTIONS) {
    const [row] = await sql`
      INSERT INTO collections (seller_id, title_zh, title_en, slug, description_zh, description_en, is_featured, sort_order, status)
      VALUES (${sellerId}, ${c.zh}, ${c.en}, ${c.slug}, ${c.dzh}, ${c.den}, ${c.featured}, ${c.sort}, 'active')
      RETURNING id`;
    collectionIds[c.slug] = row.id;
    for (const [i, key] of c.keys.entries()) {
      await sql`
        INSERT INTO collection_products (collection_id, product_id, sort_order)
        VALUES (${row.id}, ${productIds[key]}, ${i})`;
    }
  }
  console.log('[seed-demo] 集合 ×', COLLECTIONS.length, '已写入（首页楼层）');

  // ---------- CMS 页面 ----------
  const PAGES = [
    { slug: 'about', zh: '关于我们', en: 'About Us',
      czh: '<h2>让跨境生意更简单</h2><p>Flow 是一套 AI 原生的出口电商平台，帮助卖家在一个后台里完成开店、上架、获客、成交、客服与复盘的全流程。</p><h3>我们的理念</h3><p>把重复劳动交给 AI：文案、翻译、客服、选品分析，卖家只需做判断。</p>',
      cen: '<h2>Cross-Border Commerce, Simplified</h2><p>Flow is an AI-native export commerce platform that covers the entire loop — launch, list, attract, convert, support and review — in one back office.</p><h3>Our belief</h3><p>Let AI handle the repetitive work: copywriting, translation, support and product research.</p>' },
    { slug: 'faq', zh: '常见问题', en: 'FAQ',
      czh: '<h2>常见问题</h2><p><strong>发货时效？</strong>付款后 2-5 个工作日内发货，跨境包裹通常 7-15 天送达。</p><p><strong>支持退换吗？</strong>支持 30 天无理由退换，商品需保持全新未使用状态。</p><p><strong>支持哪些支付方式？</strong>信用卡（Stripe）、PayPal，也支持演示支付用于本地体验。</p>',
      cen: '<h2>FAQ</h2><p><strong>Shipping time?</strong> Dispatched within 2-5 business days; cross-border delivery usually takes 7-15 days.</p><p><strong>Returns?</strong> 30-day no-reason returns for unused items.</p><p><strong>Payments?</strong> Cards via Stripe, PayPal, plus a demo mode for local use.</p>' },
    { slug: 'privacy', zh: '隐私政策', en: 'Privacy Policy',
      czh: '<h2>隐私政策</h2><p>我们仅收集完成订单所需的信息，不出售用户数据。</p>',
      cen: '<h2>Privacy Policy</h2><p>We collect only the data required to fulfil orders and never sell user data.</p>' },
    { slug: 'terms', zh: '服务条款', en: 'Terms of Service',
      czh: '<h2>服务条款</h2><p>使用本平台即表示同意遵守当地法律法规与平台规则。</p>',
      cen: '<h2>Terms of Service</h2><p>By using this platform you agree to comply with applicable laws.</p>' },
    { slug: 'shipping-info', zh: '配送说明', en: 'Shipping Info',
      czh: '<h2>配送说明</h2><p>跨境包裹通常 7-15 天送达，发货后提供追踪号。</p>',
      cen: '<h2>Shipping Info</h2><p>Cross-border parcels usually arrive in 7-15 days with tracking.</p>' },
    { slug: 'returns', zh: '退换货政策', en: 'Return Policy',
      czh: '<h2>退换货政策</h2><p>签收后 30 天内可申请退换，商品需保持全新。</p>',
      cen: '<h2>Return Policy</h2><p>Returns accepted within 30 days of delivery for unused items.</p>' },
    { slug: 'payment-methods', zh: '支付方式', en: 'Payment Methods',
      czh: '<h2>支付方式</h2><p>支持 Stripe 信用卡、PayPal，以及本地演示支付。</p>',
      cen: '<h2>Payment Methods</h2><p>Cards via Stripe, PayPal, and demo payments for local use.</p>' },
    { slug: 'how-to-order', zh: '如何下单', en: 'How to Order',
      czh: '<h2>如何下单</h2><p>选择规格 → 加入购物车 → 填写地址 → 选择支付 → 完成付款。</p>',
      cen: '<h2>How to Order</h2><p>Pick a variant, add to cart, enter address, choose payment and pay.</p>' },
    { slug: 'help', zh: '帮助中心', en: 'Help Center',
      czh: '<h2>帮助中心</h2><p>遇到问题可查看常见问题，或通过右下角 AI 客服联系我们。</p>',
      cen: '<h2>Help Center</h2><p>Check the FAQ or reach us through the AI support widget.</p>' },
    { slug: 'contact', zh: '联系我们', en: 'Contact Us',
      czh: '<h2>联系我们</h2><p>邮箱：support@flow.example（演示地址）。</p>',
      cen: '<h2>Contact Us</h2><p>Email: support@flow.example (demo address).</p>' },
  ];
  for (const pg of PAGES) {
    await sql`
      INSERT INTO cms_pages (slug, title_zh, title_en, content_zh, content_en, is_published)
      VALUES (${pg.slug}, ${pg.zh}, ${pg.en}, ${pg.czh}, ${pg.cen}, true)`;
  }

  // ---------- 订单（制造看板数据与订单/退款场景）----------
  async function createOrder(quantity, price, status, withRefund = false) {
    const subtotal = (Number(price) * quantity).toFixed(2);
    const shipping = '5.00';
    const total = (Number(subtotal) + Number(shipping)).toFixed(2);
    const [order] = await sql`
      INSERT INTO orders (order_no, user_id, seller_id, status, subtotal, shipping_fee, discount_amount, tax_amount, total_amount,
        address_snapshot, payment_method, paid_at, shipped_at, created_at, updated_at)
      VALUES (
        ${'DEMO' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 900 + 100)},
        ${(await sql`SELECT id FROM users WHERE email = 'buyer@example.com'`)[0].id},
        ${sellerId}, ${status}, ${subtotal}, ${shipping}, '0.00', '0.00', ${total},
        ${JSON.stringify({ receiverName: 'Demo Buyer', phone: '+1 555 0134', addressLine1: '2841 Sunset Blvd', city: 'Los Angeles', state: 'CA', country: 'US', zipCode: '90026' })},
        'demo', ${status !== 'pending_payment' ? sql`now() - interval '2 days'` : null}, ${status === 'shipped' || status === 'delivered' ? sql`now() - interval '1 day'` : null},
        ${sql`now() - interval '3 days'`}, ${sql`now() - interval '1 day'`}
      ) RETURNING id, order_no`;
    return order;
  }

  const scene = [
    { key: 'bottle', qty: 2, status: 'delivered' },
    { key: 'speaker', qty: 1, status: 'shipped' },
    { key: 'cup', qty: 3, status: 'paid' },
    { key: 'backpack', qty: 1, status: 'pending_payment' },
    { key: 'lamp', qty: 2, status: 'paid', refund: true },
    { key: 'cushion', qty: 2, status: 'shipped' },
  ];
  for (const s of scene) {
    const p = PRODUCTS.find((x) => x.key === s.key);
    const order = await createOrder(s.qty, p.price, s.status);
    await sql`
      INSERT INTO order_items (order_id, product_id, product_title, variant_info, product_sku, product_image, unit_price, quantity, subtotal)
      VALUES (${order.id}, ${productIds[s.key]}, ${p.titleEn}, NULL, ${'DEMO-' + s.key.toUpperCase()},
        ${'/demo/' + s.key + '.png'}, ${p.price}, ${s.qty}, ${(Number(p.price) * s.qty).toFixed(2)})`;
    // 已支付订单补支付流水
    if (['paid', 'shipped', 'delivered'].includes(s.status)) {
      await sql`
        INSERT INTO payments (order_id, method, provider, amount, currency, status, transaction_id)
        VALUES (${order.id}, 'demo', 'demo', ${(Number(p.price) * s.qty + 5).toFixed(2)}, 'USD', 'paid', ${'DEMO_' + order.order_no})`;
    }
    // 退款场景：一笔待审批退款
    if (s.refund) {
      await sql`
        INSERT INTO refunds (order_id, user_id, refund_no, status, amount, reason, reason_detail, refund_method)
        VALUES (${order.id}, ${(await sql`SELECT id FROM users WHERE email = 'buyer@example.com'`)[0].id},
          ${'RF' + order.order_no}, 'requested', ${(Number(p.price) * s.qty).toFixed(2)}, 'quality', 'LED 灯条有一半不亮，申请退货退款', 'original')`;
    }
  }
  console.log('[seed-demo] 订单 ×', scene.length, '（含 1 笔待审批退款）已写入');

  // ---------- 评价 ----------
  await sql`DELETE FROM reviews WHERE product_id IN ${sql(Object.values(productIds))}`;
  const REVIEWS = [
    { key: 'bottle', rating: 5, content: '保温效果真的顶，早上装的热水下午还是烫的，做工也扎实。' },
    { key: 'cup', rating: 5, content: '折叠起来很薄，放包里完全不占地方，出门带着很方便。' },
    { key: 'speaker', rating: 4, content: '音质超出预期，浴室用完全不怕水，就是低音一般。' },
    { key: 'cushion', rating: 5, content: '布料有质感，颜色和图片一致，洗过一次也不变形。' },
    { key: 'backpack', rating: 4, content: '通勤够用，笔电仓有缓冲，希望以后出更大容量。' },
  ];
  const buyerId = (await sql`SELECT id FROM users WHERE email = 'buyer@example.com'`)[0].id;
  for (const r of REVIEWS) {
    await sql`
      INSERT INTO reviews (user_id, product_id, rating, content, images, helpful_count, verified_purchase)
      VALUES (${buyerId}, ${productIds[r.key]}, ${r.rating}, ${r.content}, ${sql.array([])}, ${Math.floor(Math.random() * 40) + 5}, true)`;
  }

  // ---------- 咨询会话（卖家咨询管理有内容）----------
  const sid = 'demo-inquiry-1';
  await sql`DELETE FROM inquiry_messages WHERE session_id = ${sid}`;
  await sql`DELETE FROM inquiry_sessions WHERE session_id = ${sid}`;
  await sql`
    INSERT INTO inquiry_sessions (session_id, user_id, status, last_message_at)
    VALUES (${sid}, ${buyerId}, 'active', now() - interval '2 hours')`;
  const MSGS = [
    ['user', '你好，保温壶能装碳酸饮料吗？'],
    ['assistant', '您好！不建议装碳酸饮料哦，压力可能导致盖子难以打开，装水、茶或咖啡都没问题。'],
    ['user', '明白了，那发到美国大概要多久？'],
    ['seller', '您好，美国一般 7-12 天送达，付款后 2 个工作日内发货，会提供追踪号。'],
  ];
  for (const [role, content] of MSGS) {
    await sql`INSERT INTO inquiry_messages (session_id, role, content) VALUES (${sid}, ${role}, ${content})`;
  }

  // ---------- 地址簿 ----------
  await sql`DELETE FROM addresses WHERE user_id = ${buyerId}`;
  await sql`
    INSERT INTO addresses (user_id, label, receiver_name, phone, address_line1, city, state, zip_code, country, is_default)
    VALUES
      (${buyerId}, 'Home', 'Demo Buyer', '+1 555 0134', '2841 Sunset Blvd', 'Los Angeles', 'CA', '90026', 'US', true),
      (${buyerId}, 'Office', 'Demo Buyer', '+1 555 0199', '500 Howard St, Suite 400', 'San Francisco', 'CA', '94105', 'US', false)`;

  // ---------- 收藏 ----------
  await sql`DELETE FROM favorites WHERE user_id = ${buyerId}`;
  await sql`
    INSERT INTO favorites (user_id, product_id)
    VALUES (${buyerId}, ${productIds.bottle}), (${buyerId}, ${productIds.lamp}), (${buyerId}, ${productIds.speaker})`;

  // ---------- 购物车（截图有内容）----------
  await sql`DELETE FROM cart_items WHERE user_id = ${buyerId}`;
  await sql`
    INSERT INTO cart_items (user_id, session_id, product_id, variant_id, quantity)
    SELECT ${buyerId}, ${buyerId}, pv.product_id, pv.id, 2
    FROM product_variants pv WHERE pv.sku = 'DEMO-CUP'`;
  await sql`
    INSERT INTO cart_items (user_id, session_id, product_id, variant_id, quantity)
    SELECT ${buyerId}, ${buyerId}, pv.product_id, pv.id, 1
    FROM product_variants pv WHERE pv.sku = 'DEMO-SPEAKER'`;

  // ---------- 审计日志（审计页有内容）----------
  await sql`DELETE FROM audit_logs WHERE user_id = ${sellerId} AND action LIKE 'demo.%'`;
  // Resolve real ids so the audit list shows a navigable target, not "-".
  const [couponRow] = await sql`SELECT id FROM coupons WHERE code = 'WELCOME10' LIMIT 1`;
  const [orderRow] = await sql`SELECT id FROM orders WHERE seller_id = ${sellerId} ORDER BY created_at DESC LIMIT 1`;
  const AUDITS = [
    ['demo.product_create', 'product', productIds.cup, '创建商品 便携折叠水杯 500ml'],
    ['demo.product_update', 'product', productIds.bottle, '更新商品价格 12.90 → 11.90'],
    ['demo.order_status_change', 'order', orderRow?.id, '订单状态 pending_payment → paid'],
    ['demo.coupon_create', 'coupon', couponRow?.id, '创建优惠券 WELCOME10'],
    ['demo.collection_create', 'collection', collectionIds['demo-summer'], '创建集合 夏日出行精选'],
  ];
  for (const [action, entity, entityId, _note] of AUDITS) {
    await sql`
      INSERT INTO audit_logs (user_id, role, action, entity, entity_id, before, after, ip_address, created_at)
      VALUES (${sellerId}, 'seller', ${action}, ${entity}, ${entityId ?? null}, ${null}, ${JSON.stringify({ note: _note })}, '203.0.113.10', now() - interval '1 day')`;
  }

  console.log('[seed-demo] 评价 / 咨询 / 地址 / 收藏 / 购物车 / 审计 已写入');
  console.log('[seed-demo] ALL DONE');
} catch (err) {
  console.error('[seed-demo] FAILED:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

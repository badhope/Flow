import {
  pgTable, uuid, varchar, text, integer,
  decimal, timestamp, boolean, pgEnum, uniqueIndex, index, jsonb,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ==================== Enums ====================

export const userRoleEnum = pgEnum('user_role', ['buyer', 'seller', 'admin']);
// 注意：不含 'processing'。历史上声明过但无任何迁移指向它，已由迁移 0010 移除，
// 避免对外暴露一个永远达不到的状态。
export const orderStatusEnum = pgEnum('order_status', [
  'pending_payment', 'paid', 'shipped',
  'delivered', 'cancelled', 'refunded', 'partially_refunded',
]);
export const paymentMethodEnum = pgEnum('payment_method', ['stripe', 'paypal', 'demo']);
export const couponTypeEnum = pgEnum('coupon_type', ['percent', 'fixed', 'free_shipping']);
export const refundStatusEnum = pgEnum('refund_status', ['requested', 'approved', 'rejected', 'completed']);

// ==================== Users & Auth ====================

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  name: varchar('name', { length: 100 }).notNull().default(''),
  avatar: text('avatar'),
  role: userRoleEnum('role').notNull().default('buyer'),
  // CRM / 会员
  tier: varchar('tier', { length: 20 }).notNull().default('bronze'),
  points: integer('points').notNull().default(0),
  totalSpent: decimal('total_spent', { precision: 12, scale: 2 }).notNull().default('0'),
  totalOrders: integer('total_orders').notNull().default(0),
  tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
  notes: text('notes'),
  lastOrderAt: timestamp('last_order_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 用户收货地址簿
export const addresses = pgTable('addresses', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  label: varchar('label', { length: 50 }).notNull().default('Home'),
  receiverName: varchar('receiver_name', { length: 100 }).notNull(),
  phone: varchar('phone', { length: 30 }),
  addressLine1: varchar('address_line1', { length: 255 }).notNull(),
  addressLine2: varchar('address_line2', { length: 255 }),
  city: varchar('city', { length: 100 }).notNull(),
  state: varchar('state', { length: 100 }),
  country: varchar('country', { length: 100 }).notNull().default('CN'),
  zipCode: varchar('zip_code', { length: 20 }),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ==================== Catalog: Categories ====================

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  nameZh: varchar('name_zh', { length: 100 }).notNull(),
  nameEn: varchar('name_en', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  icon: varchar('icon', { length: 50 }),
  sortOrder: integer('sort_order').notNull().default(0),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ==================== Catalog: Products & Variants ====================

// 商品主表（SPU — 展示层）
export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  sellerId: uuid('seller_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  titleZh: varchar('title_zh', { length: 500 }).notNull(),
  titleEn: varchar('title_en', { length: 500 }).notNull(),
  descZh: text('desc_zh').notNull().default(''),
  descEn: text('desc_en').notNull().default(''),
  longDescZh: text('long_desc_zh').notNull().default(''),
  longDescEn: text('long_desc_en').notNull().default(''),
  categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
  coverImage: text('cover_image').notNull().default(''),
  // 商品级图库（共用图 + 规格图覆盖在变体层管理）
  images: text('images').array().notNull().default(sql`ARRAY[]::text[]`),
  bulletPointsZh: text('bullet_points_zh').array().notNull().default(sql`ARRAY[]::text[]`),
  bulletPointsEn: text('bullet_points_en').array().notNull().default(sql`ARRAY[]::text[]`),
  seoKeywordsZh: varchar('seo_keywords_zh', { length: 500 }).notNull().default(''),
  seoKeywordsEn: varchar('seo_keywords_en', { length: 500 }).notNull().default(''),
  // 规格名（如 ["颜色", "尺码"]）
  optionNames: text('option_names').array().notNull().default(sql`ARRAY[]::text[]`),
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  weight: decimal('weight', { precision: 8, scale: 3 }),
  viewCount: integer('view_count').notNull().default(0),
  // 聚合评分（由 review 触发器维护）
  avgRating: decimal('avg_rating', { precision: 3, scale: 2 }).notNull().default('0'),
  reviewCount: integer('review_count').notNull().default(0),
  totalStock: integer('total_stock').notNull().default(0),
  totalSold: integer('total_sold').notNull().default(0),
  // 文案来源：manual=卖家手写 / ai=AI 生成待复核 / reviewed=已人工复核
  copySource: varchar('copy_source', { length: 16 }).notNull().default('manual'),
  // 跨境清关：HS 编码（国际统一商品编码）、原产国、报关品名与材质
  hsCode: varchar('hs_code', { length: 20 }),
  originCountry: varchar('origin_country', { length: 2 }),
  customsNameEn: varchar('customs_name_en', { length: 255 }),
  customsMaterialEn: varchar('customs_material_en', { length: 255 }),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // pg_trgm GIN 索引：支撑商品名 ILIKE '%kw%' 模糊搜索（需 pg_trgm 扩展，init.sql/迁移脚本创建）
  titleEnTrgmIdx: index('products_title_en_trgm_idx').using('gin', sql`${t.titleEn} gin_trgm_ops`),
  titleZhTrgmIdx: index('products_title_zh_trgm_idx').using('gin', sql`${t.titleZh} gin_trgm_ops`),
}));

// 商品变体表（SKU — 真实可售单元）
export const productVariants = pgTable('product_variants', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  sku: varchar('sku', { length: 100 }).notNull().unique(),
  // 规格值，与 product.optionNames 对应（如 ["红色", "XL"]）
  optionValues: text('option_values').array().notNull().default(sql`ARRAY[]::text[]`),
  price: decimal('price', { precision: 12, scale: 2 }).notNull(),
  originalPrice: decimal('original_price', { precision: 12, scale: 2 }),
  stock: integer('stock').notNull().default(0),
  sold: integer('sold').notNull().default(0),
  image: text('variant_image'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  productIdx: uniqueIndex('variant_product_option_idx').on(t.productId, t.optionValues),
}));

// 库存变动日志（先进先出、安全审计）
export const stockMovements = pgTable('stock_movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  variantId: uuid('variant_id').notNull().references(() => productVariants.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').notNull(), // 正数=入库/回滚，负数=出库/销售
  reason: varchar('reason', { length: 30 }).notNull(), // sale/purchase/refund_return/adjustment
  referenceId: varchar('reference_id', { length: 64 }), // 关联订单ID/调拨单ID
  note: text('note'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 商品集合（人工运营楼层 / 智能收集）
export const collections = pgTable('collections', {
  id: uuid('id').primaryKey().defaultRandom(),
  sellerId: uuid('seller_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  titleZh: varchar('title_zh', { length: 200 }).notNull(),
  titleEn: varchar('title_en', { length: 200 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  descriptionZh: text('description_zh'),
  descriptionEn: text('description_en'),
  coverImage: text('cover_image'),
  isSmart: boolean('is_smart').notNull().default(false),
  smartRules: text('smart_rules'), // JSON: {field, operator, value}[]
  isFeatured: boolean('is_featured').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const collectionProducts = pgTable('collection_products', {
  id: uuid('id').primaryKey().defaultRandom(),
  collectionId: uuid('collection_id').notNull().references(() => collections.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => ({
  cpUnique: uniqueIndex('cp_unique_idx').on(t.collectionId, t.productId),
}));

// ==================== Shopping Cart ====================

export const cartItems = pgTable('cart_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  sessionId: varchar('session_id', { length: 64 }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cartRecoveryCodes = pgTable('cart_recovery_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: varchar('session_id', { length: 64 }).notNull(),
  code: varchar('code', { length: 32 }).notNull().unique(),
  cartData: text('cart_data'),
  used: boolean('used').notNull().default(false),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ==================== Coupons (Enhanced) ====================

export const coupons = pgTable('coupons', {
  id: uuid('id').primaryKey().defaultRandom(),
  sellerId: uuid('seller_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 50 }).notNull().unique(),
  type: couponTypeEnum('type').notNull().default('percent'),
  value: decimal('value', { precision: 10, scale: 2 }).notNull().default('0'),
  // 适用: all | category | product
  appliesTo: varchar('applies_to', { length: 20 }).notNull().default('all'),
  appliesToIds: uuid('applies_to_ids').array().notNull().default(sql`ARRAY[]::uuid[]`),
  // 包邮
  freeShipping: boolean('free_shipping').notNull().default(false),
  // 门槛
  minOrderAmount: decimal('min_order_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  // 数量控制
  totalQuantity: integer('total_quantity').notNull().default(0),
  usedCount: integer('used_count').notNull().default(0),
  perUserLimit: integer('per_user_limit').notNull().default(1),
  // 时间
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 每用户优惠券用量（用于 per_user_limit 精确校验）
export const couponUsage = pgTable('coupon_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  couponId: uuid('coupon_id').notNull().references(() => coupons.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  orderId: uuid('order_id'),
  usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  cuUnique: uniqueIndex('coupon_usage_unique').on(t.couponId, t.userId, t.orderId),
}));

// ==================== Shipping ====================

// 运费模板
export const shippingTemplates = pgTable('shipping_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  sellerId: uuid('seller_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  // free_shipping_threshold: 满多少包邮（0=不包邮）
  freeShippingThreshold: decimal('free_shipping_threshold', { precision: 12, scale: 2 }).notNull().default('0'),
  // 默认运费（首重/首件）
  baseFee: decimal('base_fee', { precision: 10, scale: 2 }).notNull().default('0'),
  // 续重/续件费率
  extraFeePerUnit: decimal('extra_fee_per_unit', { precision: 10, scale: 2 }).notNull().default('0'),
  // 计费单位: weight(重量) | quantity(件数)
  unitType: varchar('unit_type', { length: 20 }).notNull().default('quantity'),
  // 特殊地区加价（JSON: [{countries: ['CN'], extraFee: 10}]）
  specialZones: text('special_zones'),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ==================== Orders ====================

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderNo: varchar('order_no', { length: 32 }).notNull().unique(),
  // 游客（未登录）下单时为空，归属通过 address_snapshot.sessionId 校验
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  sellerId: uuid('seller_id').references(() => users.id, { onDelete: 'set null' }),
  status: orderStatusEnum('status').notNull().default('pending_payment'),
  // 金额明细
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull().default('0'),
  shippingFee: decimal('shipping_fee', { precision: 12, scale: 2 }).notNull().default('0'),
  discountAmount: decimal('discount_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  totalAmount: decimal('total_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  // 多币种：订单币种 + 下单时结算汇率（1 USD = exchange_rate 该币种）
  // 记录汇率是为了汇率波动后仍能复算历史订单，不能只存金额
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  exchangeRate: decimal('exchange_rate', { precision: 18, scale: 8 }).notNull().default('1'),
  // 以 USD 计的总额，供跨币种统计与结算使用
  baseTotalAmount: decimal('base_total_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  // 发票
  invoiceRequested: boolean('invoice_requested').notNull().default(false),
  invoiceTitle: varchar('invoice_title', { length: 255 }),
  invoiceTaxId: varchar('invoice_tax_id', { length: 50 }),
  // 收货地址（快照）
  addressSnapshot: text('address_snapshot'), // JSON {receiver, phone, address, city, state, country, zip}
  // 物流
  carrier: varchar('carrier', { length: 100 }),
  trackingNumber: varchar('tracking_number', { length: 100 }),
  shippingTemplateId: uuid('shipping_template_id'),
  // 优惠券
  couponId: uuid('coupon_id'),
  couponCode: varchar('coupon_code', { length: 50 }),
  // 下单幂等键：同一买家/会话重复提交只产生一张订单（部分唯一索引见迁移 0009）
  idempotencyKey: varchar('idempotency_key', { length: 120 }),
  // 支付
  paymentMethod: paymentMethodEnum('payment_method'),
  paymentId: varchar('payment_id', { length: 255 }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  shippedAt: timestamp('shipped_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  // 备注
  customerNote: text('customer_note'),
  internalNote: text('internal_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'set null' }),
  productTitle: varchar('product_title', { length: 500 }).notNull(),
  variantInfo: varchar('variant_info', { length: 500 }), // 如 "红色 / XL"
  productSku: varchar('product_sku', { length: 100 }),
  /** 发货仓 */
  warehouseId: uuid('warehouse_id'),
  productImage: text('product_image'),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).notNull(),
  quantity: integer('quantity').notNull(),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 订单履约（支持分批发货）
export const orderFulfillments = pgTable('order_fulfillments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  carrier: varchar('carrier', { length: 100 }).notNull(),
  trackingNumber: varchar('tracking_number', { length: 100 }),
  trackingUrl: text('tracking_url'),
  status: varchar('status', { length: 30 }).notNull().default('pending'),
  shippedAt: timestamp('shipped_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const fulfillmentItems = pgTable('fulfillment_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  fulfillmentId: uuid('fulfillment_id').notNull().references(() => orderFulfillments.id, { onDelete: 'cascade' }),
  orderItemId: uuid('order_item_id').notNull().references(() => orderItems.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').notNull(),
});

// 退款/退货
export const refunds = pgTable('refunds', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  refundNo: varchar('refund_no', { length: 32 }).notNull().unique(),
  status: refundStatusEnum('status').notNull().default('requested'),
  // 退款金额
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  reason: varchar('reason', { length: 50 }).notNull(), // quality/not_as_described/wrong_item/other
  reasonDetail: text('reason_detail'),
  // 退款行项（部分退时指定）
  items: text('items'), // JSON: [{orderItemId, quantity}]
  // 商家回复
  sellerReply: text('seller_reply'),
  // 处理方
  refundMethod: varchar('refund_method', { length: 20 }).notNull().default('original'), // original=原路返回
  // 渠道退款单号：渠道返回后立刻落库，供"已退款但业务写库失败"时对账，绝不重复打款
  providerRefundId: varchar('provider_refund_id', { length: 255 }),
  // none=未发起 / inflight=已提交渠道在途 / succeeded=渠道成功 / failed=渠道明确失败
  providerState: varchar('provider_state', { length: 16 }).notNull().default('none'),
  // 发起渠道退款时使用的幂等键，重试沿用同一个值
  idempotencyKey: varchar('idempotency_key', { length: 120 }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 订单备注（卖家内部 + 顾客留言 timeline）
export const orderNotes = pgTable('order_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
  content: text('content').notNull(),
  // customer=顾客留言 / staff=卖家内部
  type: varchar('type', { length: 16 }).notNull().default('staff'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ==================== Payments & Logistics ====================

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  refundId: uuid('refund_id'),
  method: paymentMethodEnum('method'),
  provider: varchar('provider', { length: 30 }),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  // 支付时的结算汇率与折算后的 USD 金额，供对账与结算使用
  exchangeRate: decimal('exchange_rate', { precision: 18, scale: 8 }).notNull().default('1'),
  baseAmount: decimal('base_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  status: varchar('status', { length: 30 }).notNull().default('pending'),
  transactionId: varchar('transaction_id', { length: 255 }),
  rawResponse: text('raw_response'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // 渠道流水号唯一：webhook 重复投递时的幂等锚点
  providerTxnIdx: uniqueIndex('payments_provider_txn_idx').on(t.provider, t.transactionId),
}));

export const logistics = pgTable('logistics', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  fulfillmentId: uuid('fulfillment_id').references(() => orderFulfillments.id, { onDelete: 'set null' }),
  carrier: varchar('carrier', { length: 100 }),
  trackingNumber: varchar('tracking_number', { length: 100 }),
  status: varchar('status', { length: 30 }).notNull().default('pending'),
  trackingData: text('tracking_data'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ==================== Reviews (with images) ====================

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  rating: integer('rating').notNull(),
  content: text('content').notNull().default(''),
  images: text('images').array().notNull().default(sql`ARRAY[]::text[]`),
  helpfulCount: integer('helpful_count').notNull().default(0),
  // 卖家回复
  sellerReply: text('seller_reply'),
  sellerRepliedAt: timestamp('seller_replied_at', { withTimezone: true }),
  // 购买验证
  verifiedPurchase: boolean('verified_purchase').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reviewHelpfulVotes = pgTable('review_helpful_votes', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewId: uuid('review_id').notNull().references(() => reviews.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  rvUnique: uniqueIndex('review_vote_unique').on(t.reviewId, t.userId),
}));

// ==================== Favorites ====================

export const favorites = pgTable('favorites', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ==================== CMS Pages ====================

export const cmsPages = pgTable('cms_pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  titleZh: varchar('title_zh', { length: 200 }).notNull(),
  titleEn: varchar('title_en', { length: 200 }).notNull(),
  contentZh: text('content_zh').notNull().default(''),
  contentEn: text('content_en').notNull().default(''),
  metaTitleZh: varchar('meta_title_zh', { length: 200 }),
  metaTitleEn: varchar('meta_title_en', { length: 200 }),
  metaDescZh: varchar('meta_desc_zh', { length: 500 }),
  metaDescEn: varchar('meta_desc_en', { length: 500 }),
  isPublished: boolean('is_published').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ==================== SEO Redirects ====================

export const redirects = pgTable('redirects', {
  id: uuid('id').primaryKey().defaultRandom(),
  fromPath: varchar('from_path', { length: 500 }).notNull().unique(),
  toPath: varchar('to_path', { length: 500 }).notNull(),
  type: integer('type').notNull().default(301),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ==================== Audit & AI ====================

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  role: varchar('role', { length: 16 }),
  action: varchar('action', { length: 50 }).notNull(),
  entity: varchar('entity', { length: 50 }).notNull(),
  entityId: varchar('entity_id', { length: 64 }),
  before: text('before'),
  after: text('after'),
  ipAddress: varchar('ip_address', { length: 45 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const inquiryMessages = pgTable('inquiry_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: varchar('session_id', { length: 64 }).notNull(),
  role: varchar('role', { length: 16 }).notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const inquirySessions = pgTable('inquiry_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: varchar('session_id', { length: 64 }).notNull().unique(),
  userId: uuid('user_id'),
  /** 会话归属卖家：null = 平台级/未分配（历史数据），仅管理员可见 */
  sellerId: uuid('seller_id').references(() => users.id, { onDelete: 'set null' }),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sellerIdx: index('inquiry_sessions_seller_idx').on(t.sellerId, t.lastMessageAt),
}));

export const aiUsageLog = pgTable('ai_usage_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  agent: varchar('agent', { length: 32 }).notNull(),
  model: varchar('model', { length: 64 }),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  // 命中提示缓存的输入 token：成本核算的主要杠杆，单列出来才能优化
  cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(0),
  success: boolean('success').notNull().default(true),
  errorMessage: text('error_message'),
  // 按写入时的价目表算好的美元成本；null 表示模型未收录价目，不臆造
  costUsd: decimal('cost_usd', { precision: 12, scale: 6 }),
  // 关联 trace：一次 Agent 运行内多次调用共享同一个值
  traceId: varchar('trace_id', { length: 64 }),
  userId: uuid('user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ==================== Point Transactions ====================

export const pointTransactions = pgTable('point_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(), // 正=赚取, 负=消费
  type: varchar('type', { length: 20 }).notNull(), // earn/redeem/expire
  source: varchar('source', { length: 30 }).notNull(), // order/refund/manual
  referenceId: varchar('reference_id', { length: 64 }),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ==================== AI 报告（趋势/选品生成结果持久化） ====================

export const aiReports = pgTable('ai_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  reportType: varchar('report_type', { length: 30 }).notNull(), // trend / select
  title: varchar('title', { length: 200 }).notNull().default(''),
  content: text('content').notNull(),
  model: varchar('model', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ==================== AI 设置与自定义 Agent ====================

// 模型配置（键值对：llm_base_url / llm_api_key / llm_model）。
// 优先级：数据库（UI 设置）> 环境变量 > 未配置（诚实提示）。
export const aiSettings = pgTable('ai_settings', {
  // 120：容纳卖家作用域键 `{uuid36}:{key}`（最长 copilot_watch_last_snapshot 共 64 字符）
  key: varchar('key', { length: 120 }).primaryKey(),
  value: text('value').notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 自定义 AI Agent（内置 5 个由代码定义，不走此表）
export const aiAgents = pgTable('ai_agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  description: varchar('description', { length: 500 }).notNull().default(''),
  systemPrompt: text('system_prompt').notNull(),
  // 用户提示词模板：{{input}} 占位符会被运行时的输入替换；缺占位符时输入追加在末尾
  userPromptTemplate: text('user_prompt_template').notNull().default('{{input}}'),
  responseFormat: varchar('response_format', { length: 10 }).notNull().default('text'), // text | json
  temperature: decimal('temperature', { precision: 3, scale: 2 }).notNull().default('0.70'),
  maxTokens: integer('max_tokens').notNull().default(2000),
  enabled: boolean('enabled').notNull().default(true),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ==================== AI 运营副驾（工具调用 Agent + 人工审批） ====================

// 会话：卖家副驾（channel=seller）与买家导购（channel=shopper）共用，按 channel + 归属隔离。
// 买家可匿名：未登录时归属用 sessionId（与购物车同一套会话标识）。
export const copilotConversations = pgTable('copilot_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  sessionId: varchar('session_id', { length: 64 }),
  title: varchar('title', { length: 200 }).notNull().default('新对话'),
  channel: varchar('channel', { length: 16 }).notNull().default('seller'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userUpdatedIdx: index('copilot_conversations_user_updated_idx').on(t.userId, t.updatedAt),
  sessionIdx: index('copilot_conversations_session_idx').on(t.sessionId, t.updatedAt),
}));

// 消息：user / assistant / tool（工具结果回填）
export const copilotMessages = pgTable('copilot_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => copilotConversations.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 16 }).notNull(),
  content: text('content').notNull(),
  toolName: varchar('tool_name', { length: 64 }),
  toolArgs: text('tool_args'),
  toolOk: boolean('tool_ok'),
  actionId: uuid('action_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  conversationCreatedIdx: index('copilot_messages_conversation_created_idx').on(t.conversationId, t.createdAt),
}));

// 待审批动作：写操作只有经卖家显式批准后才执行
export const copilotActions = pgTable('copilot_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => copilotConversations.id, { onDelete: 'cascade' }),
  // 归属：登录用户用 userId；匿名买家（导购）用 sessionId
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  sessionId: varchar('session_id', { length: 64 }),
  toolName: varchar('tool_name', { length: 64 }).notNull(),
  kind: varchar('kind', { length: 8 }).notNull().default('write'),
  summary: varchar('summary', { length: 500 }).notNull().default(''),
  args: text('args').notNull().default('{}'),
  status: varchar('status', { length: 16 }).notNull().default('pending'),
  // 同一轮生成的多步动作共享 batchId，可整批审批（按创建顺序执行，失败即停）
  batchId: varchar('batch_id', { length: 36 }),
  result: text('result'),
  errorMessage: text('error_message'),
  // 待审批动作的过期时间：过期即不可执行，防止旧审批被翻出来执行
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  // processing 状态的租约：超时未回写可被回收为 failed，避免永久悬挂
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  // 审批时固化的工具定义指纹（风险等级 + 参数 schema hash）；工具定义变更后旧审批失效
  policySnapshot: text('policy_snapshot'),
  // 同会话同工具同参数的幂等锚点（部分唯一索引见迁移 0009）
  idempotencyKey: varchar('idempotency_key', { length: 120 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (t) => ({
  conversationStatusIdx: index('copilot_actions_conversation_status_idx').on(t.conversationId, t.status),
  userStatusIdx: index('copilot_actions_user_status_idx').on(t.userId, t.status),
  batchIdx: index('copilot_actions_batch_idx').on(t.batchId),
  sessionIdx: index('copilot_actions_session_idx').on(t.sessionId, t.status),
}));

// ==================== AI 导购转化漏斗 ====================

// 每次进入一个阶段记一行；漏斗 = 按 (sessionId | userId) 去重后逐级计数。
// 只记录阶段与商品，不含搜索词原文以外的内容，避免收集买家隐私。
export const shopperEvents = pgTable('shopper_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  sessionId: varchar('session_id', { length: 64 }),
  /** viewed=打开导购 / recommended=收到推荐 / cart_confirmed=确认加购 / ordered=该会话下单 */
  stage: varchar('stage', { length: 24 }).notNull(),
  conversationId: uuid('conversation_id').references(() => copilotConversations.id, { onDelete: 'set null' }),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
  /** 搜索关键词（仅 recommended 阶段有值，用于看"买家在找什么"） */
  keyword: varchar('keyword', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  stageCreatedIdx: index('shopper_events_stage_created_idx').on(t.stage, t.createdAt),
  sessionIdx: index('shopper_events_session_idx').on(t.sessionId, t.stage),
  userIdx: index('shopper_events_user_idx').on(t.userId, t.stage),
}));

// ==================== 页面访问（访客统计） ====================

export const visits = pgTable('visits', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: varchar('session_id', { length: 64 }).notNull(),
  path: varchar('path', { length: 200 }).notNull().default('/'),
  userId: uuid('user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sessionIdx: index('visits_session_created_idx').on(t.sessionId, t.createdAt),
}));

// ==================== Relations ====================

export const productRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  variants: many(productVariants),
  seller: one(users, { fields: [products.sellerId], references: [users.id] }),
}));

export const variantRelations = relations(productVariants, ({ one, many }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
  stockMovements: many(stockMovements),
}));

export const categoryRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));

export const orderRelations = relations(orders, ({ many }) => ({
  items: many(orderItems),
  fulfillments: many(orderFulfillments),
  refunds: many(refunds),
}));

export const orderItemRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
}));

export const fulfillmentRelations = relations(orderFulfillments, ({ one, many }) => ({
  order: one(orders, { fields: [orderFulfillments.orderId], references: [orders.id] }),
  items: many(fulfillmentItems),
  logistics: many(logistics),
}));

export const reviewRelations = relations(reviews, ({ one }) => ({
  product: one(products, { fields: [reviews.productId], references: [products.id] }),
  user: one(users, { fields: [reviews.userId], references: [users.id] }),
}));

export const userRelations = relations(users, ({ many }) => ({
  addresses: many(addresses),
  products: many(products),
}));

export const collectionRelations = relations(collections, ({ many }) => ({
  collectionProducts: many(collectionProducts),
}));

// ==================== 跨境：多币种 / 清关 / 预留 / 结算 ====================

/**
 * 币种与汇率。
 *
 * `rateToUsd` 语义：1 USD = rateToUsd 个该币种。
 * 由 `FxService` 定期从公开汇率源刷新（也可手工覆盖），
 * 订单与支付都记录下单时的汇率快照，保证历史可复算。
 */
export const currencies = pgTable('currencies', {
  code: varchar('code', { length: 3 }).primaryKey(),
  nameZh: varchar('name_zh', { length: 50 }).notNull().default(''),
  nameEn: varchar('name_en', { length: 50 }).notNull().default(''),
  symbol: varchar('symbol', { length: 8 }).notNull().default(''),
  /** 小数位：JPY/KRW 为 0，其余多为 2 */
  decimalDigits: integer('decimal_digits').notNull().default(2),
  rateToUsd: decimal('rate_to_usd', { precision: 18, scale: 8 }).notNull().default('1'),
  /** builtin=内置初值 / remote=汇率源拉取 / manual=人工设置 */
  rateSource: varchar('rate_source', { length: 20 }).notNull().default('manual'),
  rateUpdatedAt: timestamp('rate_updated_at', { withTimezone: true }),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 清关单据：一单一记录，行项目为快照，商品后续改动不影响历史单据 */
export const customsDeclarations = pgTable('customs_declarations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  declarationNo: varchar('declaration_no', { length: 40 }).notNull().unique(),
  sellerId: uuid('seller_id').references(() => users.id, { onDelete: 'set null' }),
  /** draft=已生成 / filed=已申报 / cleared=已放行 */
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  destinationCountry: varchar('destination_country', { length: 2 }).notNull().default(''),
  originCountry: varchar('origin_country', { length: 2 }).notNull().default(''),
  declaredValue: decimal('declared_value', { precision: 12, scale: 2 }).notNull().default('0'),
  declaredCurrency: varchar('declared_currency', { length: 3 }).notNull().default('USD'),
  declaredValueUsd: decimal('declared_value_usd', { precision: 12, scale: 2 }).notNull().default('0'),
  lineItems: jsonb('line_items').notNull().default(sql`'[]'::jsonb`),
  note: text('note'),
  /** 报关行回执 */
  brokerRef: varchar('broker_ref', { length: 120 }),
  brokerStatus: varchar('broker_status', { length: 40 }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  lastError: text('last_error'),
  attemptCount: integer('attempt_count').notNull().default(0),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  filedAt: timestamp('filed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orderIdx: index('customs_declarations_order_idx').on(t.orderId),
  sellerIdx: index('customs_declarations_seller_idx').on(t.sellerId),
}));

/**
 * 库存预留。
 *
 * 与"直接扣减 stock"的区别：这是一条可追踪的占用记录，
 * 能回答"多少库存被哪个订单占着、什么时候到期"。
 * soft 在下单时创建，支付成功后转 hard，取消/超时则 released。
 */
export const stockReservations = pgTable('stock_reservations', {
  id: uuid('id').primaryKey().defaultRandom(),
  variantId: uuid('variant_id').notNull().references(() => productVariants.id, { onDelete: 'cascade' }),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }),
  orderNo: varchar('order_no', { length: 32 }),
  /** 发货仓；null 表示未指定（单仓历史数据） */
  warehouseId: uuid('warehouse_id'),
  quantity: integer('quantity').notNull(),
  /** active=占用中 / consumed=已转实际扣减 / released=已释放 */
  status: varchar('status', { length: 20 }).notNull().default('active'),
  /** soft=下单软预留 / hard=支付后硬扣减 */
  kind: varchar('kind', { length: 10 }).notNull().default('soft'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  variantStatusIdx: index('stock_reservations_variant_status_idx').on(t.variantId, t.status),
  orderIdx: index('stock_reservations_order_idx').on(t.orderId),
}));

/** 平台抽成规则；sellerId 为 null 表示全局默认 */
export const commissionRules = pgTable('commission_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  sellerId: uuid('seller_id').references(() => users.id, { onDelete: 'cascade' }),
  /** 百分比，8.000 表示 8% */
  rate: decimal('rate', { precision: 6, scale: 3 }).notNull().default('8.000'),
  fixedFee: decimal('fixed_fee', { precision: 10, scale: 2 }).notNull().default('0'),
  fixedFeeCurrency: varchar('fixed_fee_currency', { length: 3 }).notNull().default('USD'),
  note: varchar('note', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 结算单：按周期汇总已履约订单，扣除退款与佣金 */
export const settlements = pgTable('settlements', {
  id: uuid('id').primaryKey().defaultRandom(),
  settlementNo: varchar('settlement_no', { length: 40 }).notNull().unique(),
  sellerId: uuid('seller_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** pending=待打款 / paid=已打款 / cancelled=已取消 */
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  grossAmount: decimal('gross_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  refundAmount: decimal('refund_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  commissionAmount: decimal('commission_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  netAmount: decimal('net_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  orderCount: integer('order_count').notNull().default(0),
  refundCount: integer('refund_count').notNull().default(0),
  /** 佣金规则快照：费率调整不影响历史结算单 */
  commissionRate: decimal('commission_rate', { precision: 6, scale: 3 }).notNull().default('0'),
  fixedFeeTotal: decimal('fixed_fee_total', { precision: 12, scale: 2 }).notNull().default('0'),
  lineItems: jsonb('line_items').notNull().default(sql`'[]'::jsonb`),
  note: text('note'),
  /** 打款流水（Stripe Connect transfer id 等） */
  payoutId: varchar('payout_id', { length: 120 }),
  payoutProvider: varchar('payout_provider', { length: 30 }),
  payoutError: text('payout_error'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sellerStatusIdx: index('settlements_seller_status_idx').on(t.sellerId, t.status),
  periodIdx: index('settlements_period_idx').on(t.periodStart, t.periodEnd),
}));

// ==================== 多仓 ====================

/**
 * 仓库。
 *
 * 多仓的意义不只是"多几个地址"：它决定从哪发货、跨境还是本地、
 * 以及同一 SKU 在有货时按什么优先级选仓。
 */
export const warehouses = pgTable('warehouses', {
  id: uuid('id').primaryKey().defaultRandom(),
  sellerId: uuid('seller_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 32 }).notNull(),
  /** 仓库所在国，决定是否跨境 */
  country: varchar('country', { length: 2 }).notNull().default('CN'),
  address: text('address'),
  contactName: varchar('contact_name', { length: 100 }),
  contactPhone: varchar('contact_phone', { length: 30 }),
  /** 同一 SKU 多仓有货时的选择优先级，数字小者优先 */
  priority: integer('priority').notNull().default(100),
  isDefault: boolean('is_default').notNull().default(false),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sellerCodeUnique: uniqueIndex('warehouses_seller_code_unique').on(t.sellerId, t.code),
}));

/** 分仓库存：真实可售数量按仓拆分。safetyStock 是预警线，不参与可售计算 */
export const warehouseStock = pgTable('warehouse_stock', {
  id: uuid('id').primaryKey().defaultRandom(),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').notNull().references(() => productVariants.id, { onDelete: 'cascade' }),
  stock: integer('stock').notNull().default(0),
  safetyStock: integer('safety_stock').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  warehouseVariantUnique: uniqueIndex('warehouse_stock_unique').on(t.warehouseId, t.variantId),
  variantIdx: index('warehouse_stock_variant_idx').on(t.variantId),
}));

/** 仓间调拨 */
export const stockTransfers = pgTable('stock_transfers', {
  id: uuid('id').primaryKey().defaultRandom(),
  transferNo: varchar('transfer_no', { length: 40 }).notNull().unique(),
  sellerId: uuid('seller_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').notNull().references(() => productVariants.id, { onDelete: 'cascade' }),
  fromWarehouseId: uuid('from_warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'cascade' }),
  toWarehouseId: uuid('to_warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').notNull(),
  /** pending=待发货 / shipped=在途 / completed=已入库 / cancelled=已取消 */
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  note: text('note'),
  shippedAt: timestamp('shipped_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sellerStatusIdx: index('stock_transfers_seller_idx').on(t.sellerId, t.status),
}));

// ==================== 报关行 / 打款账户 ====================

/**
 * 报关行对接配置。
 *
 * 不同报关服务商的接口形态差异很大，因此这里只存"端点 + 凭据 + 签名密钥"，
 * 具体报文由适配器（CustomsBrokerAdapter）负责。这样换一家报关行不用改表结构。
 */
export const customsBrokerConfigs = pgTable('customs_broker_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  sellerId: uuid('seller_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 32 }).notNull().default('generic_http'),
  endpoint: text('endpoint').notNull(),
  credentials: jsonb('credentials').notNull().default(sql`'{}'::jsonb`),
  signingSecret: text('signing_secret'),
  enabled: boolean('enabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sellerUnique: uniqueIndex('customs_broker_configs_seller_unique').on(t.sellerId),
}));

/** 卖家收款账户（Stripe Connect 等） */
export const payoutAccounts = pgTable('payout_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  sellerId: uuid('seller_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 30 }).notNull().default('stripe'),
  /** 渠道侧账户 id，如 Stripe acct_xxx */
  externalAccountId: varchar('external_account_id', { length: 120 }).notNull(),
  /** pending=资料未完成 / verified=可收款 / restricted=受限 */
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  country: varchar('country', { length: 2 }).notNull().default('CN'),
  payoutsEnabled: boolean('payouts_enabled').notNull().default(false),
  detailsSubmitted: boolean('details_submitted').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sellerProviderUnique: uniqueIndex('payout_accounts_seller_provider_unique').on(t.sellerId, t.provider),
}));

// ==================== Types ====================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Product = typeof products.$inferSelect;
export type ProductVariant = typeof productVariants.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type CartItem = typeof cartItems.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;

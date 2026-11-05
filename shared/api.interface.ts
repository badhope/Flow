export type Language = 'zh' | 'en' | 'es' | 'pt';

export type UserRole = 'buyer' | 'seller' | 'admin';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  /** 会员积分（支付成功累计，退款按金额回滚） */
  points?: number;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  role?: 'buyer' | 'seller';
  /** 注册卖家时需携带的邀请码（与 SELLER_REGISTRATION_CODE 环境变量一致） */
  sellerCode?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface GoogleAuthStatus {
  configured: boolean;
  clientId?: string;
}

export interface Category {
  id: string;
  nameZh: string;
  nameEn: string;
  slug: string;
  icon?: string;
  sortOrder: number;
}

export interface ProductSpec {
  [key: string]: string;
}

export interface ProductVariant {
  id: string;
  productId: string;
  sku: string;
  optionValues: string[];
  price: string;
  originalPrice?: string;
  stock: number;
  sold: number;
  image?: string;
  status: string;
}

export interface Product {
  id: string;
  sellerId: string;
  titleZh: string;
  titleEn: string;
  titleEs?: string;
  titlePt?: string;
  descZh: string;
  descEn: string;
  descEs?: string;
  descPt?: string;
  longDescZh: string;
  longDescEn: string;
  longDescEs?: string;
  longDescPt?: string;
  categoryId?: string;
  categoryNameZh?: string;
  categoryNameEn?: string;
  coverImage?: string;
  images: string[];
  bulletPointsZh: string[];
  bulletPointsEn: string[];
  bulletPointsEs?: string[];
  bulletPointsPt?: string[];
  optionNames: string[];
  variants: ProductVariant[];
  minPrice?: string;
  maxPrice?: string;
  totalStock: number;
  totalSold: number;
  status: 'draft' | 'active' | 'inactive';
  weight?: string;
  avgRating?: number;
  reviewCount?: number;
  seoKeywordsZh: string;
  seoKeywordsEn: string;
  seoKeywordsEs?: string;
  seoKeywordsPt?: string;
  /** 跨境清关字段 */
  hsCode?: string;
  originCountry?: string;
  customsNameEn?: string;
  customsMaterialEn?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductListParams {
  page?: number;
  pageSize?: number;
  categoryId?: string;
  keyword?: string;
  minPrice?: number;
  maxPrice?: number;
  sortBy?: 'price_asc' | 'price_desc' | 'sold_desc' | 'newest';
  status?: string;
  /** 卖家工作台：mine = 只看自己店铺全部状态商品（仅卖家/管理员生效） */
  scope?: 'mine';
}

export interface ProductListResponse {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateProductRequest {
  sku?: string;
  titleZh: string;
  titleEn: string;
  descZh?: string;
  descEn?: string;
  longDescZh?: string;
  longDescEn?: string;
  categoryId?: string;
  price: number;
  originalPrice?: number;
  stock?: number;
  status?: 'draft' | 'active' | 'inactive';
  coverImage?: string;
  images?: string[];
  specs?: ProductSpec;
  seoKeywordsZh?: string;
  seoKeywordsEn?: string;
  bulletPointsZh?: string[];
  bulletPointsEn?: string[];
  weight?: number;
  /** 跨境清关：HS 编码（6–10 位数字，各国海关通用前 6 位） */
  hsCode?: string;
  /** 原产国 ISO 代码，影响关税优惠 */
  originCountry?: string;
  /** 报关英文品名（与展示标题分开：报关有格式要求） */
  customsNameEn?: string;
  /** 报关材质描述 */
  customsMaterialEn?: string;
}

export interface ImportFailure {
  row: number;
  reason: string;
}

export interface ImportProductsResponse {
  successCount: number;
  failCount: number;
  failures: ImportFailure[];
}

export interface UpdateProductRequest {
  sku?: string;
  titleZh?: string;
  titleEn?: string;
  hsCode?: string;
  originCountry?: string;
  customsNameEn?: string;
  customsMaterialEn?: string;
  descZh?: string;
  descEn?: string;
  longDescZh?: string;
  longDescEn?: string;
  categoryId?: string;
  price?: number;
  originalPrice?: number;
  stock?: number;
  status?: 'draft' | 'active' | 'inactive';
  coverImage?: string;
  images?: string[];
  specs?: ProductSpec;
  seoKeywordsZh?: string;
  seoKeywordsEn?: string;
  bulletPointsZh?: string[];
  bulletPointsEn?: string[];
  weight?: number;
}

export interface CartItem {
  id: string;
  productId: string;
  variantId?: string;
  variantInfo?: string;
  variantImage?: string;
  product: Product;
  quantity: number;
}

export interface CartResponse {
  items: CartItem[];
  subtotal: string;
  total: string;
  itemCount: number;
}

export interface AddCartRequest {
  productId: string;
  variantId?: string;
  quantity: number;
}

export interface UpdateCartRequest {
  quantity: number;
}

export interface CartRecoveryCodeResponse {
  code: string;
}

export interface CartImportCodeRequest {
  code: string;
}

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded'
  | 'partially_refunded';

export interface OrderItem {
  id: string;
  productId?: string;
  variantId?: string;
  productTitle: string;
  variantInfo?: string;
  productSku?: string;
  productImage?: string;
  unitPrice: string;
  quantity: number;
  subtotal: string;
}

export interface OrderFulfillment {
  carrier?: string;
  trackingNumber?: string;
}

export interface Order {
  id: string;
  orderNo: string;
  userId?: string;
  buyerName: string;
  buyerEmail?: string;
  buyerPhone?: string;
  shippingAddress: string;
  shippingCity: string;
  shippingZip?: string;
  shippingCountry: string;
  subtotal?: string;
  shippingFee?: string;
  discountAmount?: string;
  taxAmount?: string;
  totalAmount: string;
  /** 订单币种 */
  currency?: string;
  /** 下单时汇率：1 USD = exchangeRate 该币种 */
  exchangeRate?: string;
  /** 折算 USD 总额，供跨币种统计 */
  baseTotalAmount?: string;
  status: OrderStatus;
  paymentMethod: string;
  couponId?: string;
  couponCode?: string;
  paidAt?: string;
  shippedAt?: string;
  deliveredAt?: string;
  trackingNumber?: string;
  customerNote?: string;
  items: OrderItem[];
  fulfillments: OrderFulfillment[];
  createdAt: string;
  updatedAt: string;
}

/** 结账页税额预估（与下单同源，保证前后一致） */
export interface TaxBreakdownItem {
  kind: 'duty' | 'vat';
  base: string;
  rate: number;
  amount: string;
  label: string;
}

export interface TaxQuote {
  total: string;
  breakdown: TaxBreakdownItem[];
  status: 'known' | 'unknown';
  deMinimisApplied: boolean;
  note: string;
}

export interface CreateOrderRequest {
  buyerName: string;
  buyerEmail?: string;
  buyerPhone?: string;
  shippingAddress: string;
  shippingCity: string;
  shippingZip?: string;
  shippingCountry: string;
  paymentMethod: PaymentProvider;
  customerNote?: string;
  remark?: string; // @deprecated use customerNote
  couponCode?: string;
  /**
   * 下单幂等键（建议由前端在进入结算页时生成 UUID）。
   * 同一键重复提交只产生一张订单：双击、超时重试、网关重放都安全。
   */
  idempotencyKey?: string;
  /** 下单币种（ISO 4217）。不传则 USD。服务端按快照汇率折算并落库 */
  currency?: string;
  items: { productId: string; variantId?: string; quantity: number }[];
}

export interface OrderListParams {
  page?: number;
  pageSize?: number;
  status?: OrderStatus;
  keyword?: string;
}

export interface OrderListResponse {
  items: Order[];
  total: number;
  page: number;
  pageSize: number;
}

export interface OrderStatusUpdateRequest {
  status: OrderStatus;
  trackingNumber?: string;
  carrier?: string;
}

export interface InquiryMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'seller';
  content: string;
  createdAt: string;
}

export interface InquirySession {
  id: string;
  sessionId: string;
  userId?: string;
  /** Display name of the buyer, so the seller list never shows a UUID. */
  userName?: string;
  status: 'active' | 'closed';
  lastMessage?: string;
  lastMessageAt?: string;
  createdAt: string;
}

export interface SendMessageRequest {
  sessionId: string;
  content: string;
  role: 'user' | 'seller';
}

export interface DashboardStats {
  gmv: string;
  orderCount: number;
  visitorCount: number;
  productCount: number;
  todayGmv: string;
  todayOrders: number;
  pendingOrders: number;
}

export interface SalesTrendItem {
  date: string;
  amount: number;
  orders: number;
}

export interface CategorySalesItem {
  name: string;
  amount: number;
  percentage: number;
}

export interface DashboardData {
  stats: DashboardStats;
  salesTrend: SalesTrendItem[];
  categorySales: CategorySalesItem[];
}

export interface AICopywriterRequest {
  productNameZh?: string;
  specs?: string;
  category?: string;
  targetMarket?: string;
}

export interface AICopywriterResponse {
  titleEn: string;
  bulletPoints: string[];
  longDescription: string;
  seoKeywords: string;
}

export interface AITranslationRequest {
  text: string;
  sourceLang?: string;
  targetLang: string;
}

export interface AITranslationResponse {
  translatedText: string;
}

export interface AITrendReport {
  id: string;
  reportType: string;
  title: string;
  content: string;
  status: string;
  createdAt: string;
}

// ==================== AI 模型设置与自定义 Agent ====================

export type AiConfigSource = 'db' | 'env' | 'none';

export interface AiSettingsView {
  configured: boolean;
  source: AiConfigSource;
  baseUrl: string;
  model: string;
  /** UI 中保存的 Key 掩码（环境变量来源的 Key 不回显） */
  apiKeyMasked: string | null;
}

export interface AiSettingsTestResult {
  ok: boolean;
  model?: string;
  message: string;
}

export interface BuiltinAgentMeta {
  key: string;
  name: string;
  description: string;
  usesModel: string;
}

export interface CustomAgent {
  id: string;
  slug: string;
  name: string;
  description: string;
  systemPrompt: string;
  userPromptTemplate: string;
  responseFormat: 'text' | 'json';
  temperature: number;
  maxTokens: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentListResult {
  builtin: BuiltinAgentMeta[];
  custom: CustomAgent[];
}

export interface RunAgentResult {
  content: string;
  parsed?: unknown;
}

export interface UpdateAiSettingsRequest {
  /** 传空字符串清除 UI 中保存的值（回退环境变量/未配置） */
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export interface CreateAgentRequest {
  name: string;
  slug?: string;
  description?: string;
  systemPrompt: string;
  userPromptTemplate?: string;
  responseFormat?: 'text' | 'json';
  temperature?: number;
  maxTokens?: number;
  enabled?: boolean;
}

export type UpdateAgentRequest = Partial<Omit<CreateAgentRequest, 'slug'>>;

/** AI 报告历史（落库回看） */
export interface AIReportSummary {
  id: string;
  reportType: string;
  title: string;
  model?: string;
  createdAt: string;
}

export interface AIReportDetail extends AIReportSummary {
  content: string;
}

export interface AISelectItem {
  keyword: string;
  estimatedDemand: string;
  suggestedPriceRange: string;
  reason: string;
  confidence: number;
}

export interface AISelectResponse {
  items: AISelectItem[];
}

export interface AIStatusResponse {
  configured: boolean;
  model?: string;
  /** 配置来源：db=UI 设置，env=环境变量，none=未配置 */
  source?: 'db' | 'env' | 'none';
}

export interface AIUsageAgentStat {
  agent: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** 该 Agent 的累计成本（USD）。null = 模型未收录价目 */
  costUsd: string | null;
  durationMs: number;
}

export interface AIUsageStats {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  /** 命中提示缓存的输入 token */
  totalCachedInputTokens: number;
  /** 累计成本（USD）。null = 模型未收录价目，不是 0 */
  totalCostUsd: string | null;
  totalDurationMs: number;
  successRate: number;
  byAgent: AIUsageAgentStat[];
}

export interface AIUsageStatsQuery {
  agent?: string;
  startDate?: string;
  endDate?: string;
}

// ==================== AI 运营副驾（工具调用 Agent + 人工审批） ====================

export type CopilotToolKind = 'read' | 'write';

export type CopilotActionStatus = 'pending' | 'processing' | 'executed' | 'rejected' | 'failed';

export interface CopilotMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** 工具消息：工具名与参数（便于卖家核对 Agent 读了什么、做了什么） */
  toolName?: string;
  toolArgs?: string;
  toolOk?: boolean;
  /** 助手消息关联的待审批动作 */
  actionId?: string;
  createdAt: string;
}

export interface CopilotAction {
  id: string;
  conversationId: string;
  toolName: string;
  kind: CopilotToolKind;
  summary: string;
  args: Record<string, unknown>;
  status: CopilotActionStatus;
  /** 同一轮生成的多步动作共享批次号；有值时可整批批准/拒绝 */
  batchId?: string;
  result?: string;
  errorMessage?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface CopilotBatchResolveResult {
  actions: CopilotAction[];
  ok: boolean;
  message: string;
}

export interface CopilotConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pendingActionCount?: number;
}

export interface CopilotConversationDetail {
  conversation: CopilotConversation;
  messages: CopilotMessage[];
  actions: CopilotAction[];
}

export interface CopilotSendResult {
  conversationId: string;
  reply: string;
  messages: CopilotMessage[];
  actions: CopilotAction[];
  /** 本轮命中的工具（按执行顺序） */
  toolTrace: Array<{ tool: string; kind: CopilotToolKind; ok: boolean }>;
}

export interface CopilotActionResolveResult {
  action: CopilotAction;
  ok: boolean;
  message: string;
}

export interface CopilotToolsView {
  tools: Array<{
    name: string;
    description: string;
    kind: CopilotToolKind;
    /** 风险等级由服务端唯一声明，前端据此渲染审批卡，不再自建映射表 */
    risk: 'low' | 'medium' | 'high';
    /** 是否不可逆（资金/对外动作），UI 需二次确认 */
    irreversible: boolean;
    labelZh: string;
    labelEn: string;
    /** JSON Schema，供 MCP / 开放 API 复用 */
    inputSchema: Record<string, unknown>;
    params: Array<{ name: string; type: string; required: boolean; description: string }>;
  }>;
}

// ==================== AI 运营副驾 · 店铺巡检 ====================

export type CopilotInsightType =
  | 'low_stock'
  | 'stale_refund'
  | 'unpaid_order'
  | 'stale_shipment';

export interface CopilotInsight {
  id: string;
  type: CopilotInsightType;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  suggestion: string;
  /** 可一键发给副驾的指令 */
  prompt: string;
  entityId?: string;
}

// ==================== AI 导购 · 转化漏斗 ====================

export type ShopperFunnelStageKey = 'viewed' | 'recommended' | 'cart_confirmed' | 'ordered';

export interface ShopperFunnelStage {
  stage: ShopperFunnelStageKey;
  label: string;
  /** 该阶段去重会话数 */
  sessions: number;
  /** 相对上一阶段的转化率（0-1，两位小数） */
  conversionFromPrevious: number;
}

export interface ShopperTopQuery {
  keyword: string;
  count: number;
}

export interface ShopperProductFunnelItem {
  productId: string;
  title: string;
  /** 被推荐次数（出现在搜索/详情结果中的会话数） */
  recommendedSessions: number;
  /** 确认加购的会话数 */
  cartSessions: number;
  /** 加购转化率 = cartSessions / recommendedSessions */
  cartRate: number;
  /** 加购后下单的会话数 */
  orderedSessions: number;
  /** 库存与价格，便于定位"推荐了但没人买"的原因 */
  totalStock: number;
  minPrice: string;
  avgRating: number;
}

export interface ShopperProductFunnelResponse {
  since: string;
  days: number;
  items: ShopperProductFunnelItem[];
}

export interface ShopperDemandGap {
  keyword: string;
  /** 该词零结果的搜索次数 */
  misses: number;
  /** 涉及的去重会话数 */
  sessions: number;
  lastSeenAt: string;
}

export interface ShopperFunnelResponse {
  since: string;
  days: number;
  stages: ShopperFunnelStage[];
  /** 打开导购 → 完成下单 的整体转化率 */
  overallConversion: number;
  topQueries: ShopperTopQuery[];
}

export interface CopilotInsightThresholds {
  /** 总库存低于该值视为低库存 */
  lowStock: number;
  /** 退款申请超过该小时数未处理视为超时 */
  pendingRefundHours: number;
  /** 订单创建超过该小时数未支付视为超时 */
  unpaidOrderHours: number;
  /** 发货超过该天数未签收视为异常 */
  staleShippedDays: number;
}

export interface CopilotInsightsView {
  generatedAt: string;
  thresholds: CopilotInsightThresholds;
  insights: CopilotInsight[];
}

export interface UpdateCopilotInsightThresholdsRequest {
  lowStock?: number;
  pendingRefundHours?: number;
  unpaidOrderHours?: number;
  staleShippedDays?: number;
}

export type PaymentProvider = 'stripe' | 'paypal' | 'demo';
export type PaymentStatus = 'pending' | 'paid' | 'refunded' | 'failed';

export interface Payment {
  id: string;
  orderId: string;
  provider: PaymentProvider;
  amount: string;
  currency: string;
  status: PaymentStatus;
  transactionId?: string;
  createdAt: string;
}

export interface PayRequest {
  orderId: string;
  provider: PaymentProvider;
}

export interface PayResponse {
  success: boolean;
  payment?: Payment;
  order?: Order;
  message?: string;
  demoMode?: boolean;
  /** Stripe Checkout 托管支付页地址（有值时前端应跳转） */
  checkoutUrl?: string;
  /** PayPal 授权链接（有值时前端应跳转） */
  approveUrl?: string;
  /** Stripe PaymentIntent client_secret（前端用 Stripe.js 确认支付） */
  clientSecret?: string;
  /** 支付状态：paid=已入账；pending=已创建支付单，等待渠道回调确认 */
  paymentStatus?: 'paid' | 'pending';
}

export interface ProductReview {
  id: string;
  productId: string;
  userId: string;
  userName: string;
  rating: number;
  comment?: string;
  /** 评价图片 URL 列表 */
  images?: string[];
  sellerReply?: string;
  verifiedPurchase?: boolean;
  helpfulCount?: number;
  createdAt: string;
}

export interface ProductReviewsResponse {
  items: ProductReview[];
  averageRating: number;
  totalCount: number;
}

export interface CreateReviewRequest {
  rating: number;
  comment?: string;
  /** 最多 6 张图片 URL */
  images?: string[];
}

export interface Favorite {
  id: string;
  userId: string;
  productId: string;
  createdAt: string;
}

export interface FavoriteProduct {
  id: string;
  productId: string;
  product: Product;
  createdAt: string;
}

export type CouponType = 'percent' | 'fixed' | 'free_shipping';

export interface Coupon {
  id: string;
  code: string;
  type: CouponType;
  value: string;
  minOrderAmount: string;
  appliesTo?: string;
  appliesToIds?: string[];
  freeShipping?: boolean;
  perUserLimit?: number;
  totalQuantity: number;
  usedCount: number;
  startsAt?: string;
  expiresAt?: string;
  active: boolean;
  createdAt: string;
}

export interface CreateCouponRequest {
  code: string;
  type: CouponType;
  value?: number;
  minOrderAmount?: number;
  appliesTo?: 'all' | 'category' | 'product';
  appliesToIds?: string[];
  freeShipping?: boolean;
  perUserLimit?: number;
  totalQuantity?: number;
  startsAt?: string;
  expiresAt?: string;
  active?: boolean;
}

export interface UpdateCouponRequest {
  code?: string;
  type?: CouponType;
  value?: number;
  minOrderAmount?: number;
  appliesTo?: 'all' | 'category' | 'product';
  appliesToIds?: string[];
  freeShipping?: boolean;
  perUserLimit?: number;
  totalQuantity?: number;
  startsAt?: string;
  expiresAt?: string;
  active?: boolean;
}

export interface CouponListParams {
  page?: number;
  pageSize?: number;
}

export interface CouponListResponse {
  items: Coupon[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ValidateCouponRequest {
  code: string;
  orderAmount: number;
}

export interface ValidateCouponResponse {
  valid: boolean;
  coupon?: Coupon;
  discountAmount: number;
  finalAmount: number;
  message?: string;
}

export interface SupportChatRequest {
  sessionId: string;
  message: string;
  language?: Language;
  orderNo?: string;
}

export interface SupportChatResponse {
  reply: string;
  sources?: string[];
}

export type LogisticsStatus =
  | 'ordered'
  | 'paid'
  | 'shipped'
  | 'in_transit'
  | 'delivered';

export interface LogisticsEvent {
  status: LogisticsStatus;
  description: string;
  location?: string;
  time: string;
}

export interface LogisticsTracking {
  orderId: string;
  carrier?: string;
  trackingNumber?: string;
  events: LogisticsEvent[];
  isDemo: boolean;
}

export interface CreateLogisticsRequest {
  orderId: string;
  carrier: string;
  trackingNumber: string;
}

export interface AuditLog {
  id: string;
  userId?: string;
  role?: string;
  action: string;
  entity?: string;
  entityId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ip?: string;
  createdAt: string;
}

export interface AuditLogListResponse {
  items: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuditLogQuery {
  page?: number;
  pageSize?: number;
  action?: string;
  startDate?: string;
  endDate?: string;
}

// ========== Refund ==========

export interface Refund {
  id: string;
  orderId: string;
  /** Human-readable order number (e.g. ORD20261103...). Absent only if the order row is gone. */
  orderNo?: string;
  userId: string;
  refundNo: string;
  status: 'requested' | 'approved' | 'rejected' | 'completed';
  amount: string;
  reason: string;
  reasonDetail?: string;
  items?: string;
  sellerReply?: string;
  refundMethod: string;
  approvedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RefundListParams {
  page?: number;
  pageSize?: number;
  status?: Refund['status'];
  /** 退款单号 / 订单 ID 模糊搜索（卖家端） */
  keyword?: string;
}

export interface RefundListResponse {
  items: Refund[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateRefundRequest {
  orderId: string;
  amount: number;
  reason: string;
  reasonDetail?: string;
  items?: string[];
  refundMethod?: string;
}

export interface RefundActionRequest {
  reply?: string;
}

// ========== Shipping Template ==========

export interface ShippingRule {
  countries: string[];
  firstWeight: string;
  firstWeightFee: string;
  additionalWeight: string;
  additionalWeightFee: string;
}

/**
 * Mirrors the `shipping_templates` table. Rates are a flat first-unit fee plus
 * a per-additional-unit fee; `specialZones` is a JSON string of
 * `[{ countries: string[], extraFee: string }]`.
 */
export interface ShippingTemplate {
  id: string;
  sellerId: string;
  name: string;
  freeShippingThreshold: string;
  baseFee: string;
  extraFeePerUnit: string;
  unitType: 'weight' | 'quantity';
  specialZones?: string | null;
  isDefault: boolean;
  createdAt: string;
}

export interface CreateShippingTemplateRequest {
  name: string;
  baseFee?: string;
  extraFeePerUnit?: string;
  unitType?: 'weight' | 'quantity';
  freeShippingThreshold?: string;
  specialZones?: string;
  isDefault?: boolean;
}

export interface UpdateShippingTemplateRequest {
  name?: string;
  baseFee?: string;
  extraFeePerUnit?: string;
  unitType?: 'weight' | 'quantity';
  freeShippingThreshold?: string;
  specialZones?: string;
  isDefault?: boolean;
}

export interface ShippingCalculateRequest {
  sellerId?: string;
  templateId?: string;
  country?: string;
  weightTotal?: number;
  qtyTotal?: number;
  subtotal?: number;
}

export interface ShippingCalculateResponse {
  fee: string;
  isFree: boolean;
  templateName?: string;
  currency: string;
}

// ========== Collection ==========

export interface Collection {
  id: string;
  sellerId: string;
  titleZh: string;
  titleEn: string;
  slug: string;
  descriptionZh?: string;
  descriptionEn?: string;
  coverImage?: string;
  isSmart?: boolean;
  smartRules?: string | null;
  productIds?: string[];
  productCount: number;
  sortOrder: number;
  isFeatured: boolean;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface StorefrontSection {
  id: string;
  slug: string;
  titleZh: string;
  titleEn: string;
  descriptionZh?: string;
  descriptionEn?: string;
  coverImage?: string;
  products: Product[];
}

export interface CreateCollectionRequest {
  titleZh: string;
  titleEn: string;
  slug?: string;
  descriptionZh?: string;
  descriptionEn?: string;
  coverImage?: string;
  isSmart?: boolean;
  smartRules?: Array<{ field: string; operator: string; value: string | number }>;
  productIds?: string[];
  sortOrder?: number;
  isFeatured?: boolean;
  status?: 'active' | 'inactive';
}

export interface UpdateCollectionRequest {
  titleZh?: string;
  titleEn?: string;
  slug?: string;
  descriptionZh?: string;
  descriptionEn?: string;
  coverImage?: string;
  isSmart?: boolean;
  smartRules?: Array<{ field: string; operator: string; value: string | number }>;
  productIds?: string[];
  sortOrder?: number;
  isFeatured?: boolean;
  status?: 'active' | 'inactive';
}

export interface CollectionProductRequest {
  productId: string;
}

export interface CollectionReorderRequest {
  productIds: string[];
}

export interface CollectionListResponse {
  items: Collection[];
  total: number;
  page: number;
  pageSize: number;
}

// ========== CMS Page ==========

export interface CmsPage {
  id: string;
  slug: string;
  titleZh: string;
  titleEn: string;
  contentZh: string;
  contentEn: string;
  metaTitleZh?: string;
  metaTitleEn?: string;
  metaDescZh?: string;
  metaDescEn?: string;
  isPublished: boolean;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCmsPageRequest {
  slug: string;
  titleZh: string;
  titleEn: string;
  contentZh?: string;
  contentEn?: string;
  metaTitleZh?: string;
  metaTitleEn?: string;
  metaDescZh?: string;
  metaDescEn?: string;
  isPublished?: boolean;
}

export interface UpdateCmsPageRequest {
  slug?: string;
  titleZh?: string;
  titleEn?: string;
  contentZh?: string;
  contentEn?: string;
  metaTitleZh?: string;
  metaTitleEn?: string;
  metaDescZh?: string;
  metaDescEn?: string;
  isPublished?: boolean;
}

export interface CmsPageListParams {
  page?: number;
  pageSize?: number;
  /** 'published' | 'draft'（映射到 is_published） */
  status?: 'published' | 'draft';
  keyword?: string;
}

export interface CmsPageListResponse {
  items: CmsPage[];
  total: number;
  page: number;
  pageSize: number;
}

// ========== Address ==========

export interface Address {
  id: string;
  userId: string;
  label?: string;
  receiverName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state?: string;
  zipCode?: string;
  country: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAddressRequest {
  label?: string;
  receiverName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state?: string;
  zipCode?: string;
  country: string;
  isDefault?: boolean;
}

export interface UpdateAddressRequest {
  label?: string;
  receiverName?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  isDefault?: boolean;
}

export interface AddressListResponse {
  items: Address[];
  total: number;
}

// ==================== 跨境：多币种 / 清关 / 结算 ====================

export interface FxRateItem {
  code: string;
  symbol: string;
  nameZh: string;
  nameEn: string;
  /** 1 USD = rate 个该币种 */
  rate: number;
  decimalDigits: number;
  updatedAt: string | null;
  /** remote=汇率源拉取 / manual=人工设置 / builtin=内置初值 */
  source: string;
}

export interface FxRateList {
  base: string;
  rates: FxRateItem[];
}

export interface FxConversion {
  from: string;
  to: string;
  amount: string;
  converted: string;
  rate: number;
}

export interface CustomsLineItem {
  sku: string;
  hsCode: string | null;
  description: string;
  quantity: number;
  unitValue: string;
  totalValue: string;
  originCountry: string | null;
  weightKg: number | null;
  warnings: string[];
}

export interface CustomsDeclaration {
  id: string;
  declarationNo: string;
  orderId: string;
  orderNo: string;
  status: string;
  destinationCountry: string;
  originCountry: string;
  declaredValue: string;
  declaredCurrency: string;
  declaredValueUsd: string;
  lineItems: CustomsLineItem[];
  note?: string;
  generatedAt: string;
  filedAt?: string;
  warnings: string[];
}

export interface SettlementLine {
  orderNo: string;
  paidAt: string | null;
  gross: string;
  refund: string;
  commission: string;
  net: string;
}

export interface Settlement {
  id: string;
  settlementNo: string;
  sellerId: string;
  status: 'pending' | 'paid' | 'cancelled' | string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  grossAmount: string;
  refundAmount: string;
  commissionAmount: string;
  netAmount: string;
  orderCount: number;
  refundCount: number;
  commissionRate: string;
  fixedFeeTotal: string;
  lineItems: SettlementLine[];
  note?: string;
  paidAt?: string;
  createdAt: string;
}

export interface SettlementSummary {
  pendingAmount: string;
  paidAmount: string;
  pendingCount: number;
  lastSettlementAt: string | null;
}

export interface CommissionRule {
  sellerId: string | null;
  rate: string;
  fixedFee: string;
  fixedFeeCurrency: string;
  note?: string;
}

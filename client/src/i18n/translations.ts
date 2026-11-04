import type { Language } from '@shared/api.interface';

export interface Translations {
  nav: {
    home: string;
    products: string;
    cart: string;
    orders: string;
    favorites: string;
    sellerCenter: string;
    searchPlaceholder: string;
    language: string;
    points: string;
  };
  home: {
    heroTitle: string;
    heroSubtitle: string;
    shopNow: string;
    hotProducts: string;
    newArrivals: string;
    categories: string;
    viewAll: string;
    featuredCollection: string;
    hotSubtitle: string;
    newSubtitle: string;
    recentSubtitle: string;
  };
  product: {
    addToCart: string;
    buyNow: string;
    price: string;
    originalPrice: string;
    stock: string;
    sold: string;
    specs: string;
    description: string;
    bulletPoints: string;
    quantity: string;
    inStock: string;
    outOfStock: string;
    reviews: string;
    reviewTitle: string;
    averageRating: string;
    reviewCount: string;
    writeReview: string;
    yourReview: string;
    reviewPlaceholder: string;
    submitReview: string;
    reviewSubmitted: string;
    noReviews: string;
    loginToReview: string;
    alreadyReviewed: string;
    addToFavorites: string;
    removeFromFavorites: string;
    favorites: string;
  };
  cart: {
    title: string;
    empty: string;
    subtotal: string;
    total: string;
    checkout: string;
    quantity: string;
    remove: string;
    itemsCount: string;
    continueShopping: string;
    coupon: string;
    couponCode: string;
    applyCoupon: string;
    couponApplied: string;
    couponInvalid: string;
    discount: string;
    finalTotal: string;
    shipping: string;
    removeCoupon: string;
    minOrderNotMet: string;
    crossDevice: string;
    exportCode: string;
    importCode: string;
    exportCodeDesc: string;
    importCodeDesc: string;
    generateCode: string;
    confirmImport: string;
    recoveryCode: string;
    codeCopied: string;
    codeExpiryNote: string;
    importSuccess: string;
    codePlaceholder: string;
  };
  checkout: {
    title: string;
    shippingInfo: string;
    name: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    zip: string;
    country: string;
    paymentMethod: string;
    placeOrder: string;
    demoPaymentNote: string;
    orderSummary: string;
    remark: string;
    backToCart: string;
  };
    orders: {
      title: string;
      orderNo: string;
      status: string;
      amount: string;
      date: string;
      viewDetail: string;
      tracking: string;
      payNow: string;
      paymentSuccess: string;
      paymentPending: string;
      writeReview: string;
      statusTimeline: string;
      empty: string;
      shippingInfo: string;
      items: string;
      paymentMethod: string;
      logistics: string;
      logisticsTracking: string;
      inTransit: string;
      demoLogisticsNote: string;
      carrier: string;
      trackingNumber: string;
      requestRefund: string;
      refundSubmitted: string;
    };
  common: {
    loading: string;
    error: string;
    back: string;
    submit: string;
    cancel: string;
    save: string;
    search: string;
    sortBy: string;
    newest: string;
    priceAsc: string;
    priceDesc: string;
    bestSelling: string;
    allCategories: string;
    priceRange: string;
    minPrice: string;
    maxPrice: string;
    apply: string;
    results: string;
    noResults: string;
    lastUpdated: string;
  };
  status: {
    pending_payment: string;
    paid: string;
    shipped: string;
    delivered: string;
    cancelled: string;
    refunded: string;
    partially_refunded: string;
  };
  chat: {
    title: string;
    placeholder: string;
    send: string;
    typing: string;
    welcome: string;
    unavailable: string;
  };
  address: {
    title: string;
    add: string;
    addNew: string;
    empty: string;
    emptyHint: string;
    default: string;
    setDefault: string;
    edit: string;
    delete: string;
    label: string;
    labelHome: string;
    labelOffice: string;
    labelOther: string;
    receiver: string;
    receiverPlaceholder: string;
    phone: string;
    phonePlaceholder: string;
    detail: string;
    detailPlaceholder: string;
    detail2: string;
    detail2Placeholder: string;
    city: string;
    cityPlaceholder: string;
    state: string;
    statePlaceholder: string;
    zip: string;
    zipPlaceholder: string;
    country: string;
    countryPlaceholder: string;
    setAsDefault: string;
    create: string;
    loadFailed: string;
    deleteFailed: string;
    setDefaultFailed: string;
    createFailed: string;
    updateFailed: string;
    deleted: string;
    updated: string;
    created: string;
    defaultSet: string;
    deleteConfirm: string;
    needReceiver: string;
    needPhone: string;
    needDetail: string;
    needCity: string;
    needCountry: string;
  };
  auth: {
    signIn: string;
    signUp: string;
    email: string;
    password: string;
    name: string;
    namePlaceholder: string;
    confirmPassword: string;
    welcomeBack: string;
    loginSubtitle: string;
    createAccount: string;
    registerSubtitle: string;
    noAccount: string;
    haveAccount: string;
    logout: string;
    loginToContinue: string;
    sellerAccessDenied: string;
    sellerAccessDeniedDesc: string;
    backToHome: string;
    googleSignIn: string;
    googleComingSoon: string;
  };
  favorites: {
    title: string;
    empty: string;
    browseProducts: string;
    remove: string;
  };
    seller: {
      coupons: string;
      couponManagement: string;
      createCoupon: string;
      editCoupon: string;
      couponCode: string;
      couponType: string;
      couponValue: string;
      minOrderAmount: string;
      usageLimit: string;
      expiresAt: string;
      status: string;
      active: string;
      inactive: string;
      percent: string;
      fixed: string;
      usedCount: string;
      actions: string;
      enable: string;
      disable: string;
      edit: string;
      save: string;
      cancel: string;
      createdAt: string;
      bulkImport: string;
      importProducts: string;
      uploadCsv: string;
      dragDropCsv: string;
      orClickToSelect: string;
      downloadTemplate: string;
      importInProgress: string;
      importResult: string;
      successCount: string;
      failCount: string;
      failureDetails: string;
      importCompleted: string;
      importFailed: string;
      row: string;
      reason: string;
      selectCarrier: string;
      enterTrackingNumber: string;
      confirmShip: string;
    };
}

export const translations: Record<Language, Translations> = {
  zh: {
    nav: {
      home: '首页',
      products: '商品',
      cart: '购物车',
      orders: '我的订单',
      favorites: '我的收藏',
      sellerCenter: '卖家中心',
      searchPlaceholder: '搜索商品...',
      language: '语言',
      points: '积分',
    },
    home: {
      heroTitle: '发现全球好物',
      heroSubtitle: '精选优质商品，一站直达全球买家',
      shopNow: '立即选购',
      hotProducts: '热销商品',
      newArrivals: '新品上架',
      categories: '商品分类',
      viewAll: '查看全部',
      featuredCollection: '精选集合',
      // 分区副标题：给每个分区一句「为什么值得看」，而不是只给标题
      hotSubtitle: '按近 30 天真实成交排序，不含广告位',
      newSubtitle: '本周上新，先看再决定',
      recentSubtitle: '你最近打开过的商品',
    },
    product: {
      addToCart: '加入购物车',
      buyNow: '立即购买',
      price: '价格',
      originalPrice: '原价',
      stock: '库存',
      sold: '已售',
      specs: '规格参数',
      description: '商品描述',
      bulletPoints: '产品亮点',
      quantity: '数量',
      inStock: '有货',
      outOfStock: '缺货',
      reviews: '用户评价',
      reviewTitle: '用户评价',
      averageRating: '平均评分',
      reviewCount: '条评价',
      writeReview: '写评价',
      yourReview: '我的评价',
      reviewPlaceholder: '分享您的使用体验...',
      submitReview: '提交评价',
      reviewSubmitted: '评价提交成功',
      noReviews: '暂无评价，成为第一个评价的人吧',
      loginToReview: '请先登录后评价',
      alreadyReviewed: '你已评价该商品',
      addToFavorites: '收藏',
      removeFromFavorites: '取消收藏',
      favorites: '收藏',
    },
    cart: {
      title: '购物车',
      empty: '购物车是空的',
      subtotal: '小计',
      total: '合计',
      checkout: '去结算',
      quantity: '数量',
      remove: '删除',
      itemsCount: '件商品',
      continueShopping: '继续购物',
      coupon: '优惠券',
      couponCode: '优惠码',
      applyCoupon: '应用',
      couponApplied: '优惠已应用',
      couponInvalid: '优惠码无效',
      discount: '优惠',
      finalTotal: '应付金额',
      shipping: '运费',
      removeCoupon: '取消',
      minOrderNotMet: '未达到最低消费金额',
      crossDevice: '跨设备迁移',
      exportCode: '导出恢复码',
      importCode: '导入恢复码',
      exportCodeDesc: '生成恢复码，在其他设备上导入即可同步购物车',
      importCodeDesc: '输入恢复码，将其他设备的购物车合并到当前设备',
      generateCode: '生成恢复码',
      confirmImport: '确认导入',
      recoveryCode: '恢复码',
      codeCopied: '已复制到剪贴板',
      codeExpiryNote: '24小时内有效，一次性使用',
      importSuccess: '购物车已成功合并',
      codePlaceholder: '请输入12位恢复码',
    },
    checkout: {
      title: '结算',
      shippingInfo: '收货信息',
      name: '姓名',
      email: '邮箱',
      phone: '电话',
      address: '详细地址',
      city: '城市',
      zip: '邮编',
      country: '国家',
      paymentMethod: '支付方式',
      placeOrder: '提交订单',
      demoPaymentNote: '演示支付（无需真实扣款）',
      orderSummary: '订单摘要',
      remark: '备注',
      backToCart: '返回购物车',
    },
    orders: {
      title: '我的订单',
      orderNo: '订单号',
      status: '状态',
      amount: '金额',
      date: '下单时间',
      viewDetail: '查看详情',
      tracking: '物流跟踪',
      payNow: '去支付',
      paymentSuccess: '支付成功',
      paymentPending: '支付已创建，等待渠道确认',
      writeReview: '去评价',
      statusTimeline: '订单进度',
      empty: '暂无订单',
      shippingInfo: '收货信息',
      items: '商品明细',
      paymentMethod: '支付方式',
      logistics: '物流',
      logisticsTracking: '物流轨迹',
      inTransit: '运输中',
      demoLogisticsNote: '演示物流轨迹 — 配置 17TRACK_API_KEY 后接入真实物流',
      carrier: '承运商',
      trackingNumber: '运单号',
      requestRefund: '申请退款',
      refundSubmitted: '退款申请已提交，请等待卖家处理',
    },
    common: {
      loading: '加载中...',
      error: '加载失败',
      back: '返回',
      submit: '提交',
      cancel: '取消',
      save: '保存',
      search: '搜索',
      sortBy: '排序',
      newest: '新品优先',
      priceAsc: '价格从低到高',
      priceDesc: '价格从高到低',
      bestSelling: '销量优先',
      allCategories: '全部分类',
      priceRange: '价格区间',
      minPrice: '最低价',
      maxPrice: '最高价',
      apply: '应用',
      results: '个结果',
      noResults: '没有找到相关商品',
      lastUpdated: '最后更新',
    },
    status: {
      pending_payment: '待付款',
      paid: '已付款',
      shipped: '已发货',
      delivered: '已送达',
      cancelled: '已取消',
      refunded: '已退款',
      partially_refunded: '部分退款',
    },
    chat: {
      title: '智能客服',
      placeholder: '输入您的问题...',
      send: '发送',
      typing: '正在输入...',
      welcome: '您好！我是智能客服，有什么可以帮您的吗？',
      unavailable: '智能客服暂未开放',
    },
    address: {
      title: '收货地址',
      add: '添加地址',
      addNew: '添加新地址',
      empty: '暂无收货地址',
      emptyHint: '添加收货地址，下单时快速选择',
      default: '默认',
      setDefault: '设为默认',
      edit: '编辑',
      delete: '删除',
      label: '地址标签',
      labelHome: '家',
      labelOffice: '公司',
      labelOther: '其他',
      receiver: '收件人 *',
      receiverPlaceholder: '收件人姓名',
      phone: '联系电话 *',
      phonePlaceholder: '电话号码',
      detail: '详细地址 *',
      detailPlaceholder: '街道、门牌号等',
      detail2: '地址补充',
      detail2Placeholder: '公寓、楼层等（选填）',
      city: '城市 *',
      cityPlaceholder: '城市',
      state: '州/省',
      statePlaceholder: '州/省（选填）',
      zip: '邮编',
      zipPlaceholder: '邮政编码（选填）',
      country: '国家 *',
      countryPlaceholder: '如：CN, US, UK',
      setAsDefault: '设为默认地址',
      create: '创建',
      loadFailed: '加载地址列表失败',
      deleteFailed: '删除失败',
      setDefaultFailed: '设置失败',
      createFailed: '创建失败',
      updateFailed: '更新失败',
      deleted: '地址已删除',
      updated: '地址更新成功',
      created: '地址创建成功',
      defaultSet: '已设为默认地址',
      deleteConfirm: '确认删除该收货地址？',
      needReceiver: '请输入收件人姓名',
      needPhone: '请输入联系电话',
      needDetail: '请输入详细地址',
      needCity: '请输入城市',
      needCountry: '请输入国家',
    },
    auth: {
      signIn: '登录',
      signUp: '注册',
      email: '邮箱',
      password: '密码',
      name: '姓名',
      namePlaceholder: '您的姓名',
      confirmPassword: '确认密码',
      welcomeBack: '欢迎回来',
      loginSubtitle: '登录您的账户继续购物',
      createAccount: '创建账户',
      registerSubtitle: '创建账户，开始您的购物之旅',
      noAccount: '还没有账户？',
      haveAccount: '已有账户？',
      logout: '退出登录',
      loginToContinue: '请先登录',
      sellerAccessDenied: '无权访问',
      sellerAccessDeniedDesc: '您的账户没有卖家权限，请使用卖家账户登录。',
      backToHome: '返回首页',
      googleSignIn: '使用 Google 登录',
      googleComingSoon: 'Google 登录即将上线',
    },
    favorites: {
      title: '我的收藏',
      empty: '暂无收藏商品',
      browseProducts: '去逛逛',
      remove: '取消收藏',
    },
    seller: {
      coupons: '优惠券管理',
      couponManagement: '优惠券管理',
      createCoupon: '新建优惠券',
      editCoupon: '编辑优惠券',
      couponCode: '优惠码',
      couponType: '类型',
      couponValue: '面额',
      minOrderAmount: '最低消费',
      usageLimit: '使用次数上限',
      expiresAt: '过期时间',
      status: '状态',
      active: '启用',
      inactive: '停用',
      percent: '百分比折扣',
      fixed: '立减金额',
      usedCount: '使用进度',
      actions: '操作',
      enable: '启用',
      disable: '停用',
      edit: '编辑',
      save: '保存',
      cancel: '取消',
      createdAt: '创建时间',
      bulkImport: '批量导入',
      importProducts: '批量导入商品',
      uploadCsv: '上传 CSV 文件',
      dragDropCsv: '拖拽 CSV 文件到此处',
      orClickToSelect: '或点击选择文件',
      downloadTemplate: '下载模板',
      importInProgress: '正在导入...',
      importResult: '导入结果',
      successCount: '成功',
      failCount: '失败',
      failureDetails: '失败详情',
      importCompleted: '导入完成',
      importFailed: '导入失败',
      row: '行号',
      reason: '原因',
      selectCarrier: '选择承运商',
      enterTrackingNumber: '输入运单号',
      confirmShip: '确认发货',
    },
  },
  en: {
    nav: {
      home: 'Home',
      products: 'Products',
      cart: 'Cart',
      orders: 'Orders',
      favorites: 'Wishlist',
      sellerCenter: 'Seller Center',
      searchPlaceholder: 'Search products...',
      language: 'Language',
      points: 'Points',
    },
    home: {
      heroTitle: 'Discover Global Goods',
      heroSubtitle: 'Curated premium products, delivered worldwide',
      shopNow: 'Shop Now',
      hotProducts: 'Hot Products',
      newArrivals: 'New Arrivals',
      hotSubtitle: 'Ranked by real sales in the last 30 days — no paid placement',
      newSubtitle: 'Added this week, take your time',
      recentSubtitle: 'Products you opened recently',
      categories: 'Categories',
      viewAll: 'View All',
      featuredCollection: 'Featured Collection',
    },
    product: {
      addToCart: 'Add to Cart',
      buyNow: 'Buy Now',
      price: 'Price',
      originalPrice: 'Original Price',
      stock: 'Stock',
      sold: 'Sold',
      specs: 'Specifications',
      description: 'Description',
      bulletPoints: 'Highlights',
      quantity: 'Quantity',
      inStock: 'In Stock',
      outOfStock: 'Out of Stock',
      reviews: 'Reviews',
      reviewTitle: 'Customer Reviews',
      averageRating: 'Average Rating',
      reviewCount: 'reviews',
      writeReview: 'Write a Review',
      yourReview: 'Your Review',
      reviewPlaceholder: 'Share your experience...',
      submitReview: 'Submit Review',
      reviewSubmitted: 'Review submitted successfully',
      noReviews: 'No reviews yet. Be the first to review!',
      loginToReview: 'Please sign in to review',
      alreadyReviewed: 'You have already reviewed this product',
      addToFavorites: 'Add to Wishlist',
      removeFromFavorites: 'Remove from Wishlist',
      favorites: 'Wishlist',
    },
    cart: {
      title: 'Shopping Cart',
      empty: 'Your cart is empty',
      subtotal: 'Subtotal',
      total: 'Total',
      checkout: 'Checkout',
      quantity: 'Quantity',
      remove: 'Remove',
      itemsCount: 'items',
      continueShopping: 'Continue Shopping',
      coupon: 'Coupon',
      couponCode: 'Coupon Code',
      applyCoupon: 'Apply',
      couponApplied: 'Coupon applied',
      couponInvalid: 'Invalid coupon code',
      discount: 'Discount',
      finalTotal: 'Total Payable',
      shipping: 'Shipping',
      removeCoupon: 'Remove',
      minOrderNotMet: 'Minimum order amount not met',
      crossDevice: 'Cross-Device Sync',
      exportCode: 'Export Code',
      importCode: 'Import Code',
      exportCodeDesc: 'Generate a recovery code to sync your cart on other devices',
      importCodeDesc: 'Enter a recovery code to merge a cart from another device',
      generateCode: 'Generate Code',
      confirmImport: 'Import',
      recoveryCode: 'Recovery Code',
      codeCopied: 'Copied to clipboard',
      codeExpiryNote: 'Valid for 24 hours, one-time use',
      importSuccess: 'Cart successfully merged',
      codePlaceholder: 'Enter 12-character code',
    },
    checkout: {
      title: 'Checkout',
      shippingInfo: 'Shipping Information',
      name: 'Full Name',
      email: 'Email',
      phone: 'Phone',
      address: 'Address',
      city: 'City',
      zip: 'ZIP / Postal Code',
      country: 'Country',
      paymentMethod: 'Payment Method',
      placeOrder: 'Place Order',
      demoPaymentNote: 'Demo Payment (no real charge)',
      orderSummary: 'Order Summary',
      remark: 'Remark',
      backToCart: 'Back to Cart',
    },
    orders: {
      title: 'My Orders',
      orderNo: 'Order No.',
      status: 'Status',
      amount: 'Amount',
      date: 'Order Date',
      viewDetail: 'View Detail',
      tracking: 'Tracking',
      payNow: 'Pay now',
      paymentSuccess: 'Payment successful',
      paymentPending: 'Payment created, awaiting provider confirmation',
      writeReview: 'Write a review',
      statusTimeline: 'Order Progress',
      empty: 'No orders yet',
      shippingInfo: 'Shipping Info',
      items: 'Items',
      paymentMethod: 'Payment Method',
      logistics: 'Logistics',
      logisticsTracking: 'Tracking',
      inTransit: 'In Transit',
      demoLogisticsNote:
        'Demo tracking — configure 17TRACK_API_KEY for real-time logistics',
      carrier: 'Carrier',
      trackingNumber: 'Tracking Number',
      requestRefund: 'Request refund',
      refundSubmitted: 'Refund request submitted, awaiting seller review',
    },
    common: {
      loading: 'Loading...',
      error: 'Failed to load',
      back: 'Back',
      submit: 'Submit',
      cancel: 'Cancel',
      save: 'Save',
      search: 'Search',
      sortBy: 'Sort by',
      newest: 'Newest',
      priceAsc: 'Price: Low to High',
      priceDesc: 'Price: High to Low',
      bestSelling: 'Best Selling',
      allCategories: 'All Categories',
      priceRange: 'Price Range',
      minPrice: 'Min Price',
      maxPrice: 'Max Price',
      apply: 'Apply',
      results: 'results',
      noResults: 'No products found',
      lastUpdated: 'Last updated',
    },
    status: {
      pending_payment: 'Pending Payment',
      paid: 'Paid',
      shipped: 'Shipped',
      delivered: 'Delivered',
      cancelled: 'Cancelled',
      refunded: 'Refunded',
      partially_refunded: 'Partially refunded',
    },
    chat: {
      title: 'AI Support',
      placeholder: 'Type your question...',
      send: 'Send',
      typing: 'Typing...',
      welcome: 'Hello! I am your AI assistant. How can I help you today?',
      unavailable: 'AI support is not available yet',
    },
    address: {
      title: 'Addresses',
      add: 'Add address',
      addNew: 'Add new address',
      empty: 'No addresses yet',
      emptyHint: 'Add an address to check out faster',
      default: 'Default',
      setDefault: 'Set as default',
      edit: 'Edit',
      delete: 'Delete',
      label: 'Label',
      labelHome: 'Home',
      labelOffice: 'Office',
      labelOther: 'Other',
      receiver: 'Recipient *',
      receiverPlaceholder: 'Recipient name',
      phone: 'Phone *',
      phonePlaceholder: 'Phone number',
      detail: 'Street address *',
      detailPlaceholder: 'Street, building number, etc.',
      detail2: 'Address line 2',
      detail2Placeholder: 'Apartment, floor, etc. (optional)',
      city: 'City *',
      cityPlaceholder: 'City',
      state: 'State/Province',
      statePlaceholder: 'State or province (optional)',
      zip: 'Postal code',
      zipPlaceholder: 'Postal code (optional)',
      country: 'Country *',
      countryPlaceholder: 'e.g. US, CN, UK',
      setAsDefault: 'Set as default address',
      create: 'Create',
      loadFailed: 'Failed to load addresses',
      deleteFailed: 'Delete failed',
      setDefaultFailed: 'Failed to set default',
      createFailed: 'Create failed',
      updateFailed: 'Update failed',
      deleted: 'Address deleted',
      updated: 'Address updated',
      created: 'Address created',
      defaultSet: 'Set as default address',
      deleteConfirm: 'Delete this address?',
      needReceiver: 'Please enter the recipient name',
      needPhone: 'Please enter the phone number',
      needDetail: 'Please enter the street address',
      needCity: 'Please enter the city',
      needCountry: 'Please enter the country',
    },
    auth: {
      signIn: 'Sign In',
      signUp: 'Sign Up',
      email: 'Email',
      password: 'Password',
      name: 'Name',
      namePlaceholder: 'Your name',
      confirmPassword: 'Confirm Password',
      welcomeBack: 'Welcome Back',
      loginSubtitle: 'Sign in to your account to continue shopping',
      createAccount: 'Create Account',
      registerSubtitle: 'Create an account to start your shopping journey',
      noAccount: "Don't have an account?",
      haveAccount: 'Already have an account?',
      logout: 'Sign Out',
      loginToContinue: 'Please sign in to continue',
      sellerAccessDenied: 'Access Denied',
      sellerAccessDeniedDesc: 'Your account does not have seller access. Please sign in with a seller account.',
      backToHome: 'Back to Home',
      googleSignIn: 'Sign in with Google',
      googleComingSoon: 'Google Sign-In coming soon',
    },
    favorites: {
      title: 'My Wishlist',
      empty: 'No favorites yet',
      browseProducts: 'Browse Products',
      remove: 'Remove',
    },
    seller: {
      coupons: 'Coupons',
      couponManagement: 'Coupon Management',
      createCoupon: 'Create Coupon',
      editCoupon: 'Edit Coupon',
      couponCode: 'Coupon Code',
      couponType: 'Type',
      couponValue: 'Value',
      minOrderAmount: 'Min Order Amount',
      usageLimit: 'Usage Limit',
      expiresAt: 'Expires At',
      status: 'Status',
      active: 'Active',
      inactive: 'Inactive',
      percent: 'Percentage',
      fixed: 'Fixed Amount',
      usedCount: 'Usage',
      actions: 'Actions',
      enable: 'Enable',
      disable: 'Disable',
      edit: 'Edit',
      save: 'Save',
      cancel: 'Cancel',
      createdAt: 'Created At',
      bulkImport: 'Bulk Import',
      importProducts: 'Import Products',
      uploadCsv: 'Upload CSV File',
      dragDropCsv: 'Drag & drop CSV file here',
      orClickToSelect: 'or click to browse',
      downloadTemplate: 'Download Template',
      importInProgress: 'Importing...',
      importResult: 'Import Result',
      successCount: 'Success',
      failCount: 'Failed',
      failureDetails: 'Failure Details',
      importCompleted: 'Import completed',
      importFailed: 'Import failed',
      row: 'Row',
      reason: 'Reason',
      selectCarrier: 'Select Carrier',
      enterTrackingNumber: 'Enter tracking number',
      confirmShip: 'Confirm Shipment',
    },
  },
  es: {
    nav: {
      home: 'Inicio',
      products: 'Productos',
      cart: 'Carrito',
      orders: 'Mis Pedidos',
      favorites: 'Favoritos',
      sellerCenter: 'Centro de Vendedores',
      searchPlaceholder: 'Buscar productos...',
      language: 'Idioma',
      points: 'Puntos',
    },
    home: {
      heroTitle: 'Descubre productos del mundo',
      heroSubtitle:
        'Productos premium seleccionados, entregados en todo el mundo',
      shopNow: 'Comprar Ahora',
      hotProducts: 'Productos Destacados',
      hotSubtitle: 'Ordenado por ventas reales de los últimos 30 días',
      newSubtitle: 'Añadidos esta semana',
      recentSubtitle: 'Productos que abriste recientemente',
      newArrivals: 'Novedades',
      categories: 'Categorías',
      viewAll: 'Ver Todo',
      featuredCollection: 'Colección Destacada',
    },
    product: {
      addToCart: 'Añadir al Carrito',
      buyNow: 'Comprar Ahora',
      price: 'Precio',
      originalPrice: 'Precio Original',
      stock: 'Stock',
      sold: 'Vendidos',
      specs: 'Especificaciones',
      description: 'Descripción',
      bulletPoints: 'Destacados',
      quantity: 'Cantidad',
      inStock: 'En Stock',
      outOfStock: 'Agotado',
      reviews: 'Reseñas',
      reviewTitle: 'Opiniones de Clientes',
      averageRating: 'Valoración Media',
      reviewCount: 'reseñas',
      writeReview: 'Escribir Reseña',
      yourReview: 'Tu Reseña',
      reviewPlaceholder: 'Comparte tu experiencia...',
      submitReview: 'Enviar Reseña',
      reviewSubmitted: 'Reseña enviada correctamente',
      noReviews: 'Aún no hay reseñas. ¡Sé el primero!',
      loginToReview: 'Inicia sesión para opinar',
      alreadyReviewed: 'Ya has opinado sobre este producto',
      addToFavorites: 'Añadir a Favoritos',
      removeFromFavorites: 'Quitar de Favoritos',
      favorites: 'Favoritos',
    },
    cart: {
      title: 'Carrito de Compras',
      empty: 'Tu carrito está vacío',
      subtotal: 'Subtotal',
      total: 'Total',
      checkout: 'Pagar',
      quantity: 'Cantidad',
      remove: 'Eliminar',
      itemsCount: 'artículos',
      continueShopping: 'Seguir Comprando',
      coupon: 'Cupón',
      couponCode: 'Código de Cupón',
      applyCoupon: 'Aplicar',
      couponApplied: 'Cupón aplicado',
      couponInvalid: 'Código de cupón inválido',
      discount: 'Descuento',
      finalTotal: 'Total a Pagar',
      shipping: 'Envío',
      removeCoupon: 'Quitar',
      minOrderNotMet: 'No se alcanza el pedido mínimo',
      crossDevice: 'Sincronización entre dispositivos',
      exportCode: 'Exportar código',
      importCode: 'Importar código',
      exportCodeDesc: 'Genera un código de recuperación para sincronizar tu carrito',
      importCodeDesc: 'Ingresa un código para fusionar el carrito de otro dispositivo',
      generateCode: 'Generar código',
      confirmImport: 'Importar',
      recoveryCode: 'Código de recuperación',
      codeCopied: 'Copiado al portapapeles',
      codeExpiryNote: 'Válido por 24 horas, un solo uso',
      importSuccess: 'Carrito fusionado con éxito',
      codePlaceholder: 'Ingresa el código de 12 caracteres',
    },
    checkout: {
      title: 'Finalizar Compra',
      shippingInfo: 'Información de Envío',
      name: 'Nombre Completo',
      email: 'Correo Electrónico',
      phone: 'Teléfono',
      address: 'Dirección',
      city: 'Ciudad',
      zip: 'Código Postal',
      country: 'País',
      paymentMethod: 'Método de Pago',
      placeOrder: 'Realizar Pedido',
      demoPaymentNote: 'Pago de demostración (sin cargo real)',
      orderSummary: 'Resumen del Pedido',
      remark: 'Comentario',
      backToCart: 'Volver al Carrito',
    },
    orders: {
      title: 'Mis Pedidos',
      orderNo: 'N.º de Pedido',
      status: 'Estado',
      amount: 'Importe',
      date: 'Fecha del Pedido',
      viewDetail: 'Ver Detalle',
      tracking: 'Seguimiento',
      payNow: 'Pagar ahora',
      paymentSuccess: 'Pago exitoso',
      paymentPending: 'Pago creado, esperando confirmación',
      writeReview: 'Escribir reseña',
      statusTimeline: 'Progreso del Pedido',
      empty: 'Aún no hay pedidos',
      shippingInfo: 'Datos de Envío',
      items: 'Artículos',
      paymentMethod: 'Método de Pago',
      logistics: 'Logística',
      logisticsTracking: 'Seguimiento de Envío',
      inTransit: 'En Tránsito',
      demoLogisticsNote:
        'Seguimiento de demostración — configura 17TRACK_API_KEY para datos reales',
      carrier: 'Transportista',
      trackingNumber: 'Número de Seguimiento',
      requestRefund: 'Solicitar reembolso',
      refundSubmitted: 'Solicitud enviada, esperando al vendedor',
    },
    common: {
      loading: 'Cargando...',
      error: 'Error al cargar',
      back: 'Volver',
      submit: 'Enviar',
      cancel: 'Cancelar',
      save: 'Guardar',
      search: 'Buscar',
      sortBy: 'Ordenar por',
      newest: 'Más Recientes',
      priceAsc: 'Precio: Menor a Mayor',
      priceDesc: 'Precio: Mayor a Menor',
      bestSelling: 'Más Vendidos',
      allCategories: 'Todas las Categorías',
      priceRange: 'Rango de Precios',
      minPrice: 'Precio Mínimo',
      maxPrice: 'Precio Máximo',
      apply: 'Aplicar',
      results: 'resultados',
      noResults: 'No se encontraron productos',
      lastUpdated: 'Última actualización',
    },
    status: {
      pending_payment: 'Pendiente de Pago',
      paid: 'Pagado',
      shipped: 'Enviado',
      delivered: 'Entregado',
      cancelled: 'Cancelado',
      refunded: 'Reembolsado',
      partially_refunded: 'Reembolso parcial',
    },
    chat: {
      title: 'Asistencia IA',
      placeholder: 'Escribe tu pregunta...',
      send: 'Enviar',
      typing: 'Escribiendo...',
      welcome:
        '¡Hola! Soy tu asistente virtual. ¿En qué puedo ayudarte hoy?',
      unavailable: 'El soporte de IA aún no está disponible',
    },
    address: {
      title: 'Direcciones',
      add: 'Añadir dirección',
      addNew: 'Añadir nueva dirección',
      empty: 'Sin direcciones',
      emptyHint: 'Añade una dirección para pagar más rápido',
      default: 'Predeterminada',
      setDefault: 'Predeterminada',
      edit: 'Editar',
      delete: 'Eliminar',
      label: 'Etiqueta',
      labelHome: 'Casa',
      labelOffice: 'Oficina',
      labelOther: 'Otra',
      receiver: 'Destinatario *',
      receiverPlaceholder: 'Nombre del destinatario',
      phone: 'Teléfono *',
      phonePlaceholder: 'Número de teléfono',
      detail: 'Dirección *',
      detailPlaceholder: 'Calle, número, etc.',
      detail2: 'Dirección 2',
      detail2Placeholder: 'Apartamento, piso, etc. (opcional)',
      city: 'Ciudad *',
      cityPlaceholder: 'Ciudad',
      state: 'Estado/Provincia',
      statePlaceholder: 'Estado o provincia (opcional)',
      zip: 'Código postal',
      zipPlaceholder: 'Código postal (opcional)',
      country: 'País *',
      countryPlaceholder: 'p. ej. US, CN, UK',
      setAsDefault: 'Marcar como predeterminada',
      create: 'Crear',
      loadFailed: 'No se pudieron cargar las direcciones',
      deleteFailed: 'Error al eliminar',
      setDefaultFailed: 'Error al establecer predeterminada',
      createFailed: 'Error al crear',
      updateFailed: 'Error al actualizar',
      deleted: 'Dirección eliminada',
      updated: 'Dirección actualizada',
      created: 'Dirección creada',
      defaultSet: 'Marcada como predeterminada',
      deleteConfirm: '¿Eliminar esta dirección?',
      needReceiver: 'Introduce el nombre del destinatario',
      needPhone: 'Introduce el teléfono',
      needDetail: 'Introduce la dirección',
      needCity: 'Introduce la ciudad',
      needCountry: 'Introduce el país',
    },
    auth: {
      signIn: 'Iniciar Sesión',
      signUp: 'Registrarse',
      email: 'Correo Electrónico',
      password: 'Contraseña',
      name: 'Nombre',
      namePlaceholder: 'Tu nombre',
      confirmPassword: 'Confirmar Contraseña',
      welcomeBack: 'Bienvenido de Nuevo',
      loginSubtitle: 'Inicia sesión para seguir comprando',
      createAccount: 'Crear Cuenta',
      registerSubtitle: 'Crea una cuenta y empieza tu experiencia de compra',
      noAccount: '¿No tienes cuenta?',
      haveAccount: '¿Ya tienes cuenta?',
      logout: 'Cerrar Sesión',
      loginToContinue: 'Inicia sesión para continuar',
      sellerAccessDenied: 'Acceso Denegado',
      sellerAccessDeniedDesc:
        'Tu cuenta no tiene acceso de vendedor. Inicia sesión con una cuenta de vendedor.',
      backToHome: 'Volver al Inicio',
      googleSignIn: 'Iniciar con Google',
      googleComingSoon: 'Inicio con Google próximamente',
    },
    favorites: {
      title: 'Mis Favoritos',
      empty: 'Aún no tienes favoritos',
      browseProducts: 'Explorar Productos',
      remove: 'Quitar',
    },
    seller: {
      coupons: 'Cupones',
      couponManagement: 'Gestión de Cupones',
      createCoupon: 'Crear Cupón',
      editCoupon: 'Editar Cupón',
      couponCode: 'Código',
      couponType: 'Tipo',
      couponValue: 'Valor',
      minOrderAmount: 'Pedido Mínimo',
      usageLimit: 'Límite de Usos',
      expiresAt: 'Fecha de Vencimiento',
      status: 'Estado',
      active: 'Activo',
      inactive: 'Inactivo',
      percent: 'Porcentaje',
      fixed: 'Importe Fijo',
      usedCount: 'Usos',
      actions: 'Acciones',
      enable: 'Activar',
      disable: 'Desactivar',
      edit: 'Editar',
      save: 'Guardar',
      cancel: 'Cancelar',
      createdAt: 'Creado',
      bulkImport: 'Importación Masiva',
      importProducts: 'Importar Productos',
      uploadCsv: 'Subir Archivo CSV',
      dragDropCsv: 'Arrastra y suelta el archivo CSV aquí',
      orClickToSelect: 'o haz clic para seleccionar',
      downloadTemplate: 'Descargar Plantilla',
      importInProgress: 'Importando...',
      importResult: 'Resultado de la Importación',
      successCount: 'Correctos',
      failCount: 'Fallidos',
      failureDetails: 'Detalle de Errores',
      importCompleted: 'Importación completada',
      importFailed: 'Error en la importación',
      row: 'Fila',
      reason: 'Motivo',
      selectCarrier: 'Seleccionar Transportista',
      enterTrackingNumber: 'Introduce el número de seguimiento',
      confirmShip: 'Confirmar Envío',
    },
  },
  pt: {
    nav: {
      home: 'Início',
      products: 'Produtos',
      cart: 'Carrinho',
      orders: 'Meus Pedidos',
      favorites: 'Favoritos',
      sellerCenter: 'Central do Vendedor',
      searchPlaceholder: 'Buscar produtos...',
      language: 'Idioma',
      points: 'Pontos',
    },
    home: {
      heroTitle: 'Descubra produtos do mundo',
      heroSubtitle:
        'Produtos premium selecionados, entregues em todo o mundo',
      shopNow: 'Comprar Agora',
      hotProducts: 'Produtos em Destaque',
      hotSubtitle: 'Ordenado por vendas reais nos últimos 30 dias',
      newSubtitle: 'Adicionados esta semana',
      recentSubtitle: 'Produtos que você abriu recentemente',
      newArrivals: 'Novidades',
      categories: 'Categorias',
      viewAll: 'Ver Tudo',
      featuredCollection: 'Coleção em Destaque',
    },
    product: {
      addToCart: 'Adicionar ao Carrinho',
      buyNow: 'Comprar Agora',
      price: 'Preço',
      originalPrice: 'Preço Original',
      stock: 'Estoque',
      sold: 'Vendidos',
      specs: 'Especificações',
      description: 'Descrição',
      bulletPoints: 'Destaques',
      quantity: 'Quantidade',
      inStock: 'Em Estoque',
      outOfStock: 'Esgotado',
      reviews: 'Avaliações',
      reviewTitle: 'Avaliações dos Clientes',
      averageRating: 'Avaliação Média',
      reviewCount: 'avaliações',
      writeReview: 'Escrever Avaliação',
      yourReview: 'Sua Avaliação',
      reviewPlaceholder: 'Compartilhe sua experiência...',
      submitReview: 'Enviar Avaliação',
      reviewSubmitted: 'Avaliação enviada com sucesso',
      noReviews: 'Ainda sem avaliações. Seja o primeiro!',
      loginToReview: 'Faça login para avaliar',
      alreadyReviewed: 'Você já avaliou este produto',
      addToFavorites: 'Adicionar aos Favoritos',
      removeFromFavorites: 'Remover dos Favoritos',
      favorites: 'Favoritos',
    },
    cart: {
      title: 'Carrinho de Compras',
      empty: 'Seu carrinho está vazio',
      subtotal: 'Subtotal',
      total: 'Total',
      checkout: 'Finalizar Compra',
      quantity: 'Quantidade',
      remove: 'Remover',
      itemsCount: 'itens',
      continueShopping: 'Continuar Comprando',
      coupon: 'Cupom',
      couponCode: 'Código do Cupom',
      applyCoupon: 'Aplicar',
      couponApplied: 'Cupom aplicado',
      couponInvalid: 'Código de cupom inválido',
      discount: 'Desconto',
      finalTotal: 'Total a Pagar',
      shipping: 'Frete',
      removeCoupon: 'Remover',
      minOrderNotMet: 'Valor mínimo do pedido não atingido',
      crossDevice: 'Sincronização entre dispositivos',
      exportCode: 'Exportar código',
      importCode: 'Importar código',
      exportCodeDesc: 'Gere um código de recuperação para sincronizar seu carrinho',
      importCodeDesc: 'Digite um código para mesclar o carrinho de outro dispositivo',
      generateCode: 'Gerar código',
      confirmImport: 'Importar',
      recoveryCode: 'Código de recuperação',
      codeCopied: 'Copiado para a área de transferência',
      codeExpiryNote: 'Válido por 24 horas, uso único',
      importSuccess: 'Carrinho mesclado com sucesso',
      codePlaceholder: 'Digite o código de 12 caracteres',
    },
    checkout: {
      title: 'Finalizar Compra',
      shippingInfo: 'Informações de Entrega',
      name: 'Nome Completo',
      email: 'E-mail',
      phone: 'Telefone',
      address: 'Endereço',
      city: 'Cidade',
      zip: 'CEP',
      country: 'País',
      paymentMethod: 'Forma de Pagamento',
      placeOrder: 'Fazer Pedido',
      demoPaymentNote: 'Pagamento de demonstração (sem cobrança real)',
      orderSummary: 'Resumo do Pedido',
      remark: 'Observação',
      backToCart: 'Voltar ao Carrinho',
    },
    orders: {
      title: 'Meus Pedidos',
      orderNo: 'N.º do Pedido',
      status: 'Status',
      amount: 'Valor',
      date: 'Data do Pedido',
      viewDetail: 'Ver Detalhes',
      tracking: 'Rastreamento',
      payNow: 'Pagar agora',
      paymentSuccess: 'Pagamento concluído',
      paymentPending: 'Pagamento criado, aguardando confirmação',
      writeReview: 'Escrever avaliação',
      statusTimeline: 'Andamento do Pedido',
      empty: 'Ainda não há pedidos',
      shippingInfo: 'Dados de Entrega',
      items: 'Itens',
      paymentMethod: 'Forma de Pagamento',
      logistics: 'Logística',
      logisticsTracking: 'Rastreamento',
      inTransit: 'Em Trânsito',
      demoLogisticsNote:
        'Rastreamento de demonstração — configure 17TRACK_API_KEY para dados reais',
      carrier: 'Transportadora',
      trackingNumber: 'Número de Rastreamento',
      requestRefund: 'Solicitar reembolso',
      refundSubmitted: 'Solicitação enviada, aguardando o vendedor',
    },
    common: {
      loading: 'Carregando...',
      error: 'Erro ao carregar',
      back: 'Voltar',
      submit: 'Enviar',
      cancel: 'Cancelar',
      save: 'Salvar',
      search: 'Buscar',
      sortBy: 'Ordenar por',
      newest: 'Mais Recentes',
      priceAsc: 'Preço: Menor para Maior',
      priceDesc: 'Preço: Maior para Menor',
      bestSelling: 'Mais Vendidos',
      allCategories: 'Todas as Categorias',
      priceRange: 'Faixa de Preço',
      minPrice: 'Preço Mínimo',
      maxPrice: 'Preço Máximo',
      apply: 'Aplicar',
      results: 'resultados',
      noResults: 'Nenhum produto encontrado',
      lastUpdated: 'Última atualização',
    },
    status: {
      pending_payment: 'Aguardando Pagamento',
      paid: 'Pago',
      shipped: 'Enviado',
      delivered: 'Entregue',
      cancelled: 'Cancelado',
      refunded: 'Reembolsado',
      partially_refunded: 'Reembolso parcial',
    },
    chat: {
      title: 'Suporte IA',
      placeholder: 'Digite sua pergunta...',
      send: 'Enviar',
      typing: 'Digitando...',
      welcome:
        'Olá! Sou seu assistente virtual. Como posso ajudar hoje?',
      unavailable: 'O suporte de IA ainda não está disponível',
    },
    address: {
      title: 'Endereços',
      add: 'Adicionar endereço',
      addNew: 'Adicionar novo endereço',
      empty: 'Nenhum endereço',
      emptyHint: 'Adicione um endereço para finalizar mais rápido',
      default: 'Padrão',
      setDefault: 'Definir padrão',
      edit: 'Editar',
      delete: 'Excluir',
      label: 'Rótulo',
      labelHome: 'Casa',
      labelOffice: 'Escritório',
      labelOther: 'Outro',
      receiver: 'Destinatário *',
      receiverPlaceholder: 'Nome do destinatário',
      phone: 'Telefone *',
      phonePlaceholder: 'Número de telefone',
      detail: 'Endereço *',
      detailPlaceholder: 'Rua, número, etc.',
      detail2: 'Complemento',
      detail2Placeholder: 'Apto, andar, etc. (opcional)',
      city: 'Cidade *',
      cityPlaceholder: 'Cidade',
      state: 'Estado/Província',
      statePlaceholder: 'Estado ou província (opcional)',
      zip: 'CEP',
      zipPlaceholder: 'CEP (opcional)',
      country: 'País *',
      countryPlaceholder: 'ex.: US, CN, UK',
      setAsDefault: 'Definir como padrão',
      create: 'Criar',
      loadFailed: 'Falha ao carregar endereços',
      deleteFailed: 'Falha ao excluir',
      setDefaultFailed: 'Falha ao definir padrão',
      createFailed: 'Falha ao criar',
      updateFailed: 'Falha ao atualizar',
      deleted: 'Endereço excluído',
      updated: 'Endereço atualizado',
      created: 'Endereço criado',
      defaultSet: 'Definido como padrão',
      deleteConfirm: 'Excluir este endereço?',
      needReceiver: 'Informe o nome do destinatário',
      needPhone: 'Informe o telefone',
      needDetail: 'Informe o endereço',
      needCity: 'Informe a cidade',
      needCountry: 'Informe o país',
    },
    auth: {
      signIn: 'Entrar',
      signUp: 'Cadastrar-se',
      email: 'E-mail',
      password: 'Senha',
      name: 'Nome',
      namePlaceholder: 'Seu nome',
      confirmPassword: 'Confirmar Senha',
      welcomeBack: 'Bem-vindo de Volta',
      loginSubtitle: 'Faça login para continuar comprando',
      createAccount: 'Criar Conta',
      registerSubtitle: 'Crie uma conta e comece sua experiência de compra',
      noAccount: 'Não tem conta?',
      haveAccount: 'Já tem conta?',
      logout: 'Sair',
      loginToContinue: 'Faça login para continuar',
      sellerAccessDenied: 'Acesso Negado',
      sellerAccessDeniedDesc:
        'Sua conta não tem acesso de vendedor. Faça login com uma conta de vendedor.',
      backToHome: 'Voltar ao Início',
      googleSignIn: 'Entrar com Google',
      googleComingSoon: 'Login com Google em breve',
    },
    favorites: {
      title: 'Meus Favoritos',
      empty: 'Ainda sem favoritos',
      browseProducts: 'Explorar Produtos',
      remove: 'Remover',
    },
    seller: {
      coupons: 'Cupons',
      couponManagement: 'Gerenciar Cupons',
      createCoupon: 'Criar Cupom',
      editCoupon: 'Editar Cupom',
      couponCode: 'Código',
      couponType: 'Tipo',
      couponValue: 'Valor',
      minOrderAmount: 'Pedido Mínimo',
      usageLimit: 'Limite de Usos',
      expiresAt: 'Data de Expiração',
      status: 'Status',
      active: 'Ativo',
      inactive: 'Inativo',
      percent: 'Percentual',
      fixed: 'Valor Fixo',
      usedCount: 'Usos',
      actions: 'Ações',
      enable: 'Ativar',
      disable: 'Desativar',
      edit: 'Editar',
      save: 'Salvar',
      cancel: 'Cancelar',
      createdAt: 'Criado em',
      bulkImport: 'Importação em Massa',
      importProducts: 'Importar Produtos',
      uploadCsv: 'Enviar Arquivo CSV',
      dragDropCsv: 'Arraste e solte o arquivo CSV aqui',
      orClickToSelect: 'ou clique para selecionar',
      downloadTemplate: 'Baixar Modelo',
      importInProgress: 'Importando...',
      importResult: 'Resultado da Importação',
      successCount: 'Sucesso',
      failCount: 'Falhas',
      failureDetails: 'Detalhes das Falhas',
      importCompleted: 'Importação concluída',
      importFailed: 'Falha na importação',
      row: 'Linha',
      reason: 'Motivo',
      selectCarrier: 'Selecionar Transportadora',
      enterTrackingNumber: 'Digite o número de rastreamento',
      confirmShip: 'Confirmar Envio',
    },
  },
};

export type TranslationKey = keyof Translations;

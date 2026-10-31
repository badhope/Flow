import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { count } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { DRIZZLE_DATABASE, type Database } from '../../database/database.provider';
import {
  categories,
  cmsPages,
  coupons,
  productVariants,
  products,
  shippingTemplates,
  users,
} from '../../database/schema';

/**
 * 演示数据种子：仅 development/test 且数据库为空时写入一次。
 * 生产环境禁止启用，避免写入公开演示账户。
 */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: Database) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.SEED_DEMO_DATA !== 'true') return;
    if (process.env.NODE_ENV === 'production') {
      this.logger.error('拒绝在 production 中启用 SEED_DEMO_DATA，避免写入公开演示账户');
      throw new Error('SEED_DEMO_DATA is forbidden in production');
    }

    try {
      const userCount = await this.db.select({ n: count() }).from(users);
      if (Number(userCount[0]?.n ?? 0) > 0) {
        this.logger.log('SEED_DEMO_DATA=true 但数据库已有用户，跳过演示数据写入');
        return;
      }

      await this.seed();
      this.logger.log(
        '演示数据已写入：卖家 seller@example.com / seller123，买家 buyer@example.com / buyer123，优惠码 TEST10（九折）',
      );
    } catch (err) {
      this.logger.error('演示数据写入失败', err instanceof Error ? err.stack : String(err));
    }
  }

  private async seed(): Promise<void> {
    const sellerHash = await bcrypt.hash('seller123', 10);
    const buyerHash = await bcrypt.hash('buyer123', 10);

    await this.db.transaction(async (tx) => {
      const [seller] = await tx
        .insert(users)
        .values({
          email: 'seller@example.com',
          passwordHash: sellerHash,
          name: 'Demo Seller',
          role: 'seller',
        })
        .returning();

      await tx.insert(users).values({
        email: 'buyer@example.com',
        passwordHash: buyerHash,
        name: 'Demo Buyer',
        role: 'buyer',
      });

      await tx.insert(shippingTemplates).values({
        sellerId: seller.id,
        name: '默认运费模板',
        freeShippingThreshold: '100.00',
        baseFee: '5.00',
        extraFeePerUnit: '2.00',
        unitType: 'quantity',
        isDefault: true,
      });

      const [catHome] = await tx
        .insert(categories)
        .values({ nameZh: '家居生活', nameEn: 'Home & Living', slug: 'home-living', sortOrder: 1 })
        .returning();
      const [catOutdoor] = await tx
        .insert(categories)
        .values({ nameZh: '户外运动', nameEn: 'Sports & Outdoors', slug: 'sports-outdoors', sortOrder: 2 })
        .returning();

      const demoProducts = [
        {
          titleZh: '便携折叠水杯 500ml',
          titleEn: 'Portable Folding Cup 500ml',
          descZh: '食品级硅胶，折叠收纳不占空间，适合户外徒步与差旅。',
          descEn: 'Food-grade silicone, folds flat for travel and hiking.',
          categoryId: catOutdoor.id,
          price: '12.90',
          stock: 500,
          weight: '0.300',
        },
        {
          titleZh: '棉麻北欧抱枕套 45x45cm',
          titleEn: 'Linen Cushion Cover 45x45cm',
          descZh: '天然棉麻面料，隐形拉链，机洗可用的北欧风家居单品。',
          descEn: 'Natural linen cotton with hidden zipper, machine washable.',
          categoryId: catHome.id,
          price: '9.50',
          stock: 800,
          weight: '0.200',
        },
      ];

      for (const [index, item] of demoProducts.entries()) {
        const [product] = await tx
          .insert(products)
          .values({
            sellerId: seller.id,
            titleZh: item.titleZh,
            titleEn: item.titleEn,
            descZh: item.descZh,
            descEn: item.descEn,
            categoryId: item.categoryId,
            status: 'active',
            weight: item.weight,
            totalStock: item.stock,
          })
          .returning();

        await tx.insert(productVariants).values({
          productId: product.id,
          sku: `DEMO-${String(index + 1).padStart(3, '0')}`,
          price: item.price,
          stock: item.stock,
          status: 'active',
        });
      }

      // 静态页面（页脚链接可达；卖家可在 CMS 里继续编辑）
      const staticPages = [
        { slug: 'about', titleZh: '关于我们', titleEn: 'About Us',
          contentZh: '<h2>让跨境生意更简单</h2><p>Flow 是 AI 原生的出口电商平台，帮助卖家在一个后台完成开店、上架、获客、成交、客服与复盘。</p>',
          contentEn: '<h2>Cross-Border Commerce, Simplified</h2><p>Flow is an AI-native export commerce platform covering launch, listing, growth, conversion, support and review in one back office.</p>' },
        { slug: 'faq', titleZh: '常见问题', titleEn: 'FAQ',
          contentZh: '<h2>常见问题</h2><p><strong>发货时效？</strong>付款后 2-5 个工作日内发货。</p><p><strong>支持退换吗？</strong>支持 30 天无理由退换。</p>',
          contentEn: '<h2>FAQ</h2><p><strong>Shipping time?</strong> Dispatched within 2-5 business days.</p><p><strong>Returns?</strong> 30-day no-reason returns.</p>' },
        { slug: 'privacy', titleZh: '隐私政策', titleEn: 'Privacy Policy',
          contentZh: '<h2>隐私政策</h2><p>我们仅收集完成订单所需的信息，不出售用户数据。</p>',
          contentEn: '<h2>Privacy Policy</h2><p>We collect only the data required to fulfil orders and never sell user data.</p>' },
        { slug: 'terms', titleZh: '服务条款', titleEn: 'Terms of Service',
          contentZh: '<h2>服务条款</h2><p>使用本平台即表示同意遵守当地法律法规与平台规则。</p>',
          contentEn: '<h2>Terms of Service</h2><p>By using this platform you agree to comply with applicable laws and platform rules.</p>' },
        { slug: 'shipping-info', titleZh: '配送说明', titleEn: 'Shipping Info',
          contentZh: '<h2>配送说明</h2><p>跨境包裹通常 7-15 天送达，发货后提供追踪号。</p>',
          contentEn: '<h2>Shipping Info</h2><p>Cross-border parcels usually arrive in 7-15 days with tracking.</p>' },
        { slug: 'returns', titleZh: '退换货政策', titleEn: 'Return Policy',
          contentZh: '<h2>退换货政策</h2><p>签收后 30 天内可申请退换，商品需保持全新。</p>',
          contentEn: '<h2>Return Policy</h2><p>Returns accepted within 30 days of delivery for unused items.</p>' },
        { slug: 'payment-methods', titleZh: '支付方式', titleEn: 'Payment Methods',
          contentZh: '<h2>支付方式</h2><p>支持 Stripe 信用卡、PayPal，以及本地演示支付。</p>',
          contentEn: '<h2>Payment Methods</h2><p>Cards via Stripe, PayPal, and demo payments for local use.</p>' },
        { slug: 'how-to-order', titleZh: '如何下单', titleEn: 'How to Order',
          contentZh: '<h2>如何下单</h2><p>选择商品规格 → 加入购物车 → 填写地址 → 选择支付方式 → 完成付款。</p>',
          contentEn: '<h2>How to Order</h2><p>Pick a variant, add to cart, enter your address, choose a payment method and pay.</p>' },
        { slug: 'help', titleZh: '帮助中心', titleEn: 'Help Center',
          contentZh: '<h2>帮助中心</h2><p>遇到问题可先查看常见问题，或通过右下角 AI 客服联系我们。</p>',
          contentEn: '<h2>Help Center</h2><p>Check the FAQ first, or reach us through the AI support widget.</p>' },
        { slug: 'contact', titleZh: '联系我们', titleEn: 'Contact Us',
          contentZh: '<h2>联系我们</h2><p>邮箱：support@flow.example（演示地址，请替换为真实邮箱）。</p>',
          contentEn: '<h2>Contact Us</h2><p>Email: support@flow.example (demo address, replace with yours).</p>' },
      ];
      await tx.insert(cmsPages).values(
        staticPages.map((page) => ({
          slug: page.slug,
          titleZh: page.titleZh,
          titleEn: page.titleEn,
          contentZh: page.contentZh,
          contentEn: page.contentEn,
          isPublished: true,
        })),
      );

      const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      await tx.insert(coupons).values({
        sellerId: seller.id,
        code: 'TEST10',
        type: 'percent',
        value: '10.00',
        totalQuantity: 1000,
        perUserLimit: 1,
        expiresAt,
        active: true,
      });
    });
  }
}

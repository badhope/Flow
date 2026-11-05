import { Controller, Get, Query, BadRequestException } from '@nestjs/common';

import { ShippingService } from './shipping.service';
import { computeTax, listSupportedCountries } from '../../common/pricing/tax';

/**
 * 买家结算页运费报价（公开接口）。
 * 报价仅供展示，下单时服务端会用同一计算口径重算并以订单为准。
 */
@Controller('shipping')
export class ShippingQuoteController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get('quote')
  async quote(
    @Query('subtotal') subtotal?: string,
    @Query('qtyTotal') qtyTotal?: string,
    @Query('weightTotal') weightTotal?: string,
    @Query('country') country?: string,
  ) {
    const subtotalNum = Number(subtotal ?? '0');
    if (!Number.isFinite(subtotalNum) || subtotalNum < 0) {
      throw new BadRequestException('subtotal 参数非法');
    }

    const qty = qtyTotal !== undefined ? Number(qtyTotal) : undefined;
    const weight = weightTotal !== undefined ? Number(weightTotal) : undefined;
    if ((qty !== undefined && (!Number.isFinite(qty) || qty < 0)) ||
        (weight !== undefined && (!Number.isFinite(weight) || weight < 0))) {
      throw new BadRequestException('数量/重量参数非法');
    }

    return this.shippingService.quoteForBuyer({
      country: country?.trim().slice(0, 100) || undefined,
      qtyTotal: qty,
      weightTotal: weight,
      subtotal: subtotalNum,
    });
  }

  /**
   * 结账页税额预估（公开接口）。
   *
   * 与下单使用**同一个** computeTax()，保证前端展示的税额与实际入账一致。
   * 之前税额恒为 0，跨境买家看到的总价低于真实到手成本。
   */
  @Get('tax')
  tax(
    @Query('subtotal') subtotal?: string,
    @Query('shippingFee') shippingFee?: string,
    @Query('discountAmount') discountAmount?: string,
    @Query('country') country?: string,
  ) {
    const parseAmount = (raw: string | undefined, field: string): number => {
      if (raw === undefined || raw === '') return 0;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        throw new BadRequestException(`${field} 参数非法`);
      }
      return n;
    };

    const sub = parseAmount(subtotal, 'subtotal');
    const ship = parseAmount(shippingFee, 'shippingFee');
    const disc = parseAmount(discountAmount, 'discountAmount');

    return computeTax({
      subtotal: String(sub),
      shippingFee: String(ship),
      discountAmount: String(disc),
      country: country?.trim().slice(0, 2) ?? '',
    });
  }

  /** 已支持的市场列表（含税率摘要），供结账页/卖家端展示 */
  @Get('tax/countries')
  taxCountries() {
    return { countries: listSupportedCountries() };
  }
}

import { describe, expect, it } from 'vitest';

/**
 * The shipping page used to edit a `rules[]` array that the API never read, so
 * saved rates were silently discarded. These cases pin the contract that the
 * page now uses: flat first-unit fee + per-additional-unit fee + optional zone
 * surcharges, matching `shipping_templates` and `computeShippingFee`.
 */
import { computeShippingFee } from './shipping-fee';

const base = {
  baseFee: '5.00',
  extraFeePerUnit: '2.00',
  freeShippingThreshold: '100.00',
  unitType: 'quantity',
  specialZones: null as string | null,
};

describe('shipping fee model', () => {
  it('R1: charges the base fee for a single item', () => {
    const quote = computeShippingFee(base, { qtyTotal: 1, subtotal: 10 });
    expect(quote.fee).toBe('5.00');
    expect(quote.freeShippingApplied).toBe(false);
  });

  it('R2: adds the per-unit fee for each extra item', () => {
    // 3 items -> base 5 + 2 extras * 2 = 9
    const quote = computeShippingFee(base, { qtyTotal: 3, subtotal: 10 });
    expect(quote.fee).toBe('9.00');
  });

  it('R3: applies free shipping at or above the threshold', () => {
    const quote = computeShippingFee(base, { qtyTotal: 3, subtotal: 100 });
    expect(quote.fee).toBe('0.00');
    expect(quote.freeShippingApplied).toBe(true);
  });

  it('R4: a zero threshold never triggers free shipping', () => {
    const quote = computeShippingFee(
      { ...base, freeShippingThreshold: '0' },
      { qtyTotal: 5, subtotal: 999 },
    );
    expect(quote.freeShippingApplied).toBe(false);
  });

  it('R5: weight-based templates charge per extra kilogram', () => {
    const quote = computeShippingFee(
      { ...base, unitType: 'weight', qtyTotal: 99, weightTotal: 3 },
      { weightTotal: 3, subtotal: 10 },
    );
    expect(quote.fee).toBe('9.00');
  });

  it('R6: a matching special zone adds its surcharge', () => {
    const quote = computeShippingFee(
      { ...base, specialZones: JSON.stringify([{ countries: ['US', 'CA'], extraFee: '3.00' }]) },
      { country: 'US', qtyTotal: 1, subtotal: 10 },
    );
    expect(quote.fee).toBe('8.00');
  });

  it('R7: a non-matching country gets no surcharge', () => {
    const quote = computeShippingFee(
      { ...base, specialZones: JSON.stringify([{ countries: ['US'], extraFee: '3.00' }]) },
      { country: 'DE', qtyTotal: 1, subtotal: 10 },
    );
    expect(quote.fee).toBe('5.00');
  });

  it('R8: malformed specialZones falls back to the base fee instead of crashing', () => {
    const quote = computeShippingFee(
      { ...base, specialZones: '{not json' },
      { country: 'US', qtyTotal: 1, subtotal: 10 },
    );
    expect(quote.fee).toBe('5.00');
  });

  it('R9: no template means zero shipping', () => {
    expect(computeShippingFee(null, { qtyTotal: 2, subtotal: 10 }).fee).toBe('0.00');
  });
});

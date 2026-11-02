import { describe, expect, it } from 'vitest';
import {
  EMPTY_PRODUCT_FORM,
  PAGE_SIZE,
  STATUS_MAP,
  productSchema,
  toProductForm,
  toProductPayload,
  validateCsvFile,
} from '../schema';

/** Minimal File stand-in: jsdom's File is fine but size control is easier this way. */
function fakeFile(name: string, size: number): File {
  const file = new File(['x'], name, { type: 'text/csv' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('productSchema', () => {
  it('R1: accepts a minimal valid product', () => {
    const parsed = productSchema.safeParse({
      ...EMPTY_PRODUCT_FORM,
      titleZh: '户外保温杯',
      titleEn: 'Insulated Bottle',
      price: '24.00',
      stock: '120',
    });
    expect(parsed.success).toBe(true);
  });

  it('R2: rejects a missing Chinese title', () => {
    const parsed = productSchema.safeParse({ ...EMPTY_PRODUCT_FORM, titleZh: '', titleEn: 'x' });
    expect(parsed.success).toBe(false);
  });

  it('R3: rejects a non-numeric price', () => {
    const parsed = productSchema.safeParse({
      ...EMPTY_PRODUCT_FORM,
      titleZh: 'a',
      titleEn: 'b',
      price: 'abc',
    });
    expect(parsed.success).toBe(false);
  });

  it('R4: rejects a non-http image URL', () => {
    const parsed = productSchema.safeParse({
      ...EMPTY_PRODUCT_FORM,
      titleZh: 'a',
      titleEn: 'b',
      coverImage: 'javascript:alert(1)',
    });
    expect(parsed.success).toBe(false);
  });

  it('R5: allows an empty image URL', () => {
    const parsed = productSchema.safeParse({
      ...EMPTY_PRODUCT_FORM,
      titleZh: 'a',
      titleEn: 'b',
      coverImage: '',
    });
    expect(parsed.success).toBe(true);
  });
});

describe('toProductForm', () => {
  it('R6: prefers the first variant price over minPrice', () => {
    const form = toProductForm({
      titleZh: 'a',
      titleEn: 'b',
      minPrice: '10.00',
      totalStock: 5,
      status: 'active',
      variants: [{ price: '12.50', originalPrice: '15.00' }],
    });
    expect(form.price).toBe('12.50');
    expect(form.originalPrice).toBe('15.00');
    expect(form.stock).toBe('5');
  });

  it('R7: falls back to minPrice when no variant exists', () => {
    const form = toProductForm({
      titleZh: 'a',
      titleEn: 'b',
      minPrice: '9.90',
      totalStock: 0,
      status: 'draft',
      variants: [],
    });
    expect(form.price).toBe('9.90');
    expect(form.originalPrice).toBe('');
  });

  it('R8: converts null optional fields to empty strings', () => {
    const form = toProductForm({
      titleZh: 'a',
      titleEn: 'b',
      categoryId: null,
      minPrice: null,
      totalStock: 1,
      status: 'inactive',
      coverImage: null,
      descZh: null,
      descEn: null,
      longDescZh: null,
      longDescEn: null,
      variants: [],
    });
    expect(form.categoryId).toBe('');
    expect(form.coverImage).toBe('');
    expect(form.longDescEn).toBe('');
  });
});

describe('toProductPayload', () => {
  it('R9: coerces numeric strings and drops empty optionals', () => {
    const payload = toProductPayload({
      ...EMPTY_PRODUCT_FORM,
      titleZh: 'a',
      titleEn: 'b',
      price: '24.00',
      stock: '7',
      originalPrice: '',
      coverImage: '',
      categoryId: '',
    });
    expect(payload.price).toBe(24);
    expect(payload.stock).toBe(7);
    expect(payload.originalPrice).toBeUndefined();
    expect(payload.coverImage).toBeUndefined();
    expect(payload.categoryId).toBeUndefined();
  });

  it('R10: keeps an explicit original price', () => {
    const payload = toProductPayload({
      ...EMPTY_PRODUCT_FORM,
      titleZh: 'a',
      titleEn: 'b',
      price: '10',
      originalPrice: '19.99',
      stock: '1',
    });
    expect(payload.originalPrice).toBe(19.99);
  });
});

describe('validateCsvFile', () => {
  it('R11: rejects a non-csv extension', () => {
    expect(validateCsvFile(fakeFile('products.xlsx', 100))).toMatch(/CSV/);
  });

  it('R12: rejects an empty file', () => {
    expect(validateCsvFile(fakeFile('products.csv', 0))).toMatch(/不能为空/);
  });

  it('R13: rejects a file above 10MB', () => {
    expect(validateCsvFile(fakeFile('products.csv', 10 * 1024 * 1024 + 1))).toMatch(/10MB/);
  });

  it('R14: accepts a normal csv', () => {
    expect(validateCsvFile(fakeFile('products.csv', 2048))).toBeNull();
  });

  it('R15: extension check is case insensitive', () => {
    expect(validateCsvFile(fakeFile('PRODUCTS.CSV', 2048))).toBeNull();
  });
});

describe('constants', () => {
  it('R16: every status has a label and a badge variant', () => {
    for (const key of ['active', 'draft', 'inactive']) {
      expect(STATUS_MAP[key]?.label).toBeTruthy();
      expect(STATUS_MAP[key]?.variant).toBeTruthy();
    }
  });

  it('R17: page size is a positive integer', () => {
    expect(Number.isInteger(PAGE_SIZE)).toBe(true);
    expect(PAGE_SIZE).toBeGreaterThan(0);
  });
});

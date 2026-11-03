import { describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ProductsService } from './products.service';

describe('ProductsService AI and variant tenant scope', () => {
  function service(rows: Array<{ id: string; sellerId: string; status?: string }>): ProductsService {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => rows,
            orderBy: async () => [],
          }),
        }),
      }),
      update: () => ({
        set: () => ({ where: async () => undefined }),
      }),
    };
    return new ProductsService(db as never, {} as never);
  }

  it('R34: markCopyReviewed rejects a seller owning another seller product', async () => {
    await expect(service([{ id: 'p1', sellerId: 'seller-2' }]).markCopyReviewed('p1', { userId: 'seller-1', role: 'seller' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('R35: listVariants public access rejects inactive product', async () => {
    const productsService = service([{ id: 'p1', sellerId: 'seller-2', status: 'inactive' }]);
    await expect(productsService.listVariants('p1')).rejects.toThrow();
  });

  it('R37: seller cross-owner variant access is rejected', async () => {
    const productsService = service([{ id: 'p1', sellerId: 'seller-2', status: 'active' }]);
    await expect(productsService.listVariants('p1', { userId: 'seller-1', role: 'seller' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('R38: admin can access another seller variants', async () => {
    const productsService = service([{ id: 'p1', sellerId: 'seller-2', status: 'active' }]);
    await expect(productsService.listVariants('p1', { userId: 'admin-1', role: 'admin' })).resolves.toEqual([]);
  });
});

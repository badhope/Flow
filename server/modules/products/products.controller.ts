import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { RolesGuard } from '../../common/guards/roles.guard';
import { resolveClientIp } from '../../common/http/client-ip';
import {
  IsString,
  IsOptional,
  IsInt,
  IsNumber,
  IsArray,
  IsObject,
  IsIn,
  Min,
  Max,
  MinLength,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  Product,
  ProductListResponse,
  CreateProductRequest,
  UpdateProductRequest,
  ProductListParams,
} from '../../../shared/api.interface';
import { ProductsService, type UpdateVariantDto } from './products.service';

const PRODUCT_SORT_BY = ['price_asc', 'price_desc', 'sold_desc', 'newest'] as const;
const PRODUCT_STATUS = ['draft', 'active', 'inactive'] as const;

class ProductListQueryDto implements ProductListParams {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxPrice?: number;

  @IsOptional()
  @IsString()
  @IsIn(PRODUCT_SORT_BY)
  sortBy?: 'price_asc' | 'price_desc' | 'sold_desc' | 'newest';

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  @IsIn(['mine'])
  scope?: 'mine';
}

class CreateProductDto implements CreateProductRequest {
  @IsOptional()
  @IsString()
  sku?: string;

  @IsString()
  titleZh!: string;

  @IsString()
  titleEn!: string;

  @IsOptional()
  @IsString()
  descZh?: string;

  @IsOptional()
  @IsString()
  descEn?: string;

  @IsOptional()
  @IsString()
  longDescZh?: string;

  @IsOptional()
  @IsString()
  longDescEn?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @Type(() => Number)
  @IsNumber()
  price!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  originalPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  stock?: number;

  @IsOptional()
  @IsString()
  @IsIn(PRODUCT_STATUS)
  status?: 'draft' | 'active' | 'inactive';

  @IsOptional()
  @IsString()
  coverImage?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @IsOptional()
  @IsObject()
  specs?: { [key: string]: string };

  @IsOptional()
  @IsString()
  seoKeywordsZh?: string;

  @IsOptional()
  @IsString()
  seoKeywordsEn?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bulletPointsZh?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bulletPointsEn?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  weight?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVariantDto)
  variants?: CreateVariantDto[];
}

class CreateVariantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  sku!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  optionValues?: string[];

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  price!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  originalPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsString()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}

class UpdateProductDto implements UpdateProductRequest {
  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  titleZh?: string;

  @IsOptional()
  @IsString()
  titleEn?: string;

  @IsOptional()
  @IsString()
  descZh?: string;

  @IsOptional()
  @IsString()
  descEn?: string;

  @IsOptional()
  @IsString()
  longDescZh?: string;

  @IsOptional()
  @IsString()
  longDescEn?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  originalPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  stock?: number;

  @IsOptional()
  @IsString()
  @IsIn(PRODUCT_STATUS)
  status?: 'draft' | 'active' | 'inactive';

  @IsOptional()
  @IsString()
  coverImage?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @IsOptional()
  @IsObject()
  specs?: { [key: string]: string };

  @IsOptional()
  @IsString()
  seoKeywordsZh?: string;

  @IsOptional()
  @IsString()
  seoKeywordsEn?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bulletPointsZh?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bulletPointsEn?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  weight?: number;
}

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  private getClientIp(req: Request): string {
    return resolveClientIp(req);
  }

  @Get('featured')
  async getFeatured(): Promise<Product[]> {
    return this.productsService.getFeatured();
  }

  @Get()
  async findAll(
    @Req() req: Request,
    @Query() query: ProductListQueryDto,
  ): Promise<ProductListResponse> {
    return this.productsService.findAll(query, {
      sellerId: req.user?.id,
      role: req.user?.role,
    });
  }

  @Get('import-template')
  getImportTemplate(@Res() res: Response): void {
    const csv = this.productsService.getImportTemplateCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="products-import-template.csv"',
    );
    res.send(csv);
  }

  /** 批量按 ID 查询（买家端集合/楼层等聚合场景；仅返回上架商品） */
  @Get('by-ids')
  async findByIds(@Query('ids') ids?: string): Promise<Product[]> {
    const list = (ids ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 60);
    if (list.length === 0) return [];
    return this.productsService.findByIds(list, true);
  }

  // ==================== Variants (SPU -> SKU) ====================

  @Get(':id/variants')
  async listVariants(@Req() req: Request, @Param('id') id: string) {
    const actor = req.user && ['seller', 'admin'].includes(req.user.role)
      ? { userId: req.user.id, role: req.user.role }
      : undefined;
    return this.productsService.listVariants(id, actor);
  }

  @UseGuards(new RolesGuard(['seller', 'admin']))
  @Post(':id/variants')
  async createVariant(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: CreateVariantDto,
  ) {
    return this.productsService.createVariant(id, body, {
      userId: req.user?.id,
      role: req.user?.role,
    });
  }

  @UseGuards(new RolesGuard(['seller', 'admin']))
  @Patch('variants/:variantId')
  async updateVariant(
    @Req() req: Request,
    @Param('variantId') variantId: string,
    @Body() body: UpdateVariantDto,
  ) {
    return this.productsService.updateVariant(variantId, body, {
      userId: req.user?.id,
      role: req.user?.role,
    });
  }

  @UseGuards(new RolesGuard(['seller', 'admin']))
  @Delete('variants/:variantId')
  async deleteVariant(@Req() req: Request, @Param('variantId') variantId: string) {
    return this.productsService.deleteVariant(variantId, {
      userId: req.user?.id,
      role: req.user?.role,
    });
  }

  @UseGuards(new RolesGuard(['seller', 'admin']))
  @Get('audit/active')
  async auditActive(@Req() req: Request, @Query('limit') limit?: string) {
    const parsed = limit ? parseInt(limit, 10) : 200;
    return this.productsService.auditActiveProducts(
      Number.isFinite(parsed) ? parsed : 200,
      { userId: req.user?.id, role: req.user?.role },
    );
  }

  @UseGuards(new RolesGuard(['seller', 'admin']))
  @Get(':id/publish-readiness')
  async getPublishReadiness(@Req() req: Request, @Param('id') id: string) {
    return this.productsService.getPublishReadiness(id, {
      userId: req.user?.id,
      role: req.user?.role,
    });
  }

  @Get(':id')
  async findOne(@Req() req: Request, @Param('id') id: string): Promise<Product> {
    // 卖家读草稿仅限本店商品；买家/游客只能读上架商品
    const actor = req.user && ['seller', 'admin'].includes(req.user.role)
      ? { userId: req.user.id, role: req.user.role }
      : undefined;
    const product = await this.productsService.findOne(id, {
      includeUnpublished: Boolean(actor),
      actor,
    });
    if (
      product.status !== 'active'
      && req.user?.role === 'seller'
      && product.sellerId !== req.user.id
    ) {
      throw new ForbiddenException('无权查看该商品');
    }
    return product;
  }

  @UseGuards(new RolesGuard(['seller', 'admin']))
  @Post()
  async create(
    @Req() req: Request,
    @Body() dto: CreateProductDto,
  ): Promise<Product> {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('用户未登录');
    return this.productsService.create(dto, userId);
  }

  @UseGuards(new RolesGuard(['seller', 'admin']))
  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<Product> {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('用户未登录');
    const role = req.user?.role;
    const ip = this.getClientIp(req);
    return this.productsService.update(id, dto, userId, { role, ip });
  }

  @UseGuards(new RolesGuard(['seller', 'admin']))
  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string): Promise<{ id: string }> {
    return this.productsService.remove(id, {
      userId: req.user?.id,
      role: req.user?.role,
    });
  }

  @UseGuards(new RolesGuard(['seller', 'admin']))
  @Get('export/csv')
  async exportCsv(@Req() req: Request, @Res() res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('用户未登录');
    const csv = await this.productsService.exportCsv({
      userId,
      role: req.user?.role,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="products-export.csv"');
    res.send(csv);
  }

  @UseGuards(new RolesGuard(['seller', 'admin']))
  @Post('bulk-status')
  async bulkStatus(
    @Req() req: Request,
    @Body() body: { ids: string[]; status: 'draft' | 'active' | 'inactive' },
  ) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('用户未登录');
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      throw new BadRequestException('请选择至少一个商品');
    }
    if (!['draft', 'active', 'inactive'].includes(body.status)) {
      throw new BadRequestException('无效的状态');
    }
    return this.productsService.bulkUpdateStatus(body.ids, body.status, {
      userId,
      role: req.user?.role,
    });
  }

  @UseGuards(new RolesGuard(['seller', 'admin']))
  @Post('import')
  async importCsv(@Req() req: Request): Promise<{
    successCount: number;
    failCount: number;
    failures: Array<{ row: number; reason: string }>;
  }> {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      throw new BadRequestException('请使用 multipart/form-data 上传文件');
    }

    const buffer = await this.getRawBody(req, 10 * 1024 * 1024);
    const fileBuffer = this.extractFileFromMultipart(buffer, contentType, 'file');

    if (!fileBuffer) {
      throw new BadRequestException('未找到上传的文件字段 file');
    }

    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('用户未登录');
    const role = req.user?.role;
    const ip = this.getClientIp(req);
    return this.productsService.bulkImport(fileBuffer, userId, { role, ip });
  }

  private getRawBody(
    req: Request,
    maxSize: number = 10 * 1024 * 1024,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalSize = 0;
      let aborted = false;
      req.on('data', (chunk: Buffer) => {
        if (aborted) return;
        totalSize += chunk.length;
        if (totalSize > maxSize) {
          aborted = true;
          req.destroy();
          reject(
            new PayloadTooLargeException(
              `文件大小超过限制（最大 ${Math.round(maxSize / 1024 / 1024)}MB）`,
            ),
          );
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (!aborted) resolve(Buffer.concat(chunks));
      });
      req.on('error', (err) => {
        if (!aborted) reject(err);
      });
    });
  }

  private extractFileFromMultipart(
    buffer: Buffer,
    contentType: string,
    fieldName: string,
  ): Buffer | null {
    const boundaryMatch = contentType.match(/boundary=(.+)/i);
    if (!boundaryMatch) return null;

    const boundary = Buffer.from(`--${boundaryMatch[1].trim()}`);
    const parts: Buffer[] = [];
    let start = 0;

    while (start < buffer.length) {
      const idx = buffer.indexOf(boundary, start);
      if (idx === -1) break;
      const nextIdx = buffer.indexOf(boundary, idx + boundary.length);
      if (nextIdx === -1) break;
      const part = buffer.slice(idx + boundary.length, nextIdx);
      parts.push(part);
      start = nextIdx;
    }

    for (const part of parts) {
      const headerEnd = part.indexOf('\r\n\r\n');
      if (headerEnd === -1) continue;
      const headerStr = part.slice(0, headerEnd).toString('utf-8');
      if (headerStr.includes(`name="${fieldName}"`)) {
        // Skip the \r\n\r\n (4 bytes) and strip trailing \r\n
        let content = part.slice(headerEnd + 4);
        if (content.length >= 2 && content[content.length - 2] === 0x0d && content[content.length - 1] === 0x0a) {
          content = content.slice(0, -2);
        }
        return content;
      }
    }

    return null;
  }
}

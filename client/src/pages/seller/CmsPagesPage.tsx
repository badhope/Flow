import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Edit, Trash2, FileText, Eye, EyeOff } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getCmsPages,
  getCmsPageDetail,
  createCmsPage,
  updateCmsPage,
  deleteCmsPage,
} from '@/api/cms';
import RichTextEditor from '@/components/RichTextEditor';
import type {
  CmsPage,
  CreateCmsPageRequest,
  UpdateCmsPageRequest,
} from '@shared/api.interface';
import { toast } from 'sonner';
import { SellerPageHeader } from '@/components/seller/SellerUI';

const PAGE_SIZE = 10;

const CmsPagesPage: React.FC = () => {
  const [pages, setPages] = useState<CmsPage[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateCmsPageRequest>({
    slug: '',
    titleZh: '',
    titleEn: '',
    contentZh: '',
    contentEn: '',
    isPublished: false,
  });
  const [formLoading, setFormLoading] = useState(false);

  const fetchPages = useCallback(async () => {
    try {
      setLoading(true);
      const result = await getCmsPages({
        page,
        pageSize: PAGE_SIZE,
        keyword: keyword || undefined,
        status: statusFilter || undefined,
      } as Parameters<typeof getCmsPages>[0]);
      setPages(result.items);
      setTotal(result.total);
    } catch {
      toast.error('加载页面失败');
    } finally {
      setLoading(false);
    }
  }, [page, keyword, statusFilter]);

  useEffect(() => {
    fetchPages();
  }, [fetchPages]);

  const handleSearch = () => {
    setPage(1);
    fetchPages();
  };

  const handleCreate = () => {
    setEditingId(null);
    setForm({ slug: '', titleZh: '', titleEn: '', contentZh: '', contentEn: '', isPublished: false });
    setDialogOpen(true);
  };

  const handleEdit = async (cmsPage: CmsPage) => {
    setEditingId(cmsPage.id);
    setFormLoading(true);
    try {
      const detail = await getCmsPageDetail(cmsPage.id);
      setForm({
        slug: detail.slug,
        titleZh: detail.titleZh,
        titleEn: detail.titleEn,
        contentZh: detail.contentZh,
        contentEn: detail.contentEn,
        metaTitleZh: detail.metaTitleZh,
        metaTitleEn: detail.metaTitleEn,
        metaDescZh: detail.metaDescZh,
        metaDescEn: detail.metaDescEn,
        isPublished: detail.isPublished,
      });
      setDialogOpen(true);
    } catch {
      toast.error('加载页面详情失败');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确认删除该页面？此操作不可恢复。')) return;
    try {
      await deleteCmsPage(id);
      toast.success('页面已删除');
      fetchPages();
    } catch {
      toast.error('删除失败');
    }
  };

  const handleSubmit = async () => {
    if (!form.titleZh.trim()) {
      toast.error('请输入页面中文标题');
      return;
    }
    if (!form.titleEn.trim()) {
      toast.error('请输入页面英文标题');
      return;
    }
    if (!form.slug.trim()) {
      toast.error('请输入页面标识');
      return;
    }
    try {
      if (editingId) {
        const updatePayload: UpdateCmsPageRequest = { ...form };
        await updateCmsPage(editingId, updatePayload);
        toast.success('页面更新成功');
      } else {
        await createCmsPage(form);
        toast.success('页面创建成功');
      }
      setDialogOpen(false);
      fetchPages();
    } catch {
      toast.error(editingId ? '更新失败' : '创建失败');
    }
  };

  const handleTogglePublish = async (cmsPage: CmsPage) => {
    const next = !cmsPage.isPublished;
    try {
      await updateCmsPage(cmsPage.id, { isPublished: next });
      toast.success(next ? '页面已发布' : '已设为草稿');
      fetchPages();
    } catch {
      toast.error('操作失败');
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      <SellerPageHeader
        eyebrow={'Content'}
        title={'CMS 页面'}
        description={'About / FAQ / 政策等静态内容，支持多语言富文本。'}
        actions={
          <Button size="sm" onClick={handleCreate}>
            <Plus className="mr-1 h-4 w-4" />
            创建页面
          </Button>
        }
      />

      {/* Filter */}
      <Card className="shadow-sm">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Input
            placeholder="搜索页面标题"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="w-56"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">全部状态</SelectItem>
              <SelectItem value="draft">草稿</SelectItem>
              <SelectItem value="published">已发布</SelectItem>
              <SelectItem value="archived">已归档</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleSearch} variant="secondary" size="sm">搜索</Button>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>标题</TableHead>
                <TableHead>标识</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>已发布</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">加载中...</TableCell>
                </TableRow>
              )}
              {!loading && pages.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-0">
                    <Empty>
                      <EmptyHeader>
                        <EmptyMedia variant="icon"><FileText className="size-6" /></EmptyMedia>
                        <EmptyTitle>暂无页面</EmptyTitle>
                        <EmptyDescription>创建自定义页面，如关于我们、帮助中心等</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                pages.map((cmsPage) => (
                  <TableRow key={cmsPage.id}>
                    <TableCell className="font-medium text-slate-900">{cmsPage.titleZh}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">/{cmsPage.slug}</TableCell>
                    <TableCell>
                      <Badge variant={cmsPage.isPublished ? 'default' : 'secondary'}>
                        {cmsPage.isPublished ? '已发布' : '草稿'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {cmsPage.isPublished ? (
                        <Eye className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <EyeOff className="h-4 w-4 text-slate-300" />
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {cmsPage.updatedAt ? new Date(cmsPage.updatedAt).toLocaleDateString('zh-CN') : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => handleTogglePublish(cmsPage)}>
                          {cmsPage.isPublished ? (
                            <EyeOff className="mr-1 h-3 w-3" />
                          ) : (
                            <Eye className="mr-1 h-3 w-3" />
                          )}
                          {cmsPage.isPublished ? '取消发布' : '发布'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleEdit(cmsPage)}>
                          <Edit className="mr-1 h-3 w-3" />
                          编辑
                        </Button>
                        <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700" onClick={() => handleDelete(cmsPage.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-3">
              <div className="text-sm text-muted-foreground">
                共 {total} 条，第 {page}/{totalPages} 页
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                  上一页
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                  下一页
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 编辑弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? '编辑页面' : '创建页面'}</DialogTitle>
          </DialogHeader>
          {formLoading ? (
            <div className="py-12 text-center text-slate-500">加载中...</div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>页面标题（中文）*</Label>
                  <Input
                    placeholder="如：关于我们"
                    value={form.titleZh}
                    onChange={(e) => setForm((prev) => ({ ...prev, titleZh: e.target.value }))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>页面标题（英文）*</Label>
                  <Input
                    placeholder="如：About Us"
                    value={form.titleEn}
                    onChange={(e) => setForm((prev) => ({ ...prev, titleEn: e.target.value }))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>标识 (slug) *</Label>
                  <Input
                    placeholder="如：about-us"
                    value={form.slug}
                    onChange={(e) => {
                      const slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
                      setForm((prev) => ({ ...prev, slug }));
                    }}
                    className="mt-1 font-mono text-sm"
                  />
                </div>
              </div>

              {/* Rich Text Editor */}
              <div>
                <Label>页面内容（中文）</Label>
                <div className="mt-1">
                  <RichTextEditor
                    value={form.contentZh || ''}
                    onChange={(html) => setForm((prev) => ({ ...prev, contentZh: html }))}
                    placeholder="在此输入页面内容..."
                  />
                </div>
              </div>

              <div>
                <Label>页面内容（英文）</Label>
                <div className="mt-1">
                  <RichTextEditor
                    value={form.contentEn || ''}
                    onChange={(html) => setForm((prev) => ({ ...prev, contentEn: html }))}
                    placeholder="English content here..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>SEO 标题（中文）</Label>
                  <Input
                    placeholder="留空则使用页面标题"
                    value={form.metaTitleZh || ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, metaTitleZh: e.target.value }))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>SEO 标题（英文）</Label>
                  <Input
                    placeholder="Optional, defaults to title"
                    value={form.metaTitleEn || ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, metaTitleEn: e.target.value }))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>状态</Label>
                  <Select value={form.isPublished ? 'published' : 'draft'} onValueChange={(v) => setForm((prev) => ({ ...prev, isPublished: v === 'published' }))}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">草稿</SelectItem>
                      <SelectItem value="published">已发布</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>SEO 描述（中文）</Label>
                  <Textarea
                    placeholder="SEO meta description（选填）"
                    value={form.metaDescZh || ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, metaDescZh: e.target.value }))}
                    rows={2}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>SEO 描述（英文）</Label>
                  <Textarea
                    placeholder="Optional meta description"
                    value={form.metaDescEn || ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, metaDescEn: e.target.value }))}
                    rows={2}
                    className="mt-1"
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSubmit}>{editingId ? '保存修改' : '创建页面'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CmsPagesPage;

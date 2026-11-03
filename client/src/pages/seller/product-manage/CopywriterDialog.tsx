import React from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import type { AICopywriterResponse } from '@shared/api.interface';
import type { CopywriterFormValues } from './schema';

interface CopywriterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: UseFormReturn<CopywriterFormValues>;
  result: AICopywriterResponse | null;
  loading: boolean;
  onSubmit: (values: CopywriterFormValues) => void | Promise<void>;
  onApply: () => void;
}

/** AI copywriting assistant: generates English copy from Chinese product input. */
const CopywriterDialog: React.FC<CopywriterDialogProps> = ({
  open,
  onOpenChange,
  form,
  result,
  loading,
  onSubmit,
  onApply,
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-violet-500" />
          AI 文案生成
        </DialogTitle>
      </DialogHeader>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="productNameZh"
            render={({ field }) => (
              <FormItem>
                <FormLabel>商品名称（中文）</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="specs"
            render={({ field }) => (
              <FormItem>
                <FormLabel>规格特点</FormLabel>
                <FormControl>
                  <Textarea rows={2} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="targetMarket"
            render={({ field }) => (
              <FormItem>
                <FormLabel>目标市场</FormLabel>
                <Select value={field.value || 'US'} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="US">美国</SelectItem>
                    <SelectItem value="EU">欧洲</SelectItem>
                    <SelectItem value="UK">英国</SelectItem>
                    <SelectItem value="JP">日本</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {result && (
            <div className="space-y-3 rounded-lg border border-violet-200 bg-violet-50 p-4">
              <div>
                <div className="text-xs font-medium text-violet-700">英文标题</div>
                <div className="mt-1 text-sm">{result.titleEn}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-violet-700">产品卖点</div>
                <ul className="mt-1 list-disc pl-5 text-sm">
                  {result.bulletPoints.map((bp: string) => (
                    <li key={bp}>{bp}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-xs font-medium text-violet-700">长描述</div>
                <div className="mt-1 text-sm">{result.longDescription}</div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
            {result ? (
              <Button type="button" onClick={onApply} className="bg-violet-600 hover:bg-violet-700">
                应用到表单
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={loading}
                className="bg-violet-600 hover:bg-violet-700"
              >
                {loading ? '生成中...' : '生成文案'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </Form>
    </DialogContent>
  </Dialog>
);

export default CopywriterDialog;

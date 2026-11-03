import React from 'react';
import { Loader2, Save, Settings2, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FlowPanel } from '@/components/seller/SellerUI';
import type { AiSettingsView } from '@shared/api.interface';

export interface ProviderPreset {
  label: string;
  baseUrl: string;
  model: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini' },
  { label: '火山方舟', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '' },
];

export interface SettingsFormState {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface ModelSettingsPanelProps {
  zh: boolean;
  settings: AiSettingsView | null;
  form: SettingsFormState;
  saving: boolean;
  testing: boolean;
  testResult: { ok: boolean; message: string } | null;
  onChange: (next: SettingsFormState) => void;
  onSave: () => void;
  onTest: () => void;
  onClearKey: () => void;
}

/** OpenAI-compatible endpoint configuration. Never renders the stored key in clear text. */
const ModelSettingsPanel: React.FC<ModelSettingsPanelProps> = ({
  zh,
  settings,
  form,
  saving,
  testing,
  testResult,
  onChange,
  onSave,
  onTest,
  onClearKey,
}) => (
  <FlowPanel
    title={zh ? '模型设置' : 'Model settings'}
    description={
      zh
        ? '任意 OpenAI 兼容端点；保存即生效，未配置时 AI 端点诚实拒绝'
        : 'Any OpenAI-compatible endpoint; applies on save'
    }
    icon={Settings2}
    bodyClassName="space-y-4"
  >
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {settings?.configured ? (
        <Badge className="bg-emerald-100 text-emerald-700">已配置</Badge>
      ) : (
        <Badge variant="secondary" className="bg-amber-100 text-amber-700">
          未配置
        </Badge>
      )}
      {settings?.source === 'db' && <span className="text-muted-foreground">来源：界面设置</span>}
      {settings?.source === 'env' && (
        <span className="text-muted-foreground">来源：环境变量（引导默认值）</span>
      )}
      {settings?.apiKeyMasked && (
        <span className="text-muted-foreground">当前 Key：{settings.apiKeyMasked}</span>
      )}
    </div>

    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">一键预填：</span>
      {PROVIDER_PRESETS.map((preset) => (
        <Button
          key={preset.label}
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={() => onChange({ ...form, baseUrl: preset.baseUrl, model: preset.model })}
        >
          {preset.label}
        </Button>
      ))}
      <span className="text-xs text-muted-foreground">
        （Key 请使用您自己的账号；也可直接手填任意 OpenAI 兼容端点）
      </span>
    </div>

    <div className="grid gap-3 md:grid-cols-3">
      <div className="space-y-1.5">
        <Label htmlFor="ai-base-url">Base URL</Label>
        <Input
          id="ai-base-url"
          value={form.baseUrl}
          placeholder="https://api.deepseek.com"
          onChange={(e) => onChange({ ...form, baseUrl: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ai-api-key">API Key</Label>
        <Input
          id="ai-api-key"
          type="password"
          value={form.apiKey}
          placeholder="留空不修改；输入新值覆盖"
          onChange={(e) => onChange({ ...form, apiKey: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ai-model">模型名</Label>
        <Input
          id="ai-model"
          value={form.model}
          placeholder="deepseek-chat"
          onChange={(e) => onChange({ ...form, model: e.target.value })}
        />
      </div>
    </div>

    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={onSave} disabled={saving}>
        {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
        保存设置
      </Button>
      <Button size="sm" variant="outline" onClick={onTest} disabled={testing}>
        {testing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Zap className="mr-1 h-4 w-4" />}
        测试连通（使用已保存配置）
      </Button>
      {settings?.apiKeyMasked && (
        <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={onClearKey}>
          清除界面 Key
        </Button>
      )}
    </div>

    {testResult && (
      <p className={`text-sm ${testResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>{testResult.message}</p>
    )}
  </FlowPanel>
);

export default ModelSettingsPanel;

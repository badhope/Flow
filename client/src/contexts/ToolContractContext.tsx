import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getCopilotTools } from '@/api/copilot';
import type { CopilotToolsView } from '@shared/api.interface';

type ToolContract = CopilotToolsView['tools'][number];

/**
 * 工具契约上下文。
 *
 * 审批卡需要知道"这个工具的风险等级 / 中文名"。这份信息此前在前端硬编码了一份
 * `TOOL_META`，与服务端的工具声明各写一遍：服务端把某个动作升级为高风险时，
 * 前端仍会显示成中风险，等于安全标注失效。
 *
 * 现在统一从 `GET /api/copilot/tools` 取（该接口由 copilot-tool-contract 单一投射），
 * 并用一个 Context 缓存，避免每张卡片各发一次请求。
 */
interface ToolContractContextValue {
  contracts: Map<string, ToolContract>;
  loading: boolean;
}

const ToolContractContext = createContext<ToolContractContextValue>({
  contracts: new Map(),
  loading: true,
});

export const ToolContractProvider: React.FC<{
  children: React.ReactNode;
  /**
   * 是否拉取契约。默认 true。
   *
   * 审批卡只出现在卖家工作台；在买家页请求 /api/copilot/tools 会被 RolesGuard
   * 以 403 拒绝，控制台留下一条无法消除的错误。调用方（app.tsx）按路由传入，
   * 而本组件不直接依赖 react-router —— 这样它在测试与故事书里也能独立渲染。
   */
  enabled?: boolean;
}> = ({ children, enabled = true }) => {
  const [contracts, setContracts] = useState<Map<string, ToolContract>>(new Map());
  const [loading, setLoading] = useState(!enabled);
  const needsContracts = enabled;

  useEffect(() => {
    if (!needsContracts) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const view = await getCopilotTools();
        if (cancelled) return;
        setContracts(new Map(view.tools.map((t) => [t.name, t])));
      } catch {
        // 拿不到契约时保持空表：审批卡会回退到保守的 medium，不会误标为 low
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [needsContracts]);

  const value = useMemo(() => ({ contracts, loading }), [contracts, loading]);
  return <ToolContractContext.Provider value={value}>{children}</ToolContractContext.Provider>;
};

/** 读取单个工具的契约；未加载/未知时返回 undefined，调用方必须给出保守回退 */
export function useToolContract(name: string): ToolContract | undefined {
  const { contracts } = useContext(ToolContractContext);
  return contracts.get(name);
}

export function useToolContractsLoading(): boolean {
  return useContext(ToolContractContext).loading;
}

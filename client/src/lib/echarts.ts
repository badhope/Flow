/**
 * ECharts 按需引入（替代全量 import 'echarts'，Dashboard chunk 1.14MB -> ~400KB 级）。
 * 只注册本项目用到的能力：折线/饼图 + 提示框/图例/网格/坐标轴 + Canvas 渲染。
 * echarts-for-react 的 Core 组件接受注入的 echarts 对象（需 init/getInstanceByDom），
 * 避免其默认入口 `import * as echarts from 'echarts'` 把全量包拉进 chunk。
 * 新增图表类型时在此追加 use([...])，不要在页面里 import 'echarts' 全量包。
 */
import * as echarts from 'echarts/core';
import { LineChart, PieChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export default echarts;
export { echarts };

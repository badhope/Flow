import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  server: {
    port: Number(process.env.CLIENT_PORT ?? 5173),
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.PORT ?? 3000}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    // 输出到仓库根 dist/：与服务端 dist-server/ 并列，便于单进程托管与 Docker 拷贝
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        // 第三方运行时按用途拆分，避免单个超大 chunk 拖慢首屏
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@radix-ui')) return 'vendor-radix';
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/react-router') ||
            id.includes('/scheduler/')
          ) {
            return 'vendor-react';
          }
          // ECharts 独立分包：只有卖家看板异步加载它，独立缓存避免发版失效
          if (id.includes('/echarts') || id.includes('zrender') || id.includes('size-sensor')) {
            return 'vendor-echarts';
          }
          return undefined;
        },
      },
    },
  },
});

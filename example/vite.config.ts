import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const mcTarget = process.env.VITE_MC_TARGET || env.VITE_MC_TARGET || 'http://localhost:8080';
  const mcApiToken = process.env.MC_API_TOKEN || env.MC_API_TOKEN;
  const mcAuthHeader = mcApiToken
    ? `Basic ${Buffer.from(`token:${mcApiToken}`).toString('base64')}`
    : undefined;

  return {
    plugins: [react()],
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
      exclude: ['@flanksource/mission-control-sdk'],
    },
    server: {
      port: 5173,
      proxy: {
        // The demo app uses SDK proxy mode by default:
        //   /api/mission-control/api/plugins/...
        // This rewrites it to Mission Control's native:
        //   /api/plugins/...
        '/api/mission-control': {
          target: mcTarget,
          changeOrigin: true,
          secure: false,
          rewrite: path => path.replace(/^\/api\/mission-control/, ''),
          configure: proxy => {
            proxy.on('proxyReq', proxyReq => {
              // Proxy mode should use backend/service auth, not browser MC cookies.
              proxyReq.removeHeader('cookie');
              proxyReq.removeHeader('authorization');

              if (mcAuthHeader) {
                proxyReq.setHeader('authorization', mcAuthHeader);
              }
            });
          },
        },
      },
    },
  };
});

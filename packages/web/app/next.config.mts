import bundleAnalyzer from '@next/bundle-analyzer';
import { fileURLToPath } from 'url';
import { join } from 'path';

// For the dev server we want to make sure that the correct environment variables are set :)
// during build we don't need environment variables!
if (globalThis.process.env.BUILD !== '1') {
  await import('./environment');
}

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === '1',
  openAnalyzer: true,
});

export default withBundleAnalyzer({
  poweredByHeader: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    // next doesn't need to check because typecheck command will
    // also next reports false positives (try it...)
    ignoreBuildErrors: true,
  },
  output: 'standalone',
  experimental: {
    outputFileTracingRoot: join(__dirname, '../../../'),
  },
  redirects: async () => [
    // Redirect organization routes
    {
      source: '/:orgId/subscription/manage',
      destination: '/:orgId/subscription',
      permanent: true,
    },
  ],
});

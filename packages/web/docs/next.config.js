import { withGuildDocs } from '@theguild/components/next.config';
import { fileURLToPath } from 'url';
import { join } from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default withGuildDocs({
  eslint: {
    ignoreDuringBuilds: true,
  },
  output: 'standalone',
  experimental: {
    outputFileTracingRoot: join(__dirname, '../../../'),
  },
});

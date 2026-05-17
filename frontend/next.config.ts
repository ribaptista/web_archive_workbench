import type { NextConfig } from 'next';

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:5050';

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${BACKEND}/api/:path*` }];
  },
};

export default nextConfig;

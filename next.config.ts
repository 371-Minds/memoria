import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'picsum.photos', port: '', pathname: '/**' }],
  },
  output: 'standalone',
  // better-sqlite3 is a native module: it must be required at runtime instead of
  // being bundled, or the prebuilt binary is copied into a chunk that cannot load it.
  serverExternalPackages: ['better-sqlite3'],
  // experimental.esmExternals was removed: Next warns that it may break module
  // resolution, and nothing here needs it.
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pass empty turbopack object to silence Vercel Turbopack build error
  experimental: {
    serverComponentsExternalPackages: ['@xenova/transformers', '@ffmpeg/ffmpeg'],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ];
  },
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
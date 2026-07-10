/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@debate/shared", "@debate/ai", "@debate/db", "@debate/editor"],
  // 允许局域网设备访问 dev server 的跨源资源（HMR 等）。
  // 常见私有网段；如你的网段不同，可在 LAN_DEV_ORIGIN 环境变量里补充本机 IP。
  allowedDevOrigins: [
    "192.168.0.0/16",
    "10.0.0.0/8",
    "172.16.0.0/12",
    ...(process.env.LAN_DEV_ORIGIN ? [process.env.LAN_DEV_ORIGIN] : [])
  ]
};

export default nextConfig;

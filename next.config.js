/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  i18n: {
    locales: ["en"],
    defaultLocale: "en",
  },
  env: {
    REACT_APP_GITHUB_URL: process.env.REACT_APP_GITHUB_URL,
    REACT_APP_LEETCODE_URL: process.env.REACT_APP_LEETCODE_URL,
    REACT_APP_INSTAGRAM_URL: process.env.REACT_APP_INSTAGRAM_URL,
  },
}

module.exports = nextConfig

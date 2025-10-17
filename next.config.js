const path = require('path');

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
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      zustand: path.resolve(__dirname, 'src/vendor/zustand'),
      'react-rnd': path.resolve(__dirname, 'src/vendor/react-rnd'),
      'framer-motion': path.resolve(__dirname, 'src/vendor/framer-motion'),
      localforage: path.resolve(__dirname, 'src/vendor/localforage'),
    };
    return config;
  },
};

module.exports = nextConfig;

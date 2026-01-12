// @ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
    // Enable React strict mode
    reactStrictMode: true,

    // Disable image optimization for offline support
    images: {
        unoptimized: true,
    },

    // Add empty turbopack config
    turbopack: {},
};

module.exports = nextConfig;

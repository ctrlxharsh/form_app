// @ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
    // Enable React strict mode
    reactStrictMode: true,
    // Use environment variable for basePath, or default to empty string (root)
    basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',

    // Disable image optimization for offline support
    images: {
        unoptimized: true,
    },

    // Add empty turbopack config
    turbopack: {},
};

const withPWA = require("@ducanh2912/next-pwa").default({
    dest: "public",
    cacheOnFrontEndNav: true,
    aggressiveFrontEndNavCaching: true,
    reloadOnOnline: true,
    disable: false, // Enable in dev too if you want to test, otherwise process.env.NODE_ENV === "development"
    workboxOptions: {
        disableDevLogs: true,
    },
});

module.exports = withPWA(nextConfig);

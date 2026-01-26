import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

    return {
        name: 'PiJam Assessment',
        short_name: 'PiJam',
        description: 'Submit and complete assessments offline or online',
        start_url: `${basePath}/`,
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ff4b4b',
        orientation: 'portrait-primary',
        icons: [
            {
                src: `${basePath}/icon-192.png`,
                sizes: '192x192',
                type: 'image/png',
                purpose: 'any'
            },
            {
                src: `${basePath}/icon-512.png`,
                sizes: '512x512',
                type: 'image/png',
                purpose: 'any'
            }
        ]
    };
}

import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

    return {
        name: 'PiJam Assessment Portal',
        short_name: 'PiJam',
        description: 'Submit and complete assessments offline or online',
        start_url: `${basePath}/`,
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ff4b4b',
        orientation: 'portrait-primary',
        icons: [
            {
                src: `${basePath}/pijamLogo.svg`,
                sizes: 'any',
                type: 'image/svg+xml',
                purpose: 'any'
            },
            {
                src: `${basePath}/pijamLogo.svg`,
                sizes: '192x192',
                type: 'image/svg+xml',
                purpose: 'any'
            },
            {
                src: `${basePath}/pijamLogo.svg`,
                sizes: '512x512',
                type: 'image/svg+xml',
                purpose: 'any'
            }
        ]
    };
}



const { neon } = require('@neondatabase/serverless');

async function testConnection() {
    console.log('Testing DB connection...');
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error('DATABASE_URL is not defined');
        return;
    }
    console.log('URL found (masked):', url.replace(/:[^:]+@/, ':****@'));

    try {
        const sql = neon(url);
        const result = await sql`SELECT NOW()`;
        console.log('Connection successful!');
        console.log('Server time:', result[0]);
    } catch (error) {
        console.error('Connection failed:', error);
        if (error.cause) console.error('Cause:', error.cause);
    }
}

testConnection();


const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

// Read .env.local
const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const dbUrlMatch = envContent.match(/DATABASE_URL=(.+)/);
const dbUrl = dbUrlMatch ? dbUrlMatch[1].trim().replace(/^"|"$/g, '') : null;

if (!dbUrl) {
    console.error('DATABASE_URL not found in .env.local');
    process.exit(1);
}

const sql = postgres(dbUrl, { ssl: 'require' });

async function checkMapping() {
    try {
        const school = await sql`SELECT school_id, school_name, udise_code FROM schools WHERE udise_code = '27251400303'`;
        console.log('School for UDISE 27251400303:', JSON.stringify(school, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        await sql.end();
    }
}

checkMapping();

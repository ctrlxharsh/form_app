
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const dbUrlMatch = envContent.match(/DATABASE_URL=(.+)/);
const dbUrl = dbUrlMatch ? dbUrlMatch[1].trim().replace(/^"|"$/g, '') : null;

const sql = postgres(dbUrl, { ssl: 'require' });

async function getSubmissionsSchema() {
    try {
        const res = await sql`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'submissions'
            ORDER BY ordinal_position
        `;
        console.log(JSON.stringify(res, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        await sql.end();
    }
}

getSubmissionsSchema();

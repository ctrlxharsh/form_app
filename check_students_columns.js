
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

async function main() {
    const envPath = path.join(__dirname, '.env.local');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const dbUrlMatch = envContent.match(/DATABASE_URL=(.+)/);
    const dbUrl = dbUrlMatch ? dbUrlMatch[1].trim().replace(/^"|"$/g, '') : null;
    const sql = postgres(dbUrl, { ssl: 'require' });

    try {
        const columns = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'students'`;
        console.log('--- Students Columns ---');
        console.log(columns.map(c => c.column_name).join(', '));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
main();


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
        const columns = await sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('teacher_schools', 'students', 'schools')`;
        console.log(JSON.stringify(columns, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
main();

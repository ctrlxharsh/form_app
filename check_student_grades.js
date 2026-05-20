const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const dbUrlMatch = envContent.match(/DATABASE_URL=(.+)/);
const dbUrl = dbUrlMatch ? dbUrlMatch[1].trim().replace(/^"|"$/g, '') : null;

const sql = postgres(dbUrl, { ssl: 'require' });

async function run() {
    try {
        const res = await sql`SELECT class_grade, COUNT(*) FROM students GROUP BY class_grade ORDER BY class_grade`;
        console.log('Distinct class_grade values and counts:', res);
        
        const res2 = await sql`SELECT class, COUNT(*) FROM students GROUP BY class ORDER BY class`;
        console.log('Distinct class (integer) values and counts:', res2);
    } catch (err) {
        console.error(err);
    }
    await sql.end();
}

run();

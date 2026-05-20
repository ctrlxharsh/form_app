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
        console.log('Testing integer comparison:');
        const res1 = await sql`SELECT student_id, first_name, class_grade FROM students WHERE class_grade = ${6} LIMIT 2`;
        console.log('Integer query succeeded!', res1);
    } catch (err) {
        console.error('Integer query failed:', err.message);
    }

    try {
        console.log('Testing string comparison:');
        const res2 = await sql`SELECT student_id, first_name, class_grade FROM students WHERE class_grade = ${'6'} LIMIT 2`;
        console.log('String query succeeded!', res2);
    } catch (err) {
        console.error('String query failed:', err.message);
    }

    await sql.end();
}

run();

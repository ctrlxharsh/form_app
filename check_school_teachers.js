
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

async function checkTeacherForSchool() {
    try {
        const teachers = await sql`
            SELECT ts.teacher_id, u.full_name
            FROM teacher_schools ts
            JOIN users u ON ts.teacher_id = u.user_id
            WHERE ts.school_id = 352
        `;
        console.log('Teachers for School 352:', JSON.stringify(teachers, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        await sql.end();
    }
}

checkTeacherForSchool();

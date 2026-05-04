
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

async function main() {
    const envPath = path.join(__dirname, '.env.local');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const dbUrlMatch = envContent.match(/DATABASE_URL=(.+)/);
    const dbUrl = dbUrlMatch ? dbUrlMatch[1].trim().replace(/^"|"$/g, '') : null;
    
    if (!dbUrl) {
        console.error('DATABASE_URL not found');
        process.exit(1);
    }

    const sql = postgres(dbUrl, { ssl: 'require' });

    try {
        const mappings = await sql`SELECT teacher_id, COUNT(school_id) as school_count FROM teacher_schools GROUP BY teacher_id LIMIT 10`;
        const studentCounts = await sql`SELECT school_id, COUNT(*) as student_count FROM students GROUP BY school_id ORDER BY student_count DESC LIMIT 10`;
        const teachers = await sql`SELECT user_id, full_name, role FROM users WHERE role = 'Teacher' LIMIT 5`;

        console.log('--- Teacher Mappings ---');
        console.table(mappings);
        
        console.log('\n--- Student Counts per School ---');
        console.table(studentCounts);

        console.log('\n--- Sample Teachers ---');
        console.table(teachers);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

main();

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
        console.log('Creating index idx_students_school_id...');
        await sql`CREATE INDEX IF NOT EXISTS idx_students_school_id ON students(school_id)`;
        
        console.log('Creating index idx_students_class_grade...');
        await sql`CREATE INDEX IF NOT EXISTS idx_students_class_grade ON students(class_grade)`;
        
        console.log('Indexes created successfully!');
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
main();


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

async function checkStudents() {
    try {
        const count = await sql`SELECT COUNT(*) FROM students`;
        console.log('Student Count:', count[0].count);
        
        const firstFew = await sql`SELECT * FROM students LIMIT 5`;
        console.log('First 5 students:', JSON.stringify(firstFew, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        await sql.end();
    }
}

checkStudents();

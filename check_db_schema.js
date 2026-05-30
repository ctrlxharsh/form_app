const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

async function main() {
    const envPath = path.join(__dirname, '.env.local');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const dbUrlMatch = envContent.match(/DATABASE_URL="?([^"\n]+)"?/);
    const dbUrl = dbUrlMatch ? dbUrlMatch[1].trim() : null;
    const sql = postgres(dbUrl, { ssl: 'require' });

    try {
        // Query class_grades for school 348
        const r1 = await sql`
            SELECT student_id, first_name, class_grade, pg_typeof(class_grade) as type 
            FROM students 
            WHERE school_id = 348
            LIMIT 5
        `;
        console.log('=== Students in school 348 ===');
        console.log(r1);

        // Try comparing class_grade to a string
        const r2 = await sql`
            SELECT COUNT(*) as count 
            FROM students 
            WHERE school_id = 348 AND class_grade = '7'
        `;
        console.log("\nComparison with string '7' count:", r2[0].count);

        // Try comparing class_grade to an integer
        const r3 = await sql`
            SELECT COUNT(*) as count 
            FROM students 
            WHERE school_id = 348 AND class_grade = ${7}::text
        `;
        console.log("Comparison with integer cast to text count:", r3[0].count);

        process.exit(0);
    } catch (err) {
        console.error('ERROR:', err);
        process.exit(1);
    }
}
main();

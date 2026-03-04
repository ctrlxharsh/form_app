const { neon } = require('@neondatabase/serverless');
const fs = require('fs');

const envLocal = fs.readFileSync('.env.local', 'utf8');
const match = envLocal.match(/DATABASE_URL="([^"]+)"/);
if (!match) throw new Error("No URL");

const sql = neon(match[1]);

async function run() {
    try {
        const res = await sql`SELECT 1`;
        console.log("Success!");
    } catch (e) {
        console.error("Error connecting to DB:", e);
    }
}
run();

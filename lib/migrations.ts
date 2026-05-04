
import { sql } from './postgres';

export async function createStudentsTable() {
    try {
        await sql`
            CREATE TABLE IF NOT EXISTS students (
                student_id SERIAL PRIMARY KEY,
                unique_id VARCHAR(50) UNIQUE NOT NULL,
                cohort_id VARCHAR(50),
                full_name VARCHAR(255) NOT NULL,
                father_name VARCHAR(255),
                mother_name VARCHAR(255),
                school_id INTEGER REFERENCES schools(school_id),
                class_grade INTEGER,
                section VARCHAR(10),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;
        console.log('Students table created or already exists');
    } catch (error) {
        console.error('Error creating students table:', error);
    }
}

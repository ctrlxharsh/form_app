/**
 * PostgreSQL Client using Neon Serverless Driver
 * 
 * This module provides database access for API routes.
 * Uses @neondatabase/serverless for optimized connections to Neon PostgreSQL.
 */

import { neon } from '@neondatabase/serverless';

// Create a SQL query function connected to Neon
const sql = neon(process.env.DATABASE_URL!);

export { sql };

// ============ FORM QUERIES ============
// These mirror the original Streamlit queries from pages/assessments/db.py

/**
 * Get complete assessment with sections, questions, and options
 * Mirrors: get_full_assessment() from Streamlit
 */
export async function getFullAssessment(assessmentId: number) {
  // Get assessment base info
  const assessments = await sql`
    SELECT assessment_id, title, description, class_grade, status, language, group_identifier, academic_year
    FROM assessments
    WHERE assessment_id = ${assessmentId}
  `;

  if (assessments.length === 0) {
    return null;
  }

  const assessment = assessments[0];

  // Get sections
  const sections = await sql`
    SELECT section_id, section_title, section_instructions, order_index
    FROM assessment_sections
    WHERE assessment_id = ${assessmentId}
    ORDER BY order_index
  `;

  // For each section, get questions and options
  for (const section of sections) {
    const questions = await sql`
      SELECT question_id, question_type, question_text, question_image_url,
             marks, is_required, order_index, correct_answer, min_value, max_value, parameter_mapping
      FROM questions
      WHERE section_id = ${section.section_id}
      ORDER BY order_index
    `;

    // Get options for MCQ/multiple_select/ranking questions
    for (const question of questions) {
      if (['mcq', 'multiple_select', 'ranking'].includes(question.question_type)) {
        const options = await sql`
          SELECT option_id, option_text, option_image_url, is_correct, order_index, marks
          FROM question_options
          WHERE question_id = ${question.question_id}
          ORDER BY order_index
        `;
        question.options = options;
      } else {
        question.options = [];
      }
    }

    section.questions = questions;
  }

  assessment.sections = sections;
  return assessment;
}

/**
 * Get published assessments for a class
 * Mirrors: get_published_assessments_by_class() from Streamlit
 */
export async function getPublishedAssessmentsByClass(classGrade: number) {
  return sql`
    SELECT assessment_id, title, description, class_grade, language, group_identifier, academic_year
    FROM assessments
    WHERE status = 'published' AND class_grade = ${classGrade}
    ORDER BY title
  `;
}

/**
 * Get all published assessments (for landing page)
 */
export async function getAllPublishedAssessments() {
  return sql`
    SELECT assessment_id, title, description, class_grade, language, group_identifier, academic_year
    FROM assessments
    WHERE status = 'published'
    ORDER BY class_grade, title
  `;
}

// ============ SCHOOL QUERIES ============
// These mirror the original Streamlit queries from pages/schools/db.py

/**
 * Get all schools
 * Used for syncing complete schools table to IndexedDB
 */
export async function getAllSchools() {
  return sql`
    SELECT school_id, school_name, udise_code, local_education_admin,
           state, district, intervention
    FROM schools
    ORDER BY school_name
  `;
}

/**
 * Get schools by intervention type
 * Mirrors: get_schools_by_intervention() from Streamlit
 */
export async function getSchoolsByIntervention(intervention: string) {
  return sql`
    SELECT school_id, school_name, udise_code, local_education_admin,
           state, district, intervention
    FROM schools
    WHERE intervention = ${intervention}
    ORDER BY school_name
  `;
}

/**
 * Validate school ID matches UDISE code
 * Mirrors: validate_school_udise() from Streamlit
 */
export async function validateSchoolUdise(schoolId: number, udiseCode: string) {
  const result = await sql`
    SELECT 1 FROM schools WHERE school_id = ${schoolId} AND udise_code = ${udiseCode}
  `;
  return result.length > 0;
}

// ============ SUBMISSION QUERIES ============
// These mirror the original Streamlit queries from pages/submit/db.py

/**
 * Create a new submission
 * Mirrors: create_submission() from Streamlit
 */
export async function createSubmission(
  assessmentId: number,
  schoolId: number,
  studentFirstName: string,
  studentLastName: string,
  gender: string,
  classGrade: number,
  section: string,
  selectedLanguage: string,
  geolocation: string | null = null,
  ipAddress: string | null = null
) {
  const studentName = `${studentFirstName} ${studentLastName}`;
  const result = await sql`
    INSERT INTO submissions (assessment_id, school_id, student_first_name, student_last_name, student_name, gender, class_grade, section, selected_language, geolocation, ip_address)
    VALUES (${assessmentId}, ${schoolId}, ${studentFirstName}, ${studentLastName}, ${studentName}, ${gender}, ${classGrade}, ${section}, ${selectedLanguage}, ${geolocation}, ${ipAddress})
    RETURNING submission_id
  `;
  return result[0];
}

/**
 * Save an answer for a question
 * Mirrors: save_answer() from Streamlit
 */
export async function saveAnswer(
  submissionId: number,
  questionId: number,
  answerText: string | null = null,
  answerImageUrl: string | null = null,
  selectedOptions: number[] | null = null,
  rankingOrder: number[] | null = null
) {
  await sql`
    INSERT INTO submission_answers (submission_id, question_id, answer_text, answer_image_url, selected_options, ranking_order)
    VALUES (${submissionId}, ${questionId}, ${answerText}, ${answerImageUrl}, ${selectedOptions}, ${rankingOrder})
  `;
}

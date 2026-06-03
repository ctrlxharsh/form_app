/**
 * PostgreSQL Client - Standard TCP Driver
 *
 * Uses the 'postgres' package (standard TCP/SSL) for compatibility with
 * DigitalOcean managed PostgreSQL and any standard PostgreSQL host.
 * Previously used @neondatabase/serverless (HTTP-only, Neon-specific).
 */

import postgres from 'postgres';

// Create a pooled SQL client. ssl: 'require' matches ?sslmode=require in the URL.
const client = postgres(process.env.DATABASE_URL!, {
    ssl: 'require',
    max: 10,           // Max pool connections
    idle_timeout: 20,  // Close idle connections after 20s
    connect_timeout: 10,
});

/**
 * Tagged-template SQL function — drop-in replacement for neon`...`.
 * Returns an array of rows, matching the neon driver's interface.
 */
export const sql = client;

export { client };

// ============ FORM QUERIES ============
// These mirror the original Streamlit queries from pages/assessments/db.py

/**
 * Get complete assessment with sections, questions, and options
 * Mirrors: get_full_assessment() from Streamlit
 */
export async function getFullAssessment(assessmentId: number) {
  // Get assessment base info
  const assessments = await sql`
    SELECT assessment_id, title, description, class_grade, status, language, group_identifier, academic_year, total_marks
    FROM assessments
    WHERE assessment_id = ${assessmentId}
  `;

  if (assessments.length === 0) {
    return null;
  }

  const assessment = assessments[0];

  // Fetch sections, questions, and options in parallel (3 queries instead of N+1)
  const [sections, allQuestions, allOptions] = await Promise.all([
    sql`
      SELECT section_id, section_title, section_instructions, order_index
      FROM assessment_sections
      WHERE assessment_id = ${assessmentId}
      ORDER BY order_index
    `,
    sql`
      SELECT q.question_id, q.section_id, q.question_type, q.question_text, q.question_image_url,
             q.marks, q.is_required, q.order_index, q.correct_answer, q.min_value, q.max_value, q.parameter_mapping
      FROM questions q
      JOIN assessment_sections s ON q.section_id = s.section_id
      WHERE s.assessment_id = ${assessmentId}
      ORDER BY q.order_index
    `,
    sql`
      SELECT qo.option_id, qo.question_id, qo.option_text, qo.option_image_url, qo.is_correct, qo.order_index, qo.marks
      FROM question_options qo
      JOIN questions q ON qo.question_id = q.question_id
      JOIN assessment_sections s ON q.section_id = s.section_id
      WHERE s.assessment_id = ${assessmentId}
      ORDER BY qo.order_index
    `
  ]);

  // Index options by question_id
  const optionsByQuestion = new Map<number, any[]>();
  for (const opt of allOptions) {
    const qId = opt.question_id;
    if (!optionsByQuestion.has(qId)) optionsByQuestion.set(qId, []);
    optionsByQuestion.get(qId)!.push(opt);
  }

  // Index questions by section_id and attach options
  const questionsBySection = new Map<number, any[]>();
  for (const q of allQuestions) {
    q.options = optionsByQuestion.get(q.question_id) || [];
    const sId = q.section_id;
    if (!questionsBySection.has(sId)) questionsBySection.set(sId, []);
    questionsBySection.get(sId)!.push(q);
  }

  // Attach questions to sections
  for (const section of sections) {
    section.questions = questionsBySection.get(section.section_id) || [];
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
    WHERE status = 'published' AND is_active = true AND class_grade = ${classGrade}
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
    WHERE status = 'published' AND is_active = true
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
    state, district, intervention, is_active
    FROM schools
    WHERE is_active = true
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
    state, district, intervention, is_active
    FROM schools
    WHERE intervention = ${intervention} AND is_active = true
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
  ipAddress: string | null = null,
  submittedByTeacher: number | null = null,
  marksObtained: number | null = null,
  totalMarks: number | null = null,
  clientSubmissionId: string | null = null,
  status: string = 'pending',
  deviceInfo: any = null,
  studentId: number | null = null
) {
  const studentName = `${studentFirstName} ${studentLastName} `;

  // Use upsert if clientSubmissionId is provided
  if (clientSubmissionId) {
    const result = await sql`
      INSERT INTO submissions(
        assessment_id, school_id, student_first_name, student_last_name, student_name, 
        gender, class_grade, section, selected_language, geolocation, ip_address, 
        submitted_by_teacher, marks_obtained, total_marks, client_submission_id, status, device_info, student_id
      )
      VALUES(
        ${assessmentId}, ${schoolId}, ${studentFirstName}, ${studentLastName}, ${studentName}, 
        ${gender}, ${classGrade}, ${section}, ${selectedLanguage}, ${geolocation}, ${ipAddress}, 
        ${submittedByTeacher}, ${marksObtained}, ${totalMarks}, ${clientSubmissionId}, ${status}, ${deviceInfo ? JSON.stringify(deviceInfo) : null}, ${studentId}
      )
      ON CONFLICT (client_submission_id) 
      DO UPDATE SET
        assessment_id = EXCLUDED.assessment_id,
        school_id = EXCLUDED.school_id,
        student_first_name = EXCLUDED.student_first_name,
        student_last_name = EXCLUDED.student_last_name,
        student_name = EXCLUDED.student_name,
        gender = EXCLUDED.gender,
        class_grade = EXCLUDED.class_grade,
        section = EXCLUDED.section,
        selected_language = EXCLUDED.selected_language,
        geolocation = EXCLUDED.geolocation,
        ip_address = EXCLUDED.ip_address,
        submitted_by_teacher = EXCLUDED.submitted_by_teacher,
        marks_obtained = EXCLUDED.marks_obtained,
        total_marks = EXCLUDED.total_marks,
        status = EXCLUDED.status,
        device_info = EXCLUDED.device_info,
        student_id = EXCLUDED.student_id,
        submitted_at = NOW() -- Update timestamp on re-submit
      RETURNING submission_id, (xmax = 0) AS is_insert
    `;

    const row = result[0];
    // If it was an update (is_insert is false), clear old answers to ensure fresh state
    if (!row.is_insert) {
      await sql`DELETE FROM submission_answers WHERE submission_id = ${row.submission_id}`;
    }

    return row;
  } else {
    // Legacy behavior for submissions without client ID
    const result = await sql`
      INSERT INTO submissions(
        assessment_id, school_id, student_first_name, student_last_name, student_name, 
        gender, class_grade, section, selected_language, geolocation, ip_address, 
        submitted_by_teacher, marks_obtained, total_marks, status, device_info, student_id
      )
      VALUES(
        ${assessmentId}, ${schoolId}, ${studentFirstName}, ${studentLastName}, ${studentName}, 
        ${gender}, ${classGrade}, ${section}, ${selectedLanguage}, ${geolocation}, ${ipAddress}, 
        ${submittedByTeacher}, ${marksObtained}, ${totalMarks}, ${status}, ${deviceInfo ? JSON.stringify(deviceInfo) : null}, ${studentId}
      )
      RETURNING submission_id
    `;
    return result[0];
  }
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
  rankingOrder: number[] | null = null,
  marksAwarded: number | null = null
) {
  const result = await sql`
    INSERT INTO submission_answers(submission_id, question_id, answer_text, answer_image_url, selected_options, ranking_order, marks_awarded)
  VALUES(${submissionId}, ${questionId}, ${answerText}, ${answerImageUrl}, ${selectedOptions}, ${rankingOrder}, ${marksAwarded})
    RETURNING answer_id
    `;
  return result[0]?.answer_id;
}

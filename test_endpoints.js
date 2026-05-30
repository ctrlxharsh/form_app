const http = require('http');

async function testUrl(url) {
    return new Promise((resolve) => {
        const start = Date.now();
        http.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({
                        status: res.statusCode,
                        time: Date.now() - start,
                        size: data.length,
                        count: Array.isArray(json) ? json.length : (json.submissions ? json.submissions.length : 'N/A')
                    });
                } catch (e) {
                    resolve({
                        status: res.statusCode,
                        time: Date.now() - start,
                        size: data.length,
                        error: e.message,
                        preview: data.substring(0, 200)
                    });
                }
            });
        }).on('error', (err) => {
            resolve({ error: err.message, time: Date.now() - start });
        });
    });
}

async function main() {
    console.log('=== TESTING API ENDPOINTS ON LOCALHOST:3000 ===');
    
    // Test schools endpoint
    const schoolsRes = await testUrl('http://localhost:3000/api/schools?userId=224&role=Teacher');
    console.log('/api/schools (Teacher):', schoolsRes);

    // Test students endpoint (Teacher)
    const studentsRes = await testUrl('http://localhost:3000/api/students?teacherId=224&role=Teacher');
    console.log('/api/students (Teacher):', studentsRes);

    // Test students endpoint (M&E)
    const studentsMERes = await testUrl('http://localhost:3000/api/students?teacherId=1&role=M%26E');
    console.log('/api/students (M&E):', studentsMERes);

    // Test grading endpoint (Teacher 191)
    const gradingRes = await testUrl('http://localhost:3000/api/grading?teacherId=191&status=pending');
    console.log('/api/grading (Teacher 191):', gradingRes);

    // Test grading endpoint (M&E)
    const gradingMERes = await testUrl('http://localhost:3000/api/grading?teacherId=1&status=pending');
    console.log('/api/grading (M&E):', gradingMERes);

    process.exit(0);
}
main();

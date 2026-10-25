
const Resume = require("../models/Resume");
const groq = require("../config/groq");
const fs = require("fs/promises");
const pdf = require("pdf-parse");

exports.upload = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        message: "No resume file uploaded",
      });
    }

    // Extract text from the uploaded PDF
    const dataBuffer = await fs.readFile(req.file.path);
    const data = await pdf(dataBuffer);
    const resumeText = data.text;

    if (!resumeText.trim()) {
      return res.status(400).json({
        message: "Could not extract text from the PDF",
      });
    }

    // Get the target role
    const role = (req.body.role || "").trim() || "General";

    // Analyze the resume using Groq
    const response = await groq.responses.create({
      model: "openai/gpt-oss-20b",
      instructions: `
You are an expert ATS resume analyzer and technical recruiter.

Evaluate the resume for the target role: ${role}.

Review:
- Relevance of skills and projects to the target role.
- Project depth, technologies, responsibilities, and measurable impact.
- Missing skills and weaknesses.
- Grammar, formatting, and ATS compatibility.

Scoring rules:
- All four scores must be whole numbers from 0 to 100.
- 85-100: Exceptional.
- 70-84: Strong.
- 55-69: Average.
- 40-54: Weak.
- 0-39: Major improvements needed.
- A typical decent resume should score 55-75.
- Reserve scores above 90 for near-perfect resumes.
- Score each category fairly and independently.

Return a single JSON object with exactly these fields:
{
  "overallScore": 0,
  "atsScore": 0,
  "grammarScore": 0,
  "formattingScore": 0,
  "missingSkills": [],
  "strengths": [],
  "weaknesses": [],
  "projectReview": "",
  "resumeSuggestions": []
}

Use numbers for scores, arrays of strings for list fields,
and strings for projectReview.
Do not include markdown or additional text.
`,
      input: resumeText,
      text: {
        format: {
          type: "json_object",
        },
      },
      temperature: 0,
    });

    // Convert the JSON text into a JavaScript object
    const analysis = JSON.parse(response.output_text);

    // Save the resume and its analysis
    await Resume.create({
      userId: req.user._id,
      extractedResumeText: resumeText,
      analysis,
    });

    // Return the analysis to the frontend
    return res.json({ analysis });
  } catch (err) {
    console.error("Resume analysis failed:", err);

    return res.status(500).json({
      message: "Resume analysis failed. Please try again.",
    });
  } finally {
    // Delete the temporary uploaded file
    if (req.file?.path) {
      fs.unlink(req.file.path).catch((err) => {
        console.error("Failed to delete uploaded file:", err.message);
      });
    }
  }
};

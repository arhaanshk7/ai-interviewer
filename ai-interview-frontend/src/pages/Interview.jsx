import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

const ROLES = [
  "Frontend Developer",
  "Backend Developer",
  "Full Stack Developer",
  "Data Scientist",
  "Data Analyst",
  "ML Engineer",
  "DevOps Engineer",
  "Cloud Engineer",
  "AI Engineer",
  "Cybersecurity Analyst",
];

function Interview() {
  const [file, setFile] = useState(null);
  const [role, setRole] = useState("");
  const navigate = useNavigate();

  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  };

  const handleStartInterview = () => {
    if (!file || !role) return;

    navigate("/ai-interview/room", {
      state: {
        role,
        resume: file,
      },
    });
  };

  return (
    <div className="min-h-screen bg-gray-100 py-10 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-3xl shadow-xl overflow-hidden">

        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-purple-700 text-white p-8">
          <h1 className="text-4xl font-bold">AI Mock Interview</h1>
          <p className="mt-2 text-purple-100">
            Upload your resume and select a target role to begin a live
            1-on-1 interview with AI.
          </p>
        </div>

        {/* Form */}
        <div className="p-8 space-y-8">

          {/* Resume Upload */}
          <div>
            <label className="block text-lg font-semibold text-gray-700 mb-3">
              📄 Upload Your Resume
            </label>

            <input
              type="file"
              accept=".pdf"
              hidden
              ref={fileInputRef}
              onChange={handleFileChange}
            />

            <div
              onClick={() => fileInputRef.current.click()}
              className="border-2 border-dashed border-purple-400 rounded-xl p-8 text-center cursor-pointer hover:bg-purple-50 transition"
            >
              <h3 className="text-lg font-semibold text-gray-700">
                Click to Select Resume
              </h3>

              <p className="text-gray-500 mt-1">
                Only PDF files are allowed
              </p>
            </div>

            {file && (
              <div className="mt-4 bg-green-50 border border-green-300 rounded-lg p-4">
                <p className="font-medium text-green-700">
                  ✅ {file.name}
                </p>

                <p className="text-sm text-gray-600 mt-1">
                  Size: {(file.size / 1024).toFixed(2)} KB
                </p>
              </div>
            )}
          </div>

          {/* Role Selection */}
          <div>
            <label className="block text-lg font-semibold text-gray-700 mb-3">
              🎯 Select Target Role
            </label>

            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-5 py-4 text-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
            >
              <option value="">-- Choose a role --</option>

              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {/* Start Button */}
          <button
            onClick={handleStartInterview}
            disabled={!file || !role}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white py-4 rounded-xl transition duration-300 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Start Interview
          </button>

        </div>
      </div>
    </div>
  );
}

export default Interview;
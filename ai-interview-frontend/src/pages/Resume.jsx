import { useRef,useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

function Resume() {

  const [warning, setWarning] = useState("");

  useEffect(() => {

      const message = sessionStorage.getItem(
          "warningMessage"
      );

      if(message){

          setWarning(message);

          sessionStorage.removeItem(
              "warningMessage"
          );

          setTimeout(()=>{

              setWarning("");

          },5000);

      }

  },[]);

  const [file, setFile] = useState(null);
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {

    const selectedFile = e.target.files[0];

    if (selectedFile) {
      setFile(selectedFile);
    }

  };

  const uploadResume = async () => {

    if (!file) {
      alert("Please select a resume file.");
      return;
    }

    if (!role.trim()) {
      alert("Please enter the role you want to target.");
      return;
    }

    const token = localStorage.getItem("token");

    const formData = new FormData();
    formData.append("resume", file);
    formData.append("role", role.trim());

    try {

      setLoading(true);

      const response = await axios.post(
        "http://localhost:5000/resume/upload",
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      navigate("/dashboard/result", {
        state: {
          analysis: response.data.analysis,
        },
      });

    } catch (err) {

      alert(
        err.response?.data?.message ||
        "Something went wrong. Please try again."
      );

    } finally {

      setLoading(false);

    }

  };

  return (
  <div className="max-w-2xl mx-auto mt-10 bg-white rounded-2xl shadow-lg p-8">

    <h1 className="text-3xl font-bold mb-2">
      Upload Resume
    </h1>

    {warning && (
      <div
        className="
          bg-yellow-100
          border
          border-yellow-300
          text-yellow-800
          px-5
          py-3
          rounded-xl
          mt-4
          mb-6
          font-medium
        "
      >
        ⚠️ {warning}
      </div>
    )}

    <p className="text-gray-500 mb-8">
      Upload your latest resume in PDF format.
    </p>

    <div className="mb-6">
      <label className="block text-lg font-semibold text-gray-700 mb-3">
        🎯 Target Role
      </label>

      <input
        type="text"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        placeholder="e.g. Frontend Developer"
        className="w-full border border-gray-300 rounded-xl px-5 py-3 text-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
      />

      <p className="text-sm text-gray-500 mt-2">
        Type the role you want to target. Your resume will be analyzed for
        that role.
      </p>
    </div>

    <input
      type="file"
      accept=".pdf"
      hidden
      ref={fileInputRef}
      onChange={handleFileChange}
    />

    <div
      onClick={() => !loading && fileInputRef.current.click()}
      className="
        border-2
        border-dashed
        border-purple-400
        rounded-xl
        p-10
        text-center
        cursor-pointer
        hover:bg-purple-50
        transition
      "
    >
      <h2 className="text-xl font-semibold">
        📄 Click to Select Resume
      </h2>

      <p className="text-gray-500 mt-2">
        Only PDF files are allowed
      </p>
    </div>

    {file && (
      <div className="mt-6 bg-green-50 border border-green-300 rounded-lg p-4">

        <p className="font-medium text-green-700">
          ✅ {file.name}
        </p>

        <p className="text-sm text-gray-600 mt-1">
          Size: {(file.size / 1024).toFixed(2)} KB
        </p>

      </div>
    )}

    <button
      onClick={uploadResume}
      disabled={loading}
      className="
        mt-6
        w-full
        bg-purple-600
        hover:bg-purple-700
        text-white
        py-3
        rounded-lg
        transition
        flex
        items-center
        justify-center
        gap-3
        disabled:opacity-70
        disabled:cursor-not-allowed
      "
    >
      {loading ? (
        <>
          <div
            className="
              w-5
              h-5
              border-2
              border-white
              border-t-transparent
              rounded-full
              animate-spin
            "
          />

          <span>
            Analyzing Resume...
          </span>
        </>
      ) : (
        "Upload Resume"
      )}
    </button>

  </div>
);
}

export default Resume;
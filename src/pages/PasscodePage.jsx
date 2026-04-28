import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "../App.css";

export default function PasscodePage() {
  const navigate = useNavigate();

  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault(); 
    setError("");
    setLoading(true);

    try {
      const res = await fetch("http://localhost:5000/api/auth/passcode", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ passcode }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Invalid passcode");
      }

      sessionStorage.setItem("appAccess", data.token);
      navigate("/personnel");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="passcode-page">
      <form className="passcode-card" onSubmit={handleSubmit}>
        <div className="passcode-icon">🛡️</div>

        <h1>Emergency Dashboard</h1>
        <p>Enter passcode to continue</p>

        {error && <div className="passcode-error">{error}</div>}

        <input
          className="passcode-input"
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="Enter passcode"
          autoFocus
        />

        <button className="passcode-btn" disabled={loading}>
          {loading ? "Checking..." : "Continue"}
        </button>
      </form>
    </div>
  );
}
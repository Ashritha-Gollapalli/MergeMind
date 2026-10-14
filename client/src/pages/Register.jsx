import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import api from "../services/api";
import { useAuthStore } from "../store/authStore";

export default function Register() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);

  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
  });

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleChange(event) {
    setForm({
      ...form,
      [event.target.name]: event.target.value,
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { data } = await api.post(
        "/auth/register",
        {
          name: form.username,
          email: form.email,
          password: form.password,
        },
      );

      setAuth(data.user, data.token);

      navigate("/dashboard");
    } catch (error) {
      setError(
        error.response?.data?.message ||
          "Unable to register. Check your backend connection."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="brand-mark">C</div>

        <h1>Create your account</h1>

        <p className="muted">
          Start collaborating with your team.
        </p>

        <label htmlFor="username">Username</label>

        <input
          id="username"
          name="username"
          placeholder="Your name"
          value={form.username}
          onChange={handleChange}
          minLength={3}
          maxLength={30}
          autoComplete="username"
          required
        />

        <label htmlFor="email">Email address</label>

        <input
          id="email"
          name="email"
          type="email"
          placeholder="you@example.com"
          value={form.email}
          onChange={handleChange}
          autoComplete="email"
          required
        />

        <label htmlFor="password">Password</label>

        <input
          id="password"
          name="password"
          type="password"
          placeholder="At least 12 characters"
          value={form.password}
          onChange={handleChange}
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          required
        />

        {error && <div className="error-message">{error}</div>}

        <button className="primary-button" disabled={loading}>
          {loading ? "Creating account..." : "Create account"}
        </button>

        <p className="auth-footer">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </main>
  );
}
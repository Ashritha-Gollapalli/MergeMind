import { useEffect, useState } from "react";
import { apiRequest } from "./api";
import "./App.css";

function App() {
  const [token, setToken] = useState(() =>
    localStorage.getItem("mergemind_token")
  );
  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [mode, setMode] = useState("login");
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [authForm, setAuthForm] = useState({
    name: "",
    email: "",
    password: "",
  });

  const [projectForm, setProjectForm] = useState({
    name: "",
    description: "",
  });

  async function loadProjects(activeToken) {
    const data = await apiRequest("/projects", {}, activeToken);
    setProjects(data.projects || []);
  }

  useEffect(() => {
    async function restoreSession() {
      if (!token) {
        setPageLoading(false);
        return;
      }

      try {
        const data = await apiRequest("/auth/me", {}, token);
        setUser(data.user);
        await loadProjects(token);
      } catch {
        localStorage.removeItem("mergemind_token");
        setToken(null);
        setUser(null);
      } finally {
        setPageLoading(false);
      }
    }

    restoreSession();
  }, [token]);

  function handleAuthChange(event) {
    setAuthForm({
      ...authForm,
      [event.target.name]: event.target.value,
    });
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const endpoint =
        mode === "login" ? "/auth/login" : "/auth/register";

      const payload =
        mode === "login"
          ? {
              email: authForm.email,
              password: authForm.password,
            }
          : authForm;

      const data = await apiRequest(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (mode === "register") {
        setMode("login");
        setAuthForm({
          name: "",
          email: authForm.email,
          password: "",
        });
        setSuccess("Account created. Please log in.");
        return;
      }

      if (!data.token) {
        throw new Error("The login response did not include a token.");
      }

      localStorage.setItem("mergemind_token", data.token);
      setToken(data.token);
      setUser(data.user);
      setSuccess("Welcome to MergeMind!");
    } catch (err) {
      setError(err.message || "Authentication failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateProject(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      await apiRequest(
        "/projects",
        {
          method: "POST",
          body: JSON.stringify(projectForm),
        },
        token
      );

      setProjectForm({ name: "", description: "" });
      await loadProjects(token);
      setSuccess("Project created successfully.");
    } catch (err) {
      setError(err.message || "Could not create project.");
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem("mergemind_token");
    setToken(null);
    setUser(null);
    setProjects([]);
    setError("");
    setSuccess("");
  }

  if (pageLoading) {
    return (
      <main className="loading-screen">
        <div className="loader" />
        <p>Preparing your workspace...</p>
      </main>
    );
  }

  if (token && user) {
    return (
      <main className="app-shell">
        <header className="topbar">
          <a className="brand" href="/">
            <span className="brand-mark">M</span>
            MergeMind
          </a>

          <div className="user-menu">
            <span className="user-name">
              {user.name || user.email}
            </span>
            <button
              className="button button-secondary"
              onClick={handleLogout}
            >
              Log out
            </button>
          </div>
        </header>

        <section className="dashboard">
          <div className="welcome-row">
            <div>
              <p className="eyebrow">YOUR WORKSPACE</p>
              <h1>Build something together.</h1>
              <p className="subtitle">
                Your projects, in one place.
              </p>
            </div>
            <div className="project-count">
              <span>{projects.length}</span>
              <small>Projects</small>
            </div>
          </div>

          {error && <div className="alert alert-error">{error}</div>}
          {success && (
            <div className="alert alert-success">{success}</div>
          )}

          <section className="create-panel">
            <div>
              <p className="eyebrow">GET STARTED</p>
              <h2>Create a project</h2>
              <p className="subtitle">
                Start a workspace for your next collaboration.
              </p>
            </div>

            <form onSubmit={handleCreateProject} className="project-form">
              <label>
                Project name
                <input
                  required
                  minLength={2}
                  maxLength={100}
                  value={projectForm.name}
                  onChange={(event) =>
                    setProjectForm({
                      ...projectForm,
                      name: event.target.value,
                    })
                  }
                  placeholder="e.g. Real-time code editor"
                />
              </label>

              <label>
                Description
                <textarea
                  maxLength={1000}
                  rows={3}
                  value={projectForm.description}
                  onChange={(event) =>
                    setProjectForm({
                      ...projectForm,
                      description: event.target.value,
                    })
                  }
                  placeholder="What are you building?"
                />
              </label>

              <button
                className="button button-primary"
                disabled={loading}
                type="submit"
              >
                {loading ? "Please wait..." : "+ Create project"}
              </button>
            </form>
          </section>

          <section className="projects-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">WORKSPACE</p>
                <h2>Your projects</h2>
              </div>
              <span className="muted">{projects.length} total</span>
            </div>

            {projects.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">⌘</div>
                <h3>Your workspace starts here</h3>
                <p>
                  Create your first project to get started with
                  MergeMind.
                </p>
              </div>
            ) : (
              <div className="project-grid">
                {projects.map((project) => (
                  <article className="project-card" key={project._id}>
                    <div className="project-card-top">
                      <div className="project-icon">
                        {project.name?.charAt(0)?.toUpperCase() || "P"}
                      </div>
                      <span className="status-dot">Active</span>
                    </div>

                    <h3>{project.name}</h3>
                    <p className="project-description">
                      {project.description || "No description provided."}
                    </p>

                    <div className="project-card-footer">
                      <span>
                        {project.members?.length || 1} member
                        {(project.members?.length || 1) === 1 ? "" : "s"}
                      </span>
                      <span>
                        {project.owner?.name ? `By ${project.owner.name}` : "Your project"}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </section>

        <footer className="footer">
          MergeMind · Collaborate. Create. Code.
        </footer>
      </main>
    );
  }

  return (
    <main className="auth-layout">
      <section className="auth-visual">
        <a className="brand brand-light" href="/">
          <span className="brand-mark">M</span>
          MergeMind
        </a>

        <div className="visual-content">
          <div className="visual-tag">
            <span className="status-dot" />
            BUILT FOR TEAMWORK
          </div>
          <h1>
            Great code
            <br />
            comes from
            <br />
            <span>great minds.</span>
          </h1>
          <p>
            A shared space for developers to build, explore, and
            create together.
          </p>

          <div className="code-preview">
            <div className="code-window-bar">
              <span />
              <span />
              <span />
              <small>collaboration.js</small>
            </div>
            <pre>
              <code>
                <span className="code-purple">const</span> team = [
                {"\n"}  <span className="code-green">"ideas"</span>,
                {"\n"}  <span className="code-green">"creativity"</span>,
                {"\n"}  <span className="code-green">"collaboration"</span>
                {"\n"}];
                {"\n\n"}
                <span className="code-purple">await</span> team.build();
              </code>
            </pre>
          </div>
        </div>
        <p className="visual-footer">One team. One shared vision.</p>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <p className="eyebrow">
            {mode === "login" ? "WELCOME BACK" : "GET STARTED"}
          </p>
          <h2>
            {mode === "login" ? "Sign in to MergeMind" : "Create your account"}
          </h2>
          <p className="subtitle">
            {mode === "login"
              ? "Pick up where your team left off."
              : "Join your team and start building."}
          </p>

          {error && <div className="alert alert-error">{error}</div>}
          {success && (
            <div className="alert alert-success">{success}</div>
          )}

          <form className="auth-form" onSubmit={handleAuthSubmit}>
            {mode === "register" && (
              <label>
                Full name
                <input
                  name="name"
                  autoComplete="name"
                  required
                  value={authForm.name}
                  onChange={handleAuthChange}
                  placeholder="Your name"
                />
              </label>
            )}

            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                value={authForm.email}
                onChange={handleAuthChange}
                placeholder="you@example.com"
              />
            </label>

            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength={8}
                required
                value={authForm.password}
                onChange={handleAuthChange}
                placeholder="At least 8 characters"
              />
            </label>

            <button
              className="button button-primary auth-submit"
              disabled={loading}
              type="submit"
            >
              {loading
                ? "Please wait..."
                : mode === "login"
                  ? "Sign in"
                  : "Create account"}
              {!loading && <span>→</span>}
            </button>
          </form>

          <p className="auth-switch">
            {mode === "login"
              ? "New to MergeMind?"
              : "Already have an account?"}{" "}
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError("");
                setSuccess("");
              }}
            >
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </p>

          <p className="auth-terms">
            Collaborate with your team, one project at a time.
          </p>
        </div>
      </section>
    </main>
  );
}

export default App;
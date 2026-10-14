import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Plus,
  Folder,
  ArrowUpRight,
  Code2,
  Users,
} from "lucide-react";

import api from "../services/api";
import Navbar from "../components/Navbar";

export default function Dashboard() {
  const navigate = useNavigate();

  const [projects, setProjects] = useState([]);
  const [projectName, setProjectName] = useState("");
  const [showForm, setShowForm] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadProjects() {
    try {
      const { data } = await api.get("/projects");
      setProjects(data);
      setError("");
    } catch (error) {
      setError(
        error.response?.data?.message ||
          "Unable to load projects. Is the backend running?"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  async function createProject(event) {
    event.preventDefault();

    if (!projectName.trim()) return;

    try {
      const { data } = await api.post("/projects", {
        name: projectName.trim(),
      });

      setProjects((previous) => [data, ...previous]);

      setProjectName("");
      setShowForm(false);

      navigate(`/workspace/${data._id}`);
    } catch (error) {
      setError(
        error.response?.data?.message ||
          "Unable to create project."
      );
    }
  }

  return (
    <div className="app-shell">
      <Navbar />

      <main className="dashboard-content">
        <section className="welcome-section">
          <div>
            <span className="eyebrow">DEVELOPER WORKSPACE</span>

            <h1>Your projects</h1>

            <p>
              Build, collaborate, and ship code together.
            </p>
          </div>

          <button
            className="primary-button create-button"
            onClick={() => setShowForm(!showForm)}
          >
            <Plus size={18} />
            New project
          </button>
        </section>

        {showForm && (
          <form
            className="create-project-form"
            onSubmit={createProject}
          >
            <input
              value={projectName}
              onChange={(event) =>
                setProjectName(event.target.value)
              }
              placeholder="Enter project name"
              maxLength={100}
              autoFocus
              required
            />

            <button className="primary-button">
              Create
            </button>

            <button
              type="button"
              className="secondary-button"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </button>
          </form>
        )}

        {error && <div className="error-message">{error}</div>}

        <section className="stats-grid">
          <article className="stat-card">
            <div className="stat-icon">
              <Folder size={20} />
            </div>

            <span>Total projects</span>

            <strong>{projects.length}</strong>
          </article>

          <article className="stat-card">
            <div className="stat-icon">
              <Code2 size={20} />
            </div>

            <span>Editor</span>

            <strong>Monaco</strong>
          </article>

          <article className="stat-card">
            <div className="stat-icon">
              <Users size={20} />
            </div>

            <span>Collaboration</span>

            <strong>Real-time ready</strong>
          </article>
        </section>

        <section className="projects-section">
          <div className="section-heading">
            <h2>Recent projects</h2>
            <span>{projects.length} projects</span>
          </div>

          {loading ? (
            <p className="muted">Loading projects...</p>
          ) : projects.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                <Folder size={28} />
              </div>

              <h3>No projects yet</h3>

              <p>
                Create your first project to start coding.
              </p>

              <button
                className="primary-button"
                onClick={() => setShowForm(true)}
              >
                <Plus size={18} />
                Create project
              </button>
            </div>
          ) : (
            <div className="project-grid">
              {projects.map((project) => (
                <article
                  className="project-card"
                  key={project._id}
                  onClick={() =>
                    navigate(`/workspace/${project._id}`)
                  }
                >
                  <div className="project-card-top">
                    <div className="project-icon">
                      <Code2 size={22} />
                    </div>

                    <ArrowUpRight size={18} />
                  </div>

                  <h3>{project.name}</h3>

                  <p>
                    {project.description || "Collaborative coding project"}
                  </p>

                  <div className="project-card-footer">
                    <span>
                      <Users size={15} />
                      {project.members?.length || 0} collaborators
                    </span>

                    <span className="status-dot">
                      Active
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
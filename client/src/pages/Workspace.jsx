import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  ArrowLeft,
  Play,
  Save,
  Users,
  Circle,
} from "lucide-react";

import api from "../services/api";
import { useAuthStore } from "../store/authStore";

import FileExplorer from "../components/FileExplorer";
import CodeEditor from "../components/CodeEditor";
import AudioRoom from "../components/AudioRoom";
import Collaborators from "../components/Collaborators";
import RoleBadge from "../components/RoleBadge";

export default function Workspace() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const user = useAuthStore((state) => state.user);

  const [project, setProject] = useState(null);
  const [role, setRole] = useState("");

  const [files, setFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [content, setContent] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const canEdit = ["OWNER", "ADMIN", "EDITOR"].includes(role);

  useEffect(() => {
    async function loadWorkspace() {
      try {
        const [projectResponse, filesResponse] = await Promise.all([
          api.get(`/projects/${projectId}`),
          api.get(`/files/${projectId}`),
        ]);

        const projectData = projectResponse.data.project;

        setProject(projectData);
        setRole(projectResponse.data.role);

        const loadedFiles = filesResponse.data;

        setFiles(loadedFiles);

        const firstFile = loadedFiles.find(
          (file) => file.type === "file"
        );

        if (firstFile) {
          setActiveFile(firstFile);
          setContent(firstFile.content || "");
        }
      } catch (error) {
        setError(
          error.response?.data?.message ||
            "Unable to load the workspace."
        );
      } finally {
        setLoading(false);
      }
    }

    loadWorkspace();
  }, [projectId]);

  function selectFile(file) {
    if (file.type !== "file") return;

    setActiveFile(file);
    setContent(file.content || "");
    setError("");
  }

  async function createFile() {
    const name = window.prompt("Enter a file name:");

    if (!name?.trim()) return;

    try {
      const { data } = await api.post(`/files/${projectId}`, {
        name: name.trim(),
        path: name.trim(),
        type: "file",
      });

      setFiles((previous) => [...previous, data]);
      setActiveFile(data);
      setContent("");
    } catch (error) {
      setError(
        error.response?.data?.message ||
          "Unable to create file."
      );
    }
  }

  async function saveFile() {
    if (!activeFile || !canEdit) return;

    setSaving(true);
    setError("");

    try {
      const { data } = await api.put(
        `/files/${projectId}/${activeFile._id}`,
        { content }
      );

      setFiles((previous) =>
        previous.map((file) =>
          file._id === data._id ? data : file
        )
      );

      setActiveFile(data);
    } catch (error) {
      setError(
        error.response?.data?.message ||
          "Unable to save file."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="loading-screen">Loading workspace...</div>;
  }

  if (!project) {
    return (
      <div className="loading-screen">
        {error || "Project not found."}
        <button onClick={() => navigate("/dashboard")}>
          Return to dashboard
        </button>
      </div>
    );
  }

  const members = [
    {
      user: {
        _id: user?.id,
        username: user?.username || "You",
      },
      role,
    },
    ...(project.members || []),
  ];

  return (
    <main className="ide-layout">
      <header className="ide-topbar">
        <div className="ide-brand">
          <button
            className="icon-button"
            onClick={() => navigate("/dashboard")}
            title="Back to dashboard"
            aria-label="Back to dashboard"
          >
            <ArrowLeft size={18} />
          </button>

          <span className="brand-icon">
            <Circle size={12} fill="currentColor" />
          </span>

          <span className="ide-brand-name">CodeCollab</span>

          <span className="breadcrumb-separator">/</span>

          <span className="project-title">{project.name}</span>
        </div>

        <div className="ide-actions">
          <div className="presence-indicator">
            <span className="online-dot" />
            Collaboration workspace
          </div>

          <AudioRoom
            key={projectId}
            projectId={projectId}
            userName={user?.username || user?.name || "You"}
          />

          <button
            className="secondary-button"
            onClick={saveFile}
            disabled={!canEdit || !activeFile || saving}
          >
            <Save size={16} />
            {saving ? "Saving..." : "Save"}
          </button>

          <button
            className="primary-button"
            onClick={() =>
              window.alert("Code execution will be added in a later module.")
            }
          >
            <Play size={16} />
            Run
          </button>
        </div>
      </header>

      {error && <div className="workspace-error">{error}</div>}

      <div className="ide-body">
        <FileExplorer
          files={files}
          activeFileId={activeFile?._id}
          onSelectFile={selectFile}
          onCreateFile={createFile}
          readOnly={!canEdit}
        />

        <section className="editor-panel">
          <div className="editor-toolbar">
            <div className="active-file-name">
              {activeFile?.name || "No file selected"}
            </div>

            <div className="editor-status">
              <RoleBadge role={role} />
              <span>UTF-8</span>
              <span>JavaScript</span>
            </div>
          </div>

          <div className="editor-main">
            {activeFile ? (
              <CodeEditor
                file={activeFile}
                value={content}
                onChange={setContent}
                readOnly={!canEdit}
              />
            ) : (
              <div className="editor-empty">
                <h2>Welcome to CodeCollab</h2>
                <p>Select a file or create a new one.</p>
              </div>
            )}
          </div>

          <footer className="editor-footer">
            <span>{role || "Loading role..."}</span>
            <span>{content.length} characters</span>
          </footer>
        </section>

        <aside className="right-sidebar">
          <div className="right-sidebar-header">
            <Users size={17} />
            <span>TEAM</span>
          </div>

          <Collaborators
            members={members}
            currentUserId={user?.id}
          />

          <div className="role-information">
            <h3>Your permissions</h3>

            <RoleBadge role={role} />

            <p>
              {canEdit
                ? "You can edit and save files in this project."
                : "You have read-only access to this project."}
            </p>
          </div>
        </aside>
      </div>

      <footer className="ide-statusbar">
        <span>CodeCollab</span>
        <span>Project: {project.name}</span>
        <span>Role: {role}</span>
      </footer>
    </main>
  );
}
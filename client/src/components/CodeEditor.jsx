
import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { io } from "socket.io-client";
import { apiRequest } from "../api";

const initialFiles = {
  "App.jsx": `import React from "react";

export default function App() {
  return (
    <main>
      <h1>Welcome to MergeMind</h1>
      <p>Build something together.</p>
    </main>
  );
}`,
  "App.css": `body {
  margin: 0;
  font-family: Inter, sans-serif;
  background: #0d0f18;
  color: #f1f2f8;
}

h1 {
  color: #a78bfa;
}`,
  "README.md": `# MergeMind

A collaborative coding workspace.

## Features
- Shared projects
- Real-time collaboration
- Browser-based code editor
`,
};

const fileLanguages = {
  "App.jsx": "javascript",
  "App.css": "css",
  "README.md": "markdown",
};

function CodeEditor({ project, token, onBack }) {
  const [files, setFiles] = useState({
  "App.jsx": "",
  "App.css": "",
  "README.md": "",
});
const [codeLoading, setCodeLoading] = useState(true);
const [saveStatus, setSaveStatus] = useState("Loading...");
const saveTimer = useRef(null);
const latestCode = useRef("");
const isInitialLoad = useRef(true);
  const [activeFile, setActiveFile] = useState("App.jsx");
  const [sidebarView, setSidebarView] = useState("explorer");
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [assistantMessage, setAssistantMessage] = useState("");
  const [terminalMessage, setTerminalMessage] = useState(
    "MergeMind workspace ready."
  );
  const [runCount, setRunCount] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState("Connecting...");
const socketRef = useRef(null);
useEffect(() => {
  if (!token || !project?._id) return;

  const socket = io(
    import.meta.env.VITE_API_URL?.replace(/\/api\/?$/, "") ||
      "http://localhost:5000",
    {
      auth: { token },
      transports: ["websocket", "polling"],
    }
  );

  socketRef.current = socket;

  socket.on("connect", () => {
    setConnectionStatus("Connected");

    socket.emit(
      "project:join",
      { projectId: project._id },
      (result) => {
        if (!result?.ok) {
          setConnectionStatus(result?.message || "Join failed");
          return;
        }

        setConnectionStatus("Connected");
      }
    );
  });

  socket.on("connect_error", (error) => {
    console.error("Socket connection failed:", error.message);
    setConnectionStatus("Connection failed");
  });

  socket.on("disconnect", () => {
    setConnectionStatus("Disconnected");
  });
socket.on("project:code-change", ({ projectId, code }) => {
  if (projectId !== project._id || typeof code !== "string") {
    return;
  }
  // Cancel a pending HTTP save so it cannot overwrite a collaborator's edit.
  clearTimeout(saveTimer.current);

  latestCode.current = code;

  setFiles((current) => ({
    ...current,
    [activeFile]: code,
  }));

  setSaveStatus("Saved");
});

  return () => {
    socket.emit("project:leave", { projectId: project._id });
    socket.disconnect();
    socketRef.current = null;
  };
}, [project?._id, token]);

  const language = fileLanguages[activeFile] || "plaintext";
  useEffect(() => {
  let cancelled = false;

  async function loadCode() {
    setCodeLoading(true);
    setSaveStatus("Loading...");

    try {
      const data = await apiRequest(
        `/projects/${project._id}/code`,
        {},
        token
      );

      if (cancelled) return;

      const savedCode = data.code || "";

      latestCode.current = savedCode;
      setFiles((current) => ({
        ...current,
        [activeFile]: savedCode,
      }));

      isInitialLoad.current = true;
      setSaveStatus("Saved");
    } catch (error) {
      if (!cancelled) {
        setSaveStatus("Load failed");
        console.error("Could not load project code:", error);
      }
    } finally {
      if (!cancelled) setCodeLoading(false);
    }
  }

  loadCode();

  return () => {
    cancelled = true;
    clearTimeout(saveTimer.current);
  };
}, [project._id, token]);


function updateCode(value) {
   const nextCode = value ?? "";

  latestCode.current = nextCode;

  setFiles((current) => ({
    ...current,
    [activeFile]: nextCode,
  }));

  setSaveStatus("Unsaved changes");

  // Wait briefly so we don't send a request for every keystroke.
  clearTimeout(saveTimer.current);

  saveTimer.current = setTimeout(async () => {
    const socket = socketRef.current;

    if (socket?.connected) {
      setSaveStatus("Saving...");

      socket.emit(
        "project:code-change",
        {
          projectId: project._id,
          code: latestCode.current,
        },
        (result) => {
          if (result?.ok) {
            setSaveStatus("Saved");
          } else {
            setSaveStatus(result?.message || "Save failed");
          }
        }
      );

      return;
    }

    // If Socket.IO is disconnected, fall back to the HTTP endpoint.
    try {
      setSaveStatus("Saving...");

      await apiRequest(
        `/projects/${project._id}/code`,
        {
          method: "PUT",
          body: JSON.stringify({ code: latestCode.current }),
        },
        token
      );

      setSaveStatus("Saved");
    } catch (error) {
      console.error("Could not save project code:", error);
      setSaveStatus("Save failed");
    }
  }, 400);
}

function handleRun() {
    setRunCount((count) => count + 1);
    setTerminalMessage(
      `Run requested for ${activeFile}. Code execution is not connected yet.`
    );
    setTerminalOpen(true);
  }

  function sendAssistantMessage(event) {
    event.preventDefault();

    if (!assistantMessage.trim()) return;

    setTerminalMessage(
      `AI integration is not connected yet. Your prompt: ${assistantMessage.trim()}`
    );
    setTerminalOpen(true);
    setAssistantMessage("");
  }

  return (
    <main className="ide-shell">
      <header className="ide-topbar">
        <button
          className="ide-logo"
          onClick={onBack}
          title="Back to project"
        >
          {"</>"}
        </button>

        <div className="ide-brand">
          <strong>MergeMind</strong>
          <span className="ide-beta">IDE</span>
        </div>

        <div className="ide-workspace-name">
          <span className="workspace-avatar">M</span>
          <span>{project.name}</span>
        </div>

        <div className="ide-top-actions">
          <span className="ide-branch">⑂ main</span>
          <button
            className="ide-action-button"
            onClick={() => {
              navigator.clipboard?.writeText(window.location.href);
              setTerminalMessage("Workspace link copy requested.");
            }}
          >
            Share
          </button>
          <button className="ide-run-button" onClick={handleRun}>
            ▶ Run
          </button>
        </div>
      </header>

      <div className="ide-projectbar">
        <div className="ide-current-file">
          <span className="ide-live-dot" />
          {project.name}
          <span className="ide-save-status">{saveStatus}</span>
        </div>

        <div className="ide-session-status">
          <span className="ide-live-dot" />
          Local session
        </div>
      </div>

      <div className="ide-body">
        <aside className="ide-activitybar">
          <button
            className={sidebarView === "explorer" ? "active" : ""}
            title="Explorer"
            onClick={() => setSidebarView("explorer")}
          >
            ▤
          </button>
          <button
            className={sidebarView === "search" ? "active" : ""}
            title="Search files"
            onClick={() => setSidebarView("search")}
          >
            ⌕
          </button>
          <button
            className={sidebarView === "source" ? "active" : ""}
            title="Source control"
            onClick={() => setSidebarView("source")}
          >
            ⑂
          </button>
          <button
            className={sidebarView === "members" ? "active" : ""}
            title="Project members"
            onClick={() => setSidebarView("members")}
          >
            ♙
          </button>
        </aside>

        <aside className="ide-explorer">
          {sidebarView === "explorer" && (
            <>
              <div className="ide-pane-title">
                EXPLORER <span>•••</span>
              </div>

              <div className="ide-folder-name">⌄ {project.name}</div>

              {Object.keys(files).map((file) => (
                <button
                  key={file}
                  className={`ide-file ${
                    activeFile === file ? "active" : ""
                  }`}
                  onClick={() => setActiveFile(file)}
                >
                  <span className="ide-file-icon">
                    {file.endsWith(".jsx")
                      ? "JS"
                      : file.endsWith(".css")
                        ? "#"
                        : "M"}
                  </span>
                  {file}
                </button>
              ))}

              <div className="ide-explorer-note">
                Starter files are local previews. Project file storage will
                be connected separately.
              </div>
            </>
          )}

          {sidebarView === "search" && (
            <>
              <div className="ide-pane-title">SEARCH</div>
              <p className="ide-sidebar-message">
                File search will be available when the workspace file system
                is implemented.
              </p>
            </>
          )}

          {sidebarView === "source" && (
            <>
              <div className="ide-pane-title">SOURCE CONTROL</div>
              <p className="ide-sidebar-message">
                Git branch and commit integration is not connected to this
                editor yet.
              </p>
            </>
          )}

          {sidebarView === "members" && (
            <>
              <div className="ide-pane-title">COLLABORATORS</div>
              <p className="ide-sidebar-message">
                Open the project details page to manage project members.
              </p>
              <button className="ide-sidebar-button" onClick={onBack}>
                View project members
              </button>
            </>
          )}
        </aside>

        <section className="ide-main">
          <div className="ide-tabs">
            {Object.keys(files).map((file) => (
              <button
                key={file}
                className={`ide-tab ${
                  activeFile === file ? "active" : ""
                }`}
                onClick={() => setActiveFile(file)}
              >
                <span className="ide-file-icon">
                  {file.endsWith(".jsx")
                    ? "JS"
                    : file.endsWith(".css")
                      ? "#"
                      : "M"}
                </span>
                {file}
                {activeFile === file && <span className="ide-tab-dot" />}
              </button>
            ))}
          </div>

          <div className="ide-editor-heading">
            <span>src</span> / <strong>{activeFile}</strong>
            <span className="ide-editor-meta">
              {language} · UTF-8 · Spaces: 2
            </span>
          </div>

          <div className="ide-monaco">
{codeLoading ? (
    <div className="ide-loading">
    Loading saved code...
  </div>
) : (
  <Editor
    key={activeFile}
    height="100%"
    language={language}
    theme="vs-dark"
    value={files[activeFile]}
    onChange={updateCode}
    options={{
      minimap: { enabled: true },
      fontSize: 14,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      wordWrap: "on",
      padding: { top: 16 },
      lineNumbers: "on",
    }}
  />
)}

          </div>

          {terminalOpen && (
            <section className="ide-terminal">
              <div className="ide-terminal-header">
                <strong>TERMINAL</strong>
                <span>OUTPUT</span>
                <button
                  title="Close terminal"
                  onClick={() => setTerminalOpen(false)}
                >
                  ×
                </button>
              </div>

              <div className="ide-terminal-content">
                <span className="terminal-prompt">›</span>
                {terminalMessage}
                {runCount > 0 && (
                  <p>Run requests this session: {runCount}</p>
                )}
              </div>
            </section>
          )}

          <footer className="ide-statusbar">
            <span>MergeMind</span>
            <span>{language}</span>
            <span>UTF-8</span>
            <span>{files[activeFile].split("\n").length} lines</span>
          </footer>
        </section>

        {assistantOpen && (
          <aside className="ide-assistant">
            <div className="ide-assistant-header">
              <span className="assistant-icon">✦</span>
              <div>
                <strong>AI Assistant</strong>
                <small>Workspace assistant</small>
              </div>
              <button
                title="Close assistant"
                onClick={() => setAssistantOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="ide-assistant-content">
              <span className="assistant-icon">✦</span>
              <strong>Welcome to MergeMind</strong>
              <p>
                Your coding workspace is ready. Edit files from the explorer
                and use the terminal panel to view workspace status.
              </p>

              <div className="assistant-suggestions">
                <button
                  onClick={() =>
                    setAssistantMessage("Explain the current file")
                  }
                >
                  Explain code
                </button>
                <button
                  onClick={() =>
                    setAssistantMessage("Help me find bugs")
                  }
                >
                  Find bugs
                </button>
              </div>
            </div>

            <form
              className="ide-assistant-input"
              onSubmit={sendAssistantMessage}
            >
              <textarea
                value={assistantMessage}
                onChange={(event) =>
                  setAssistantMessage(event.target.value)
                }
                placeholder="Ask about your code..."
                rows={3}
              />
              <button type="submit">Send ↗</button>
            </form>
            <p className="ide-assistant-disclaimer">
              AI responses require a connected AI service.
            </p>
          </aside>
        )}

        {!assistantOpen && (
          <button
            className="ide-reopen-assistant"
            onClick={() => setAssistantOpen(true)}
          >
            ✦ Assistant
          </button>
        )}
      </div>
    </main>
  );
}

export default CodeEditor;

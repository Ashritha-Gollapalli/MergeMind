
import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { io } from "socket.io-client";
import * as Y from "yjs";
import { MonacoBinding } from "y-monaco";

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

function CodeEditor({ project, token, user, onBack }) {
  const [files, setFiles] = useState(initialFiles);

  const [codeLoading, setCodeLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("Local preview");
  const [lastEditedBy, setLastEditedBy] = useState("");
  const saveTimer = useRef(null);
  const latestCode = useRef("");
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const currentUserName = user?.name || user?.email || "You";
  const [activeFile, setActiveFile] = useState("App.jsx");

  const showEditorBadge = (name, lineNumber = 1) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;

    if (!editor || !monaco || !name) return;

    const model = editor.getModel();
    const safeLine = Math.max(
      1,
      Number(lineNumber) || editor.getPosition()?.lineNumber || 1
    );

    if (!model) return;

    editor.deltaDecorations([], [
      {
        range: new monaco.Range(safeLine, 1, safeLine, 1),
        options: {
          after: {
            content: ` ${name}`,
            inlineClassName: "merge-mind-collab-label",
            className: "merge-mind-collab-label-box",
          },
          glyphMarginClassName: "merge-mind-collab-glyph",
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      },
    ]);
  };

  const bindEditorToSharedText = () => {
    const editor = editorRef.current;
    const sharedText = yTextRef.current;
    const model = editor?.getModel();

    if (!editor || !sharedText || !model) return;

    bindingRef.current?.destroy();
    bindingRef.current = new MonacoBinding(
      sharedText,
      model,
      new Set([editor]),
      null
    );
  };

  const language = fileLanguages[activeFile] || "plaintext";
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
const yDocRef = useRef(null);
const yTextRef = useRef(null);
const bindingRef = useRef(null);


useEffect(() => {
  if (!token || !project?._id) {
    setSaveStatus(token ? "Project not ready" : "Sign in to sync");
    setCodeLoading(false);
    return;
  }

  const projectId = project._id;
  let disposed = false;
  let doc = null;
  let sharedText = null;
  let applyingRemoteUpdate = false;

  const socket = io(
    import.meta.env.VITE_API_URL?.replace(/\/api\/?$/, "") ||
      "http://localhost:5000",
    {
      auth: { token },
      transports: ["websocket", "polling"],
    }
  );

  socketRef.current = socket;

  const encodeBase64 = (bytes) => {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const decodeBase64 = (value) => {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  };

  const handleDocumentUpdate = (update, origin) => {
    if (disposed || applyingRemoteUpdate || origin === "remote") return;
    if (!socket.connected) {
      setSaveStatus("Connection lost");
      return;
    }

    const lineNumber = editorRef.current?.getPosition()?.lineNumber || 1;

    setSaveStatus("Saving...");
    setLastEditedBy(`${currentUserName} edited`);

    socket.emit(
      "project:yjs-update",
      {
        projectId,
        update: encodeBase64(update),
        userName: currentUserName,
        lineNumber,
      },
      (result) => {
        if (disposed) return;
        setSaveStatus(result?.ok ? "Saved" : result?.message || "Save failed");
      }
    );

    showEditorBadge(currentUserName, lineNumber);
  };

  const handleTextChange = () => {
    if (disposed || !sharedText) return;

    const code = sharedText.toString();
    latestCode.current = code;

    setFiles((current) => ({
      ...current,
      App: current.App,
      "App.jsx": code,
    }));
  };

  socket.on("connect", () => {
    if (disposed) return;
    setConnectionStatus("Connected");

    socket.emit("project:join", { projectId }, (result) => {
      if (disposed) return;

      if (!result?.ok) {
        setConnectionStatus(result?.message || "Join failed");
        setSaveStatus("Load failed");
        setCodeLoading(false);
        return;
      }

      try {
        const newDoc = new Y.Doc();
        Y.applyUpdate(newDoc, decodeBase64(result.yjsState));

        doc = newDoc;
        sharedText = doc.getText("code");

        yDocRef.current = doc;
        yTextRef.current = sharedText;

        sharedText.observe(handleTextChange);
        doc.on("update", handleDocumentUpdate);
        bindEditorToSharedText();

        latestCode.current = sharedText.toString();
        setFiles((current) => ({
          ...current,
          "App.jsx": latestCode.current,
        }));

        setSaveStatus("Saved");
        setCodeLoading(false);
      } catch (error) {
        console.error("Could not initialize Yjs document:", error);
        setSaveStatus("Load failed");
        setCodeLoading(false);
      }
    });
  });

  socket.on("project:yjs-update", ({ projectId: incomingId, update, userName, lineNumber } = {}) => {
    if (
      disposed ||
      incomingId !== projectId ||
      typeof update !== "string" ||
      !doc
    ) {
      return;
    }

    try {
      applyingRemoteUpdate = true;
      Y.applyUpdate(doc, decodeBase64(update), "remote");

      if (userName) {
        setLastEditedBy(`${userName} edited`);
        showEditorBadge(userName, lineNumber || 1);
      }
    } catch (error) {
      console.error("Could not apply remote Yjs update:", error);
    } finally {
      applyingRemoteUpdate = false;
    }
  });

  socket.on("connect_error", (error) => {
    const message = error?.message || "Connection failed";

    if (/invalid|expired|authentication|required/i.test(message)) {
      localStorage.removeItem("mergemind_token");
      setConnectionStatus("Sign in required");
      setSaveStatus("Sign in to sync");
      setCodeLoading(false);
      return;
    }

    console.error("Socket connection failed:", message);
    setConnectionStatus("Connection failed");
    setSaveStatus("Connection failed");
    setCodeLoading(false);
  });

  socket.on("disconnect", () => {
    setConnectionStatus("Disconnected");
  });

  return () => {
    disposed = true;

    if (doc && sharedText) {
      sharedText.unobserve(handleTextChange);
      doc.off("update", handleDocumentUpdate);
      doc.destroy();
    }

    yDocRef.current = null;
    yTextRef.current = null;
    bindingRef.current?.destroy();
    bindingRef.current = null;

    clearTimeout(saveTimer.current);
    socket.emit("project:leave", { projectId });
    socket.disconnect();

    if (socketRef.current === socket) {
      socketRef.current = null;
    }
  };
}, [project?._id, token]);





function updateCode(value) {
  const nextCode = value ?? "";

  latestCode.current = nextCode;

  setFiles((current) => ({
    ...current,
    "App.jsx": nextCode,
  }));

  setSaveStatus("Saving...");
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
          <span>{project?.name || "Project"}</span>
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
          {project?.name || "Project"}
          <span className="ide-save-status">{lastEditedBy || saveStatus}</span>
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

              <div className="ide-folder-name">⌄ {project?.name || "Project"}</div>

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
  onMount={(editor, monaco) => {
  editorRef.current = editor;
  monacoRef.current = monaco;
  bindEditorToSharedText();

  showEditorBadge(currentUserName, editor.getPosition()?.lineNumber || 1);
}}
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

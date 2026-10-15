
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

function CodeEditor({ project, token, user, readOnly = false, onBack }) {
  const [files, setFiles] = useState(initialFiles);

  const hasCollaborationContext = Boolean(token && project?._id);
  const [codeLoading, setCodeLoading] = useState(hasCollaborationContext);
  const [saveStatus, setSaveStatus] = useState(
    hasCollaborationContext
      ? "Loading..."
      : token
        ? "Project not ready"
        : "Local preview"
  );
  const [lastEditedBy, setLastEditedBy] = useState("");
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const currentUserName = user?.name || user?.email || "You";
  const [activeFile, setActiveFile] = useState("App.jsx");
  const activeFileRef = useRef(activeFile);
  const [docVersion, setDocVersion] = useState(0);

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
    const sharedText = yDocsRef.current[activeFileRef.current]?.getText("code");
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
  const [connectionStatus, setConnectionStatus] = useState(
    hasCollaborationContext ? "Connecting..." : "Local preview"
  );
const socketRef = useRef(null);
const yDocsRef = useRef({});
const bindingRef = useRef(null);

useEffect(() => {
  activeFileRef.current = activeFile;
}, [activeFile]);

useEffect(() => {
  bindEditorToSharedText();

  return () => {
    bindingRef.current?.destroy();
    bindingRef.current = null;
  };
}, [activeFile, docVersion]);


useEffect(() => {
  if (!token || !project?._id) return;

  const projectId = String(project._id);
  let disposed = false;
  let docs = {};
  let initializingDocs = false;
  const pendingRemoteUpdates = [];
  const observingRemoteUpdates = new Set();

  const socket = io(
    import.meta.env.VITE_API_URL?.replace(/\/api\/?$/, "") ||
      "http://localhost:5000",
    {
      auth: { token },
      transports: ["websocket", "polling"],
    }
  );

  socketRef.current = socket;
  const handleReconnectAttempt = () => {
    setConnectionStatus("Reconnecting...");
    setSaveStatus("Reconnecting...");
  };
  const handleReconnectFailed = () => {
    setConnectionStatus("Reconnect failed");
    setSaveStatus("Connection lost");
  };

  socket.io.on("reconnect_attempt", handleReconnectAttempt);
  socket.io.on("reconnect_failed", handleReconnectFailed);

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

  const handleDocumentUpdate = (fileName, update, origin) => {
    if (
      disposed ||
      observingRemoteUpdates.has(fileName) ||
      origin === "remote"
    ) {
      return;
    }

    if (!socket.connected) {
      setSaveStatus("Connection lost");
      return;
    }

    sendDocumentUpdate(fileName, update);
  };

  const sendDocumentUpdate = (fileName, update) => {
    const lineNumber =
      fileName === activeFileRef.current
        ? editorRef.current?.getPosition()?.lineNumber || 1
        : 1;

    setSaveStatus("Saving...");
    setLastEditedBy(`${currentUserName} edited`);

    if (fileName === activeFileRef.current) {
      showEditorBadge(currentUserName, lineNumber);
    }

    return new Promise((resolve) =>
      socket.timeout(10000).emit(
        "project:yjs-update",
        {
          projectId,
          fileName,
          update: encodeBase64(update),
          lineNumber,
        },
        (error, result) => {
          if (disposed) {
            resolve(false);
            return;
          }
          if (!error && result?.ok) {
            setSaveStatus("Saved");
            resolve(true);
          } else {
            setLastEditedBy("");
            setSaveStatus(
              result?.message || error?.message || "Save failed"
            );
            resolve(false);
          }
        }
      )
    );
  };

  const applyRemoteUpdate = ({
    fileName = "App.jsx",
    update,
    userName,
    lineNumber,
  }) => {
    const entry = docs[fileName];

    if (!entry || typeof update !== "string") {
      pendingRemoteUpdates.push({
        fileName,
        update,
        userName,
        lineNumber,
      });
      return;
    }

    try {
      observingRemoteUpdates.add(fileName);
      Y.applyUpdate(entry.doc, decodeBase64(update), "remote");

      if (userName) {
        setLastEditedBy(`${userName} edited`);
        if (fileName === activeFileRef.current) {
          showEditorBadge(userName, lineNumber || 1);
        }
      }
    } catch (error) {
      console.error("Could not apply remote Yjs update:", error);
    } finally {
      observingRemoteUpdates.delete(fileName);
    }
  };

  socket.on("connect", () => {
    if (disposed) return;
    setConnectionStatus("Joining project...");
    initializingDocs = true;
    pendingRemoteUpdates.length = 0;

    socket.emit("project:join", { projectId }, (result) => {
      if (disposed) return;

      if (!result?.ok) {
        setConnectionStatus(result?.message || "Join failed");
        setSaveStatus("Load failed");
        setCodeLoading(false);
        initializingDocs = false;
        return;
      }
      setConnectionStatus("Connected");

      const nextDocs = {};

      try {
        const reconciliationRequests = [];

        for (const [fileName, defaultContent] of Object.entries(initialFiles)) {
          const file = result.files?.[fileName];
          const previousEntry = docs[fileName];
          const doc = previousEntry?.doc || new Y.Doc();
          nextDocs[fileName] = previousEntry || { doc };

          let serverState;
          if (file?.yjsState) {
            serverState = decodeBase64(file.yjsState);
          } else if (fileName === "App.jsx" && result.yjsState) {
            serverState = decodeBase64(result.yjsState);
          } else {
            const initialContent =
              typeof file?.content === "string"
                ? file.content
                : defaultContent;

            if (initialContent) {
              if (doc.getText("code").length === 0) {
                doc.getText("code").insert(0, initialContent);
              }
            }
          }

          const serverStateVector = serverState
            ? Y.encodeStateVectorFromUpdate(serverState)
            : new Uint8Array([0]);
          if (serverState) {
            observingRemoteUpdates.add(fileName);
            try {
              Y.applyUpdate(doc, serverState, "remote");
            } finally {
              observingRemoteUpdates.delete(fileName);
            }
          }

          const sharedText = doc.getText("code");
          if (!previousEntry) {
            const updateHandler = (update, origin) =>
              handleDocumentUpdate(fileName, update, origin);
            const textHandler = () => {
              if (disposed) return;
              setFiles((current) => ({
                ...current,
                [fileName]: sharedText.toString(),
              }));
            };

            doc.on("update", updateHandler);
            sharedText.observe(textHandler);
            nextDocs[fileName] = {
              doc,
              sharedText,
              updateHandler,
              textHandler,
            };
          }

          const unsyncedUpdate = Y.encodeStateAsUpdate(doc, serverStateVector);
          if (unsyncedUpdate.length > 2) {
            reconciliationRequests.push(
              sendDocumentUpdate(fileName, unsyncedUpdate)
            );
          }

        }

        docs = nextDocs;
        yDocsRef.current = Object.fromEntries(
          Object.entries(docs).map(([fileName, entry]) => [
            fileName,
            entry.doc,
          ])
        );
        initializingDocs = false;
        pendingRemoteUpdates.splice(0).forEach(applyRemoteUpdate);
        setDocVersion((version) => version + 1);
        setFiles(
          Object.fromEntries(
            Object.entries(docs).map(([fileName, entry]) => [
              fileName,
              entry.sharedText.toString(),
            ])
          )
        );

        if (reconciliationRequests.length > 0) {
          setSaveStatus("Syncing local edits...");
          Promise.all(reconciliationRequests).then((results) => {
            if (disposed) return;
            setSaveStatus(
              results.every(Boolean) ? "Saved" : "Some edits failed to sync"
            );
          });
        } else {
          setSaveStatus("Saved");
        }
        setCodeLoading(false);
      } catch (error) {
        Object.values(nextDocs).forEach(({ doc }) => doc.destroy());
        docs = {};
        yDocsRef.current = {};
        pendingRemoteUpdates.length = 0;
        initializingDocs = false;
        console.error("Could not initialize Yjs document:", error);
        setSaveStatus("Load failed");
        setCodeLoading(false);
      }
    });
  });

  socket.on("project:yjs-update", ({
    projectId: incomingId,
    fileName = "App.jsx",
    update,
    userName,
    lineNumber,
  } = {}) => {
    if (
      disposed ||
      String(incomingId) !== projectId ||
      typeof update !== "string" ||
      !Object.prototype.hasOwnProperty.call(initialFiles, fileName)
    ) {
      return;
    }

    if (initializingDocs || !docs[fileName]) {
      pendingRemoteUpdates.push({ fileName, update, userName, lineNumber });
      return;
    }

    applyRemoteUpdate({ fileName, update, userName, lineNumber });
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
    setSaveStatus("Connection lost");
  });

  return () => {
    disposed = true;

    Object.values(docs).forEach(
      ({ doc, sharedText, updateHandler, textHandler }) => {
        sharedText.unobserve(textHandler);
        doc.off("update", updateHandler);
        doc.destroy();
      }
    );

    docs = {};
    yDocsRef.current = {};
    bindingRef.current?.destroy();
    bindingRef.current = null;

    socket.emit("project:leave", { projectId });
    socket.disconnect();
    socket.io.off("reconnect_attempt", handleReconnectAttempt);
    socket.io.off("reconnect_failed", handleReconnectFailed);

    if (socketRef.current === socket) {
      socketRef.current = null;
    }
  };
}, [currentUserName, project?._id, token]);





function updateCode(value) {
  if (readOnly) return;

  const nextCode = value ?? "";
  const sharedDoc = yDocsRef.current[activeFile];
  const sharedText = sharedDoc?.getText("code");

  if (sharedDoc && sharedText && sharedText.toString() !== nextCode) {
    sharedDoc.transact(() => {
      if (sharedText.length > 0) {
        sharedText.delete(0, sharedText.length);
      }
      if (nextCode.length > 0) {
        sharedText.insert(0, nextCode);
      }
    });
  }

  setFiles((current) => ({
    ...current,
    [activeFile]: nextCode,
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
          {connectionStatus}
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
                Each file syncs and saves independently.
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
    glyphMargin: true,
    readOnly,
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

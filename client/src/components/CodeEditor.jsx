
import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { io } from "socket.io-client";
import * as Y from "yjs";
import { MonacoBinding } from "y-monaco";
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
const extensionLanguages = {
  py: "python",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  go: "go",
  rs: "rust",
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  html: "html",
  htm: "html",
  css: "css",
  json: "json",
  md: "markdown",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  sh: "shell",
  sql: "sql",
};
const executionExtensions = {
  py: "python",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  go: "go",
  rs: "rust",
  js: "node",
};
const MAX_PROJECT_FILE_BYTES = 64 * 1024;

function getFileLanguage(fileName) {
  if (fileLanguages[fileName]) return fileLanguages[fileName];
  return extensionLanguages[fileName.split(".").pop().toLowerCase()] || "plaintext";
}

function getExecutionLanguage(fileName) {
  return executionExtensions[fileName.split(".").pop().toLowerCase()] || "";
}

function hasInvalidFileNameCharacters(fileName) {
  return (
    /[<>:"|?*\\/]/.test(fileName) ||
    Array.from(fileName).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  );
}

function getFileIcon(fileName) {
  const extension = fileName.split(".").pop().toLowerCase();
  const icons = {
    css: "#",
    py: "PY",
    java: "J",
    c: "C",
    h: "C",
    cpp: "C++",
    cc: "C++",
    cxx: "C++",
    go: "GO",
    rs: "RS",
    md: "M",
  };
  return icons[extension] || (["js", "jsx", "ts", "tsx"].includes(extension) ? "JS" : "•");
}

function createPreviewDocument(html, css) {
  const safeCss = css.replace(/<\/style/gi, "<\\/style");
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
    <style>${safeCss}</style>
  </head>
  <body>${html}</body>
</html>`;
}

function CodeEditor({ project, token, user, readOnly = false, onBack }) {
  const [files, setFiles] = useState(initialFiles);
  const [editorReadOnly, setEditorReadOnly] = useState(readOnly);
  const [projectMembers, setProjectMembers] = useState(project?.members || []);
  const [onlineCollaborators, setOnlineCollaborators] = useState([]);
  const [accessRevoked, setAccessRevoked] = useState(false);

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
  const [openTabs, setOpenTabs] = useState(["App.jsx"]);
  const [fileMenuOpen, setFileMenuOpen] = useState("");
  const [renamingFile, setRenamingFile] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
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

  const language = getFileLanguage(activeFile);
  const [sidebarView, setSidebarView] = useState("explorer");
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [assistantMessage, setAssistantMessage] = useState("");
  const [terminalMessage, setTerminalMessage] = useState(
    "MergeMind workspace ready."
  );
  const [runCount, setRunCount] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [executionHtml, setExecutionHtml] = useState("");
  const [executionCss, setExecutionCss] = useState("");
  const [executionOutput, setExecutionOutput] = useState("");
  const [executionErrors, setExecutionErrors] = useState("");
  const [executionInput, setExecutionInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchJump, setSearchJump] = useState(null);
  const [newFileName, setNewFileName] = useState("");
  const [fileActionMessage, setFileActionMessage] = useState("");
  const [connectionStatus, setConnectionStatus] = useState(
    hasCollaborationContext ? "Connecting..." : "Local preview"
  );
const socketRef = useRef(null);
const yDocsRef = useRef({});
const bindingRef = useRef(null);
const installProjectFileRef = useRef(null);
const replaceProjectFileRef = useRef(null);
const removeProjectFileRef = useRef(null);
const uploadInputRef = useRef(null);

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
  if (searchJump?.fileName !== activeFile || !editorRef.current) return;

  editorRef.current.revealLineInCenter(searchJump.lineNumber);
  editorRef.current.setPosition({
    lineNumber: searchJump.lineNumber,
    column: searchJump.column,
  });
  editorRef.current.focus();
}, [activeFile, searchJump, docVersion]);


useEffect(() => {
  if (!token || !project?._id) return;

  const projectId = String(project._id);
  let disposed = false;
  let docs = {};
  let initializingDocs = false;
  const pendingRemoteUpdates = [];
  const pendingCreatedFiles = [];
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
  const handleBrowserOffline = () => {
    setConnectionStatus("Offline");
    setSaveStatus("Offline edits will sync when reconnected");
  };
  const handleBrowserOnline = () => {
    if (!socket.connected) {
      setConnectionStatus("Reconnecting...");
      setSaveStatus("Syncing when reconnected");
    }
  };

  socket.io.on("reconnect_attempt", handleReconnectAttempt);
  socket.io.on("reconnect_failed", handleReconnectFailed);
  window.addEventListener("offline", handleBrowserOffline);
  window.addEventListener("online", handleBrowserOnline);
  if (!window.navigator.onLine) handleBrowserOffline();

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

  const installProjectFile = (fileName, file) => {
    if (docs[fileName] || !file) return;

    const doc = new Y.Doc();
    if (file.yjsState) {
      Y.applyUpdate(doc, decodeBase64(file.yjsState), "remote");
    } else if (typeof file.content === "string" && file.content) {
      doc.getText("code").insert(0, file.content);
    }

    const sharedText = doc.getText("code");
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
    docs[fileName] = { doc, sharedText, updateHandler, textHandler };
    yDocsRef.current = {
      ...yDocsRef.current,
      [fileName]: doc,
    };
    setFiles((current) => ({
      ...current,
      [fileName]: sharedText.toString(),
    }));
    setDocVersion((version) => version + 1);
  };
  installProjectFileRef.current = installProjectFile;

  const replaceProjectFile = (oldName, newName, file) => {
    const oldEntry = docs[oldName];
    if (oldEntry) {
      oldEntry.doc.off("update", oldEntry.updateHandler);
      oldEntry.sharedText.unobserve(oldEntry.textHandler);
      oldEntry.doc.destroy();
      delete docs[oldName];
      const nextDocs = { ...yDocsRef.current };
      delete nextDocs[oldName];
      yDocsRef.current = nextDocs;
    }

    setFiles((current) => {
      const next = { ...current };
      delete next[oldName];
      next[newName] = file.content || "";
      return next;
    });
    setOpenTabs((current) =>
      current.map((fileName) => (fileName === oldName ? newName : fileName))
    );
    if (activeFileRef.current === oldName) {
      setActiveFile(newName);
    }
    installProjectFile(newName, file);
  };

  const removeProjectFile = (fileName) => {
    const entry = docs[fileName];
    if (entry) {
      entry.doc.off("update", entry.updateHandler);
      entry.sharedText.unobserve(entry.textHandler);
      entry.doc.destroy();
      delete docs[fileName];
      const nextDocs = { ...yDocsRef.current };
      delete nextDocs[fileName];
      yDocsRef.current = nextDocs;
    }

    setFiles((current) => {
      const next = { ...current };
      delete next[fileName];
      return next;
    });
    setOpenTabs((current) => current.filter((name) => name !== fileName));
    if (activeFileRef.current === fileName) {
      setActiveFile("App.jsx");
    }
  };
  replaceProjectFileRef.current = replaceProjectFile;
  removeProjectFileRef.current = removeProjectFile;

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
        const message = result?.message || "Join failed";
        if (/access|permission|member/i.test(message)) {
          setAccessRevoked(true);
          setEditorReadOnly(true);
          setOnlineCollaborators([]);
          setConnectionStatus("Access revoked");
          setSaveStatus("Project access was removed");
        } else {
          setConnectionStatus(message);
          setSaveStatus("Load failed");
        }
        setCodeLoading(false);
        initializingDocs = false;
        return;
      }
      setAccessRevoked(false);
      setEditorReadOnly(
        !["owner", "admin", "editor"].includes(result.role)
      );
      setConnectionStatus("Connected");

      const nextDocs = {};

      try {
        const reconciliationRequests = [];

        const fileNames = new Set([
          ...Object.keys(initialFiles),
          ...Object.keys(result.files || {}),
        ]);
        for (const fileName of fileNames) {
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
                : initialFiles[fileName] || "";

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
        pendingCreatedFiles.splice(0).forEach(({ fileName, file }) =>
          installProjectFile(fileName, file)
        );
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

  socket.on("project:file-created", (event = {}) => {
    if (
      disposed ||
      String(event.projectId) !== projectId ||
      typeof event.fileName !== "string"
    ) {
      return;
    }

    const file = {
      content: event.content || "",
      yjsState: event.yjsState || "",
    };
    if (initializingDocs) {
      pendingCreatedFiles.push({ fileName: event.fileName, file });
    } else {
      installProjectFile(event.fileName, file);
    }
  });

  socket.on("project:file-renamed", (event = {}) => {
    if (
      disposed ||
      String(event.projectId) !== projectId ||
      typeof event.oldName !== "string" ||
      typeof event.newName !== "string" ||
      !event.file
    ) {
      return;
    }
    replaceProjectFile(event.oldName, event.newName, event.file);
    setFileActionMessage(`${event.oldName} was renamed to ${event.newName}.`);
  });

  socket.on("project:file-deleted", (event = {}) => {
    if (
      disposed ||
      String(event.projectId) !== projectId ||
      typeof event.fileName !== "string"
    ) {
      return;
    }
    removeProjectFile(event.fileName);
    setFileActionMessage(`${event.fileName} was deleted.`);
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
      typeof fileName !== "string" ||
      (!initializingDocs &&
        !Object.prototype.hasOwnProperty.call(docs, fileName))
    ) {
      return;
    }

    if (initializingDocs || !docs[fileName]) {
      pendingRemoteUpdates.push({ fileName, update, userName, lineNumber });
      return;
    }

    applyRemoteUpdate({ fileName, update, userName, lineNumber });
  });

  socket.on("project:presence", ({ projectId: incomingId, collaborators } = {}) => {
    if (
      !disposed &&
      String(incomingId) === projectId &&
      Array.isArray(collaborators)
    ) {
      setOnlineCollaborators(collaborators);
    }
  });

  socket.on("project:members", ({ projectId: incomingId, members } = {}) => {
    if (
      !disposed &&
      String(incomingId) === projectId &&
      Array.isArray(members)
    ) {
      setProjectMembers(members);
    }
  });

  socket.on("project:role-updated", ({ projectId: incomingId, role } = {}) => {
    if (disposed || String(incomingId) !== projectId) return;

    const canEdit = ["owner", "admin", "editor"].includes(role);
    setEditorReadOnly(!canEdit);
    setSaveStatus(canEdit ? "Edit access updated" : "View-only access");
  });

  socket.on("project:access-revoked", ({ projectId: incomingId } = {}) => {
    if (disposed || String(incomingId) !== projectId) return;

    setAccessRevoked(true);
    setEditorReadOnly(true);
    setConnectionStatus("Access revoked");
    setSaveStatus("Project access was removed");
    setOnlineCollaborators([]);
  });

  socket.on("connect_error", (error) => {
    const message = error?.message || "Connection failed";

    if (!window.navigator.onLine) {
      handleBrowserOffline();
      setCodeLoading(false);
      return;
    }

    if (/invalid|expired|authentication|required/i.test(message)) {
      localStorage.removeItem("mergemind_token");
      setEditorReadOnly(true);
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
    if (!window.navigator.onLine) {
      handleBrowserOffline();
    } else {
      setConnectionStatus("Disconnected");
      setSaveStatus("Connection lost");
    }
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
    installProjectFileRef.current = null;
    replaceProjectFileRef.current = null;
    removeProjectFileRef.current = null;
    bindingRef.current?.destroy();
    bindingRef.current = null;

    socket.emit("project:leave", { projectId });
    socket.disconnect();
    socket.io.off("reconnect_attempt", handleReconnectAttempt);
    socket.io.off("reconnect_failed", handleReconnectFailed);
    window.removeEventListener("offline", handleBrowserOffline);
    window.removeEventListener("online", handleBrowserOnline);

    if (socketRef.current === socket) {
      socketRef.current = null;
    }
  };
}, [currentUserName, project?._id, token]);





function updateCode(value) {
  if (editorReadOnly || accessRevoked) return;

  if (yDocsRef.current[activeFile]) return;

  setFiles((current) => ({
    ...current,
    [activeFile]: value ?? "",
  }));
}



async function handleRun() {
  const selectedExecutionLanguage = getExecutionLanguage(activeFile);
  if (activeFile !== "App.jsx" && !selectedExecutionLanguage) {
    setTerminalMessage("Select a runnable source file before running code.");
    setTerminalOpen(true);
    return;
  }

  if (editorReadOnly || accessRevoked) {
    setTerminalMessage("You do not have permission to run this project.");
    setTerminalOpen(true);
    return;
  }

  setRunCount((count) => count + 1);
  setIsRunning(true);
  setExecutionHtml("");
  setExecutionOutput("");
  setExecutionErrors("");
  setTerminalMessage(`Running ${activeFile} in an isolated container...`);
  setTerminalOpen(true);

  const getCurrentFile = (fileName) =>
    yDocsRef.current[fileName]?.getText("code").toString() ??
    files[fileName] ??
    "";

  try {
    const requestBody =
      activeFile === "App.jsx"
        ? {
            files: {
              "App.jsx": getCurrentFile("App.jsx"),
              "App.css": getCurrentFile("App.css"),
            },
          }
        : {
            language: selectedExecutionLanguage,
            source: getCurrentFile(activeFile),
            stdin: executionInput,
          };
    const result = await apiRequest(
      `/projects/${project._id}/run`,
      {
        method: "POST",
        body: JSON.stringify(requestBody),
      },
      token
    );

    setExecutionHtml(result.html || "");
    setExecutionCss(result.css || "");
    setExecutionOutput(result.output || "");
    setExecutionErrors(
      [result.error, result.errors].filter(Boolean).join("\n")
    );
    setTerminalMessage(
      result.error
        ? "Execution failed."
        : "Execution finished successfully."
    );
  } catch (error) {
    setExecutionErrors(error.message || "Could not run project code.");
    setTerminalMessage("Execution failed.");
  } finally {
    setIsRunning(false);
  }
}

function getSearchResults() {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return [];

  const results = [];
  for (const [fileName, content] of Object.entries(files)) {
    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const column = lines[index].toLowerCase().indexOf(query);
      if (column < 0) continue;

      results.push({
        fileName,
        lineNumber: index + 1,
        column: column + 1,
        text: lines[index].trim() || "(empty line)",
      });
      if (results.length >= 100) return results;
    }
  }

  return results;
}

function openSearchResult(result) {
  setSearchJump(result);
  openFile(result.fileName);
}

function openFile(fileName) {
  setActiveFile(fileName);
  setOpenTabs((current) =>
    current.includes(fileName) ? current : [...current, fileName]
  );
}

function closeFileTab(fileName) {
  const index = openTabs.indexOf(fileName);
  if (index < 0) return;

  const next = openTabs.filter((name) => name !== fileName);
  setOpenTabs(next);
  if (activeFileRef.current === fileName) {
    setActiveFile(next[Math.min(index, next.length - 1)] || "");
  }
}

function requestSocketAction(eventName, payload) {
  const socket = socketRef.current;
  if (!socket?.connected) {
    return Promise.reject(
      new Error("Connect to the project before changing files.")
    );
  }

  return new Promise((resolve, reject) => {
    socket.timeout(10000).emit(eventName, payload, (error, result) => {
      if (error) {
        reject(new Error("Timed out while updating project files."));
      } else if (!result?.ok) {
        reject(new Error(result?.message || "Could not update project files."));
      } else {
        resolve(result);
      }
    });
  });
}

async function renameProjectFile(oldName) {
  const newName = renameDraft.trim();
  if (!newName || newName === oldName) {
    setRenamingFile("");
    setRenameDraft("");
    return;
  }

  if (
    new TextEncoder().encode(newName).byteLength > 128 ||
    hasInvalidFileNameCharacters(newName) ||
    newName === "." ||
    newName === ".." ||
    newName.endsWith(".") ||
    newName.endsWith(" ")
  ) {
    throw new Error("Enter a valid filename without folder paths.");
  }
  if (
    Object.keys(files).some(
      (fileName) =>
        fileName !== oldName && fileName.toLowerCase() === newName.toLowerCase()
    )
  ) {
    throw new Error("A file with that name already exists.");
  }

  if (hasCollaborationContext) {
    const result = await requestSocketAction("project:rename-file", {
      projectId: String(project._id),
      oldName,
      newName,
    });
    replaceProjectFileRef.current?.(oldName, newName, result.file);
  } else {
    const content = files[oldName] || "";
    setFiles((current) => {
      const next = { ...current };
      delete next[oldName];
      next[newName] = content;
      return next;
    });
    setOpenTabs((current) =>
      current.map((fileName) => (fileName === oldName ? newName : fileName))
    );
    if (activeFileRef.current === oldName) setActiveFile(newName);
  }

  setFileActionMessage(`${oldName} renamed to ${newName}.`);
  setRenamingFile("");
  setRenameDraft("");
}

async function deleteProjectFile(fileName) {
  if (Object.hasOwn(initialFiles, fileName)) {
    setFileActionMessage("Built-in workspace files cannot be deleted.");
    return;
  }
  if (!window.confirm(`Delete ${fileName}? This cannot be undone.`)) return;

  try {
    if (hasCollaborationContext) {
      await requestSocketAction("project:delete-file", {
        projectId: String(project._id),
        fileName,
      });
    }
    if (hasCollaborationContext) {
      removeProjectFileRef.current?.(fileName);
    } else {
      setFiles((current) => {
        const next = { ...current };
        delete next[fileName];
        return next;
      });
      setOpenTabs((current) => current.filter((name) => name !== fileName));
      if (activeFileRef.current === fileName) setActiveFile("App.jsx");
    }
    setFileActionMessage(`${fileName} deleted.`);
    setFileMenuOpen("");
  } catch (error) {
    setFileActionMessage(error.message || "Could not delete file.");
  }
}

async function createProjectFile(fileName, content = "") {
  const trimmedName = fileName.trim();
  if (
    !trimmedName ||
    new TextEncoder().encode(trimmedName).byteLength > 128 ||
    hasInvalidFileNameCharacters(trimmedName) ||
    trimmedName === "." ||
    trimmedName === ".." ||
    trimmedName.endsWith(".") ||
    trimmedName.endsWith(" ")
  ) {
    throw new Error("Enter a valid file name without folders or path separators.");
  }
  if (new TextEncoder().encode(content).byteLength > MAX_PROJECT_FILE_BYTES) {
    throw new Error("Files must be 64 KB or smaller.");
  }
  if (
    Object.keys(files).some(
      (existingName) => existingName.toLowerCase() === trimmedName.toLowerCase()
    )
  ) {
    throw new Error("A file with that name is already open.");
  }

  if (hasCollaborationContext) {
    const result = await requestSocketAction("project:create-file", {
      projectId: String(project._id),
      fileName: trimmedName,
      content,
    });

    installProjectFileRef.current?.(trimmedName, result.file);
  } else {
    setFiles((current) => ({ ...current, [trimmedName]: content }));
  }

  openFile(trimmedName);
  setFileActionMessage(
    hasCollaborationContext
      ? `${trimmedName} created and saved.`
      : `${trimmedName} created locally. Save a copy to keep it.`
  );
}

async function handleCreateFile(event) {
  event.preventDefault();
  if (editorReadOnly || accessRevoked) return;

  try {
    await createProjectFile(newFileName);
    setNewFileName("");
  } catch (error) {
    setFileActionMessage(error.message || "Could not create file.");
  }
}

async function handleUploadFiles(event) {
  const selectedFiles = Array.from(event.target.files || []);
  if (!selectedFiles.length) return;
  if (editorReadOnly || accessRevoked) {
    setFileActionMessage("You do not have permission to upload files.");
    event.target.value = "";
    return;
  }

  for (const file of selectedFiles) {
    try {
      if (file.size > MAX_PROJECT_FILE_BYTES) {
        throw new Error(`${file.name} exceeds the 64 KB file limit.`);
      }

      let content;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(
          await file.arrayBuffer()
        );
      } catch {
        throw new Error(`${file.name} is not a UTF-8 text file.`);
      }
      if (content.includes("\0")) {
        throw new Error(`${file.name} is not a supported text file.`);
      }

      await createProjectFile(file.name, content);
    } catch (error) {
      setFileActionMessage(error.message || `Could not upload ${file.name}.`);
      break;
    }
  }

  event.target.value = "";
}

function saveActiveFile() {
  const content =
    yDocsRef.current[activeFile]?.getText("code").toString() ??
    files[activeFile] ??
    "";
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/plain;charset=utf-8" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = activeFile;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  setFileActionMessage(`${activeFile} downloaded.`);
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
          <span className="ide-branch">Git unavailable</span>
          <button
            className="ide-action-button"
            onClick={() => {
              navigator.clipboard?.writeText(window.location.href);
              setTerminalMessage("Workspace link copy requested.");
            }}
          >
            Share
          </button>
          <button
            className="ide-run-button"
            onClick={handleRun}
            disabled={
              isRunning ||
              editorReadOnly ||
              accessRevoked ||
              (activeFile !== "App.jsx" && !getExecutionLanguage(activeFile))
            }
            title={
              activeFile === "README.md"
                ? "Markdown files cannot be run"
                : "Run the selected file in an isolated container"
            }
          >
            {isRunning ? "Running..." : "▶ Run"}
          </button>
        </div>
      </header>

      <div className="ide-projectbar">
        <div className="ide-current-file">
          <span className="ide-live-dot" />
          {project?.name || "Project"}
          <span className="ide-save-status">{saveStatus}</span>
          {lastEditedBy && (
            <span className="ide-last-edited">{lastEditedBy}</span>
          )}
        </div>

        <div
          className={`ide-session-status ${
            connectionStatus === "Connected"
              ? "is-connected"
              : /connecting|joining/i.test(connectionStatus)
                ? "is-connecting"
                : "is-disconnected"
          }`}
        >
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
              <div className="ide-explorer-heading">
                <strong>EXPLORER</strong>
                <div>
                  <button
                    type="button"
                    title="New file"
                    aria-label="New file"
                    onClick={() => document.getElementById("new-project-file")?.focus()}
                    disabled={editorReadOnly || accessRevoked}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    title="Upload text files"
                    aria-label="Upload text files"
                    onClick={() => uploadInputRef.current?.click()}
                    disabled={editorReadOnly || accessRevoked}
                  >
                    ↑
                  </button>
                </div>
              </div>

              <form className="ide-new-file-form" onSubmit={handleCreateFile}>
                <input
                  id="new-project-file"
                  aria-label="New file name"
                  placeholder="New file name"
                  value={newFileName}
                  onChange={(event) => setNewFileName(event.target.value)}
                  disabled={editorReadOnly || accessRevoked}
                />
                <button
                  type="submit"
                  title="Create file"
                  aria-label="Create file"
                  disabled={
                    editorReadOnly || accessRevoked || !newFileName.trim()
                  }
                >
                  Create
                </button>
              </form>
              <input
                ref={uploadInputRef}
                className="ide-upload-input"
                type="file"
                multiple
                aria-label="Upload project text files"
                onChange={handleUploadFiles}
              />
              {fileActionMessage && (
                <p className="ide-file-action-message" role="status">
                  {fileActionMessage}
                </p>
              )}
              <div className="ide-folder-name">⌄ {project?.name || "Project"}</div>

              {Object.keys(files).map((file) => (
                <div
                  key={file}
                  className={`ide-file-row ${
                    activeFile === file ? "active" : ""
                  }`}
                >
                  {renamingFile === file ? (
                    <form
                      className="ide-file-rename-form"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        try {
                          await renameProjectFile(file);
                        } catch (error) {
                          setFileActionMessage(
                            error.message || "Could not rename file."
                          );
                        }
                      }}
                    >
                      <input
                        autoFocus
                        aria-label={`Rename ${file}`}
                        value={renameDraft}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setRenamingFile("");
                        }}
                      />
                      <button type="submit" aria-label="Confirm rename">
                        ↵
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="ide-file"
                        onClick={() => openFile(file)}
                        title={file}
                      >
                        <span className="ide-file-icon">
                          {getFileIcon(file)}
                        </span>
                        <span className="ide-file-name">{file}</span>
                      </button>
                      {!Object.hasOwn(initialFiles, file) && (
                        <div className="ide-file-actions">
                          <button
                            type="button"
                            className="ide-file-menu-button"
                            title={`File actions for ${file}`}
                            aria-label={`File actions for ${file}`}
                            aria-expanded={fileMenuOpen === file}
                            onClick={() =>
                              setFileMenuOpen((current) =>
                                current === file ? "" : file
                              )
                            }
                            disabled={editorReadOnly || accessRevoked}
                          >
                            ⋯
                          </button>
                          {fileMenuOpen === file && (
                            <div className="ide-file-menu">
                              <button
                                type="button"
                                onClick={() => {
                                  setRenameDraft(file);
                                  setRenamingFile(file);
                                  setFileMenuOpen("");
                                }}
                              >
                                Rename
                              </button>
                              <button
                                type="button"
                                className="is-danger"
                                onClick={() => deleteProjectFile(file)}
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}

              <button
                type="button"
                className="ide-save-file-button"
                onClick={saveActiveFile}
                disabled={!activeFile || !Object.hasOwn(files, activeFile)}
              >
                Save a copy of {activeFile}
              </button>
              <div className="ide-explorer-note">
                Project edits save automatically. Upload plain-text files up to
                64 KB, or save the open file to your device.
              </div>
            </>
          )}

          {sidebarView === "search" && (
            <>
              <div className="ide-pane-title">SEARCH</div>
              <input
                className="ide-search-input"
                type="search"
                aria-label="Search project files"
                placeholder="Search in files"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              <div className="ide-search-results">
                {getSearchResults().map((result) => (
                  <button
                    className="ide-search-result"
                    key={`${result.fileName}:${result.lineNumber}`}
                    onClick={() => openSearchResult(result)}
                  >
                    <strong>
                      {result.fileName}:{result.lineNumber}
                    </strong>
                    <span>{result.text}</span>
                  </button>
                ))}
                {searchQuery.trim() && !getSearchResults().length && (
                  <p className="ide-sidebar-message">No matches found.</p>
                )}
              </div>
            </>
          )}

          {sidebarView === "source" && (
            <>
              <div className="ide-pane-title">SOURCE CONTROL</div>
              <p className="ide-sidebar-message">
                Git repositories are not connected to projects yet. Source
                control actions are unavailable.
              </p>
            </>
          )}

          {sidebarView === "members" && (
            <>
              <div className="ide-pane-title">
                COLLABORATORS
                <span>{onlineCollaborators.length} online</span>
              </div>
              <div className="ide-member-list">
                {projectMembers.map((member) => {
                  const memberUser = member.user;
                  const memberId = String(
                    member.userId ||
                      (typeof memberUser === "string"
                        ? memberUser
                        : memberUser?._id || memberUser?.id) ||
                      ""
                  );
                  const name =
                    member.name ||
                    memberUser?.name ||
                    member.email ||
                    memberUser?.email ||
                    "Collaborator";
                  const isOnline = onlineCollaborators.some(
                    (collaborator) =>
                      String(collaborator.userId) === memberId
                  );

                  return (
                    <div className="ide-member" key={memberId || name}>
                      <span className="ide-member-avatar">
                        {name.charAt(0).toUpperCase()}
                      </span>
                      <span className="ide-member-details">
                        <strong>
                          {name}
                          {memberId === String(user?.id || user?._id) &&
                            " (you)"}
                        </strong>
                        <span>{member.role || "viewer"}</span>
                      </span>
                      <span
                        className={`ide-member-presence ${
                          isOnline ? "is-online" : ""
                        }`}
                        title={isOnline ? "Online" : "Offline"}
                      >
                        {isOnline ? "Online" : "Offline"}
                      </span>
                    </div>
                  );
                })}
                {!projectMembers.length && (
                  <p className="ide-sidebar-message">
                    No project members are available.
                  </p>
                )}
              </div>
            </>
          )}
        </aside>

        <section className="ide-main">
          <div className="ide-tabs">
            {openTabs.map((file) => (
              <div
                key={file}
                className={`ide-tab ${activeFile === file ? "active" : ""}`}
              >
                <button
                  type="button"
                  className="ide-tab-select"
                  onClick={() => setActiveFile(file)}
                  title={file}
                >
                  <span className="ide-file-icon">{getFileIcon(file)}</span>
                  <span className="ide-tab-name">{file}</span>
                </button>
                <button
                  type="button"
                  className="ide-tab-close"
                  title={`Close ${file}`}
                  aria-label={`Close ${file}`}
                  onClick={() => closeFileTab(file)}
                >
                  ×
                </button>
              </div>
            ))}
            {openTabs.length > 1 && (
              <button
                type="button"
                className="ide-close-all-tabs"
                title="Close all tabs"
                aria-label="Close all tabs"
                onClick={() => {
                  setOpenTabs([]);
                  setActiveFile("");
                }}
              >
                ×
              </button>
            )}
          </div>

          {activeFile ? (
            <>
              <div className="ide-editor-heading">
                <span>src</span> / <strong>{activeFile}</strong>
                <span className="ide-editor-meta">
                  {language} · UTF-8 · Spaces: 2
                </span>
              </div>

              <div className="ide-monaco">
                {codeLoading ? (
                  <div className="ide-loading">Loading saved code...</div>
                ) : (
                  <Editor
                    key={activeFile}
                    height="100%"
                    language={language}
                    theme="vs-dark"
                    defaultValue={files[activeFile] || ""}
                    onChange={updateCode}
                    onMount={(editor, monaco) => {
                      editorRef.current = editor;
                      monacoRef.current = monaco;
                      bindEditorToSharedText();
                      showEditorBadge(
                        currentUserName,
                        editor.getPosition()?.lineNumber || 1
                      );
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
                      readOnly: editorReadOnly,
                    }}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="ide-no-open-files">
              <strong>No open files</strong>
              <span>Select a file from the Explorer to open it.</span>
            </div>
          )}

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
                {getExecutionLanguage(activeFile) && (
                  <label className="ide-stdin-input">
                    <span>STANDARD INPUT</span>
                    <textarea
                      aria-label="Program standard input"
                      value={executionInput}
                      onChange={(event) => setExecutionInput(event.target.value)}
                      placeholder="Optional input passed to your program"
                      rows={2}
                    />
                  </label>
                )}
                <span className="terminal-prompt">›</span>
                {terminalMessage}
                {executionOutput && (
                  <pre className="ide-execution-output">{executionOutput}</pre>
                )}
                {executionErrors && (
                  <pre className="ide-execution-errors">{executionErrors}</pre>
                )}
                {executionHtml && (
                  <iframe
                    className="ide-execution-preview"
                    title="Isolated project preview"
                    sandbox=""
                    referrerPolicy="no-referrer"
                    srcDoc={createPreviewDocument(
                      executionHtml,
                      executionCss
                    )}
                  />
                )}
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
            <span>{(files[activeFile] || "").split("\n").length} lines</span>
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

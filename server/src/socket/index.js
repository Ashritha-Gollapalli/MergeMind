
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Y = require("yjs");
const Project = require("../models/Project");
const User = require("../models/User");

const documents = new Map();
const documentLoads = new Map();
const persistenceQueues = new Map();
const DEFAULT_FILES = {
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
const FILE_STORAGE_KEYS = {
  "App.jsx": "appJsx",
  "App.css": "appCss",
  "README.md": "readmeMd",
};

function getDocumentKey(projectId, fileName) {
  return `${projectId}:${fileName}`;
}

function getRoom(projectId) {
  return `project:${projectId}`;
}

function decodeBase64Update(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value
    )
  ) {
    return null;
  }

  const bytes = Buffer.from(value, "base64");
  return bytes.toString("base64") === value ? new Uint8Array(bytes) : null;
}

async function loadDocument(projectId, fileName = "App.jsx") {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_FILES, fileName)) {
    throw new Error("Unsupported project file.");
  }

  const key = getDocumentKey(projectId, fileName);
  const existing = documents.get(key);

  if (existing) return existing;
  if (documentLoads.has(key)) return documentLoads.get(key);

  const loading = initializeDocument(projectId, fileName, key);
  documentLoads.set(key, loading);

  try {
    return await loading;
  } finally {
    if (documentLoads.get(key) === loading) {
      documentLoads.delete(key);
    }
  }
}

async function initializeDocument(projectId, fileName, key) {
  const project = await Project.findById(projectId).select(
    "_id code yjsState files"
  );

  if (!project) throw new Error("Project not found.");

  const storageKey = FILE_STORAGE_KEYS[fileName];
  const file =
    project.files?.get(storageKey) ||
    project.files?.get(fileName);
  const doc = new Y.Doc();

  if (file?.yjsState) {
    const state = Buffer.from(file.yjsState, "base64");
    Y.applyUpdate(doc, new Uint8Array(state));
  } else {
    let initialContent =
      typeof file?.content === "string" && file.content.length > 0
        ? file.content
        : "";

    // Migrate the legacy single-code document into App.jsx.
    if (fileName === "App.jsx" && !initialContent) {
      if (project.yjsState) {
        const legacyDoc = new Y.Doc();

        Y.applyUpdate(
          legacyDoc,
          new Uint8Array(Buffer.from(project.yjsState, "base64"))
        );

        initialContent = legacyDoc.getText("code").toString();
        legacyDoc.destroy();
      } else {
        initialContent = project.code || "";
      }
    }

    if (!initialContent) {
      initialContent = DEFAULT_FILES[fileName];
    }

    if (initialContent) {
      doc.getText("code").insert(0, initialContent);
    }
  }

  const entry = { doc };
  documents.set(key, entry);

  doc.on("update", () => {
    const previous = persistenceQueues.get(key) || Promise.resolve();

    const next = previous
      .catch(() => {})
      .then(async () => {
        const current = documents.get(key);

        if (!current || current.doc !== doc) return;

        const state = Y.encodeStateAsUpdate(doc);
        const content = doc.getText("code").toString();
        const encodedState = Buffer.from(state).toString("base64");

        const setFields = {
          [`files.${storageKey}.content`]: content,
          [`files.${storageKey}.yjsState`]: encodedState,
        };

        if (fileName === "App.jsx") {
          setFields.code = content;
          setFields.yjsState = encodedState;
        }

        await Project.updateOne(
          { _id: projectId },
          { $set: setFields }
        );
      });

    persistenceQueues.set(key, next);

    next.catch((error) => {
      console.error(`Yjs persistence failed for ${fileName}:`, error);
    });
  });

  // Persist the initial document state and any legacy content migration.
  const initialState = Y.encodeStateAsUpdate(doc);
  const initialContent = doc.getText("code").toString();
  const encodedInitialState = Buffer.from(initialState).toString("base64");

  const setFields = {
    [`files.${storageKey}.content`]: initialContent,
    [`files.${storageKey}.yjsState`]: encodedInitialState,
  };

  if (fileName === "App.jsx") {
    setFields.code = initialContent;
    setFields.yjsState = encodedInitialState;
  }

  await Project.updateOne({ _id: projectId }, { $set: setFields });

  return entry;
}


function registerSocketHandlers(io) {
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;

      if (!token) {
        return next(new Error("Authentication required."));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = decoded.sub || decoded.id || decoded.userId || decoded._id;

      if (!userId || !mongoose.isValidObjectId(userId)) {
        return next(new Error("Invalid authentication token."));
      }

      socket.userId = userId.toString();

      User.findById(userId)
        .select("name email")
        .then((user) => {
          socket.userName = user?.name || user?.email || "Collaborator";
          next();
        })
        .catch(() => {
          socket.userName = "Collaborator";
          next();
        });
    } catch {
      next(new Error("Invalid or expired authentication token."));
    }
  });

  io.on("connection", (socket) => {
    socket.on("project:join", async ({ projectId } = {}, callback) => {
      try {
        if (!mongoose.isValidObjectId(projectId)) {
          return callback?.({
            ok: false,
            message: "Invalid project ID.",
          });
        }

        const project = await Project.findOne({
          _id: projectId,
          members: {
            $elemMatch: {
              user: socket.userId,
            },
          },
        }).select("_id");

        if (!project) {
          return callback?.({
            ok: false,
            message: "You do not have access to this project.",
          });
        }

        await socket.join(getRoom(projectId));

        const fileDocuments = {};

        for (const fileName of Object.keys(DEFAULT_FILES)) {
          const { doc } = await loadDocument(projectId.toString(), fileName);
          const state = Y.encodeStateAsUpdate(doc);

          fileDocuments[fileName] = {
            content: doc.getText("code").toString(),
            yjsState: Buffer.from(state).toString("base64"),
          };
        }

        callback?.({
          ok: true,
          projectId: projectId.toString(),
          files: fileDocuments,
          yjsState: fileDocuments["App.jsx"].yjsState,
        });
      } catch (error) {
        console.error("Socket project join failed:", error);
        callback?.({
          ok: false,
          message: "Could not join project session.",
        });
      }
    });

    socket.on("project:leave", ({ projectId } = {}) => {
      if (mongoose.isValidObjectId(projectId)) {
        socket.leave(getRoom(projectId));
      }
    });

    socket.on(
      "project:yjs-update",
      async (
        { projectId, fileName = "App.jsx", update, lineNumber } = {},
        callback
      ) => {
        try {
          if (
            !mongoose.isValidObjectId(projectId) ||
            !Object.prototype.hasOwnProperty.call(DEFAULT_FILES, fileName) ||
            typeof update !== "string" ||
            update.length > 3 * 1024 * 1024
          ) {
            return callback?.({
              ok: false,
              message: "Invalid collaborative update.",
            });
          }

          if (!socket.rooms.has(getRoom(projectId))) {
            return callback?.({
              ok: false,
              message: "Join the project before editing.",
            });
          }

          const project = await Project.findOne({
            _id: projectId,
            members: {
              $elemMatch: {
                user: socket.userId,
                role: { $in: ["owner", "admin", "editor"] },
              },
            },
          }).select("_id");

          if (!project) {
            return callback?.({
              ok: false,
              message: "You do not have permission to edit this project.",
            });
          }

          const bytes = decodeBase64Update(update);

          if (!bytes || bytes.length > 1024 * 1024) {
            return callback?.({
              ok: false,
              message: "Invalid update encoding or update exceeds 1 MB.",
            });
          }

          const { doc } = await loadDocument(projectId.toString(), fileName);

          Y.applyUpdate(doc, bytes, socket.id);

          io.to(getRoom(projectId)).emit("project:yjs-update", {
            projectId: projectId.toString(),
            fileName,
            update,
            userName: socket.userName || "Collaborator",
            lineNumber,
          });

          const pending = persistenceQueues.get(
            getDocumentKey(projectId.toString(), fileName)
          );
          if (pending) await pending;

          callback?.({ ok: true });
        } catch (error) {
          console.error("Yjs update failed:", error);
          callback?.({
            ok: false,
            message: "Could not apply collaborative update.",
          });
        }
      }
    );

    // Temporary compatibility for the existing frontend during migration.
    socket.on(
      "project:code-change",
      async ({ projectId, code } = {}, callback) => {
        try {
          if (
            !mongoose.isValidObjectId(projectId) ||
            typeof code !== "string" ||
            Buffer.byteLength(code, "utf8") > 1024 * 1024
          ) {
            return callback?.({
              ok: false,
              message: "Invalid code update.",
            });
          }

          if (!socket.rooms.has(getRoom(projectId))) {
            return callback?.({
              ok: false,
              message: "Join the project before editing.",
            });
          }

          const project = await Project.findOne({
            _id: projectId,
            members: {
              $elemMatch: {
                user: socket.userId,
                role: { $in: ["owner", "admin", "editor"] },
              },
            },
          }).select("_id");

          if (!project) {
            return callback?.({
              ok: false,
              message: "You do not have permission to edit this project.",
            });
          }

          const { doc } = await loadDocument(projectId.toString());
          const sharedText = doc.getText("code");

          doc.transact(() => {
            if (sharedText.length > 0) {
              sharedText.delete(0, sharedText.length);
            }

            if (code.length > 0) {
              sharedText.insert(0, code);
            }
          }, socket.id);

          socket.to(getRoom(projectId)).emit("project:code-change", {
            projectId: projectId.toString(),
            code,
            userId: socket.userId,
          });

          const pending = persistenceQueues.get(
            getDocumentKey(projectId.toString(), "App.jsx")
          );
          if (pending) await pending;

          callback?.({ ok: true });
        } catch (error) {
          console.error("Legacy code update failed:", error);
          callback?.({
            ok: false,
            message: "Could not save code update.",
          });
        }
      }
    );
  });
}

module.exports = { registerSocketHandlers };

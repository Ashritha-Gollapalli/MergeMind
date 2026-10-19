
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Y = require("yjs");
const Project = require("../models/Project");
const User = require("../models/User");

const documents = new Map();
const documentLoads = new Map();
const persistenceQueues = new Map();
const fileOperations = new Set();
const MAX_PROJECT_FILES = 100;
const MAX_PROJECT_FILE_BYTES = 64 * 1024;
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
  "Main.py": "mainPy",
  "Main.java": "mainJava",
  "main.c": "mainC",
  "main.cpp": "mainCpp",
  "main.go": "mainGo",
  "main.rs": "mainRs",
  "main.js": "mainJs",
};

function isValidProjectFileName(fileName) {
  return (
    typeof fileName === "string" &&
    fileName.length > 0 &&
    Buffer.byteLength(fileName, "utf8") <= 128 &&
    fileName !== "." &&
    fileName !== ".." &&
    !/[<>:"|?*]/.test(fileName) &&
    !/[\\/]/.test(fileName) &&
    !Array.from(fileName).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    }) &&
    !fileName.endsWith(".") &&
    !fileName.endsWith(" ")
  );
}

function getStorageKey(fileName) {
  return (
    FILE_STORAGE_KEYS[fileName] ||
    `user_${Buffer.from(fileName.toLowerCase(), "utf8").toString("base64url")}`
  );
}

function getDocumentKey(projectId, fileName) {
  return `${projectId}:${fileName}`;
}

function attachPersistenceHandler(projectId, fileName, storageKey, entry) {
  const updateHandler = () => {
    const key = getDocumentKey(projectId, fileName);
    const previous = persistenceQueues.get(key) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        const current = documents.get(key);
        if (!current || current.doc !== entry.doc) return;

        const state = Y.encodeStateAsUpdate(entry.doc);
        await Project.updateOne(
          { _id: projectId },
          {
            $set: {
              [`files.${storageKey}.name`]: fileName,
              [`files.${storageKey}.content`]: entry.doc
                .getText("code")
                .toString(),
              [`files.${storageKey}.yjsState`]:
                Buffer.from(state).toString("base64"),
              ...(fileName === "App.jsx"
                ? {
                    code: entry.doc.getText("code").toString(),
                    yjsState: Buffer.from(state).toString("base64"),
                  }
                : {}),
            },
          }
        );
      });

    persistenceQueues.set(key, next);
    next.catch((error) => {
      console.error(`Yjs persistence failed for ${fileName}:`, error);
    });
  };

  entry.updateHandler = updateHandler;
  entry.doc.on("update", updateHandler);
}

function removeProjectDocument(projectId, fileName) {
  const key = getDocumentKey(projectId, fileName);
  const entry = documents.get(key);
  if (entry) {
    if (entry.updateHandler) {
      entry.doc.off("update", entry.updateHandler);
    }
    entry.doc.destroy();
    documents.delete(key);
  }
  persistenceQueues.delete(key);
}

function getRoom(projectId) {
  return `project:${projectId}`;
}

function getAudioRoom(projectId) {
  return `audio:${projectId}`;
}

function getEventPayload(payload) {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : {};
}

function getAudioParticipant(socket, projectId) {
  const status = socket.data.audioStatusByProject?.[projectId] || {
    muted: true,
    speaking: false,
  };

  return {
    socketId: socket.id,
    userId: socket.data.userId,
    userName: socket.data.userName || "Collaborator",
    muted: status.muted,
    speaking: status.speaking,
  };
}

async function getRoomCollaborators(io, projectId, excludedSocketId) {
  const room = getRoom(projectId);
  const sockets = await io.in(room).fetchSockets();
  const collaborators = new Map();

  sockets
    .filter((socket) => socket.id !== excludedSocketId)
    .forEach((socket) => {
      const userId = socket.data?.userId || socket.userId;

      if (userId && !collaborators.has(userId)) {
        collaborators.set(userId, {
          userId,
          userName: socket.data?.userName || socket.userName || "Collaborator",
        });
      }
    });

  return Array.from(collaborators.values());
}

async function emitProjectPresence(io, projectId, excludedSocketId) {
  const collaborators = await getRoomCollaborators(
    io,
    projectId,
    excludedSocketId
  );

  io.to(getRoom(projectId)).emit("project:presence", {
    projectId: projectId.toString(),
    collaborators,
  });
}

async function emitProjectMembers(io, projectId) {
  const project = await Project.findById(projectId).populate(
    "members.user",
    "name email"
  );

  if (!project) return;

  const members = project.members.map((member) => {
    const memberUser = member.user;

    return {
      userId: (memberUser?._id || memberUser).toString(),
      name: memberUser?.name || memberUser?.email || "Collaborator",
      email: memberUser?.email || "",
      role: member.role,
    };
  });

  io.to(getRoom(projectId)).emit("project:members", {
    projectId: projectId.toString(),
    members,
  });
}

async function updateProjectMemberAccess(io, projectId, userId, role) {
  const room = getRoom(projectId);
  const sockets = await io.in(room).fetchSockets();
  const matchingSockets = sockets.filter(
    (socket) =>
      (socket.data?.userId || socket.userId) === userId.toString()
  );

  if (role === null) {
    for (const socket of matchingSockets) {
      socket.emit("project:access-revoked", {
        projectId: projectId.toString(),
      });
      const audioRoom = getAudioRoom(projectId);
      if (socket.rooms.has(audioRoom)) {
        socket.to(audioRoom).emit("audio:participant-left", {
          projectId: projectId.toString(),
          socketId: socket.id,
        });
        await socket.leave(audioRoom);
      }
      await socket.leave(room);
    }

    await emitProjectPresence(io, projectId);
    return;
  }

  matchingSockets.forEach((socket) => {
    socket.emit("project:role-updated", {
      projectId: projectId.toString(),
      role,
    });
  });
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
  if (!isValidProjectFileName(fileName)) {
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

  const storageKey = getStorageKey(fileName);
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
      initialContent = DEFAULT_FILES[fileName] || "";
    }

    if (initialContent) {
      doc.getText("code").insert(0, initialContent);
    }
  }

  const entry = { doc };
  documents.set(key, entry);
  attachPersistenceHandler(projectId, fileName, storageKey, entry);

  // Persist the initial document state and any legacy content migration.
  const initialState = Y.encodeStateAsUpdate(doc);
  const initialContent = doc.getText("code").toString();
  const encodedInitialState = Buffer.from(initialState).toString("base64");

  const setFields = {
    [`files.${storageKey}.name`]: fileName,
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
      socket.data.userId = socket.userId;

      User.findById(userId)
        .select("name email")
        .then((user) => {
          if (!user) {
            return next(new Error("User account no longer exists."));
          }

          socket.userName = user.name || user.email || "Collaborator";
          socket.data.userName = socket.userName;
          next();
        })
        .catch((error) => {
          console.error("Socket authentication lookup failed:", error);
          next(new Error("Authentication failed."));
        });
    } catch {
      next(new Error("Invalid or expired authentication token."));
    }
  });

  io.on("connection", (socket) => {
    socket.on("project:join", async ({ projectId } = {}, callback) => {
      let joinedRoom = false;

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
        }).select("_id members files");

        if (!project) {
          return callback?.({
            ok: false,
            message: "You do not have access to this project.",
          });
        }

        await socket.join(getRoom(projectId));
        joinedRoom = true;
        const membership = project.members.find(
          (member) => member.user.toString() === socket.userId
        );

        const fileDocuments = {};

        const fileNames = new Set(Object.keys(DEFAULT_FILES));
        const legacyNamesByStorageKey = Object.fromEntries(
          Object.entries(FILE_STORAGE_KEYS).map(([name, key]) => [key, name])
        );
        for (const [storageKey, file] of project.files?.entries?.() || []) {
          const fileName = isValidProjectFileName(file.name)
            ? file.name
            : legacyNamesByStorageKey[storageKey];
          if (isValidProjectFileName(fileName)) {
            fileNames.add(fileName);
          }
        }

        for (const fileName of fileNames) {
          const { doc } = await loadDocument(projectId.toString(), fileName);
          const state = Y.encodeStateAsUpdate(doc);

          fileDocuments[fileName] = {
            content: doc.getText("code").toString(),
            yjsState: Buffer.from(state).toString("base64"),
          };
        }

        await emitProjectPresence(io, projectId);
        callback?.({
          ok: true,
          projectId: projectId.toString(),
          role: membership.role,
          files: fileDocuments,
          yjsState: fileDocuments["App.jsx"].yjsState,
        });
      } catch (error) {
        if (joinedRoom) {
          await socket.leave(getRoom(projectId));
          await emitProjectPresence(io, projectId);
        }
        console.error("Socket project join failed:", error);
        callback?.({
          ok: false,
          message: "Could not join project session.",
        });
      }
    });

    socket.on("project:leave", ({ projectId } = {}) => {
      if (mongoose.isValidObjectId(projectId)) {
        const audioRoom = getAudioRoom(projectId);
        if (socket.rooms.has(audioRoom)) {
          socket.to(audioRoom).emit("audio:participant-left", {
            projectId: projectId.toString(),
            socketId: socket.id,
          });
          socket.leave(audioRoom);
          delete socket.data.audioStatusByProject?.[projectId];
        }
        socket.leave(getRoom(projectId));
        emitProjectPresence(io, projectId).catch((error) => {
          console.error("Could not update project presence:", error);
        });
      }
    });

    socket.on("audio:join", async (payload, callback) => {
      try {
        const { projectId } = getEventPayload(payload);
        if (!mongoose.isValidObjectId(projectId)) {
          return callback?.({ ok: false, message: "Invalid project ID." });
        }

        const normalizedProjectId = projectId.toString();
        const project = await Project.findOne({
          _id: normalizedProjectId,
          members: { $elemMatch: { user: socket.userId } },
        }).select("_id");

        if (!project) {
          return callback?.({
            ok: false,
            message: "You do not have access to this project.",
          });
        }

        const audioRoom = getAudioRoom(normalizedProjectId);
        const wasJoined = socket.rooms.has(audioRoom);
        await socket.join(getRoom(normalizedProjectId));
        await socket.join(audioRoom);
        socket.data.audioStatusByProject ||= {};
        socket.data.audioStatusByProject[normalizedProjectId] = {
          muted: true,
          speaking: false,
        };

        const joinedSockets = await io.in(audioRoom).fetchSockets();
        const participants = joinedSockets
          .filter((participant) => participant.id !== socket.id)
          .map((participant) =>
            getAudioParticipant(participant, normalizedProjectId)
          );

        if (!wasJoined) {
          socket.to(audioRoom).emit("audio:participant-joined", {
            projectId: normalizedProjectId,
            participant: getAudioParticipant(socket, normalizedProjectId),
          });
        }

        callback?.({
          ok: true,
          projectId: normalizedProjectId,
          participants,
        });
      } catch (error) {
        console.error("Audio room join failed:", error);
        callback?.({
          ok: false,
          message: "Could not join project audio.",
        });
      }
    });

    socket.on("audio:leave", async (payload, callback) => {
      const { projectId } = getEventPayload(payload);
      if (
        !mongoose.isValidObjectId(projectId) ||
        !socket.rooms.has(getAudioRoom(projectId))
      ) {
        return callback?.({ ok: false, message: "You are not in this audio room." });
      }

      const normalizedProjectId = projectId.toString();
      const audioRoom = getAudioRoom(normalizedProjectId);
      socket.to(audioRoom).emit("audio:participant-left", {
        projectId: normalizedProjectId,
        socketId: socket.id,
      });
      await socket.leave(audioRoom);
      await socket.leave(getRoom(normalizedProjectId));
      delete socket.data.audioStatusByProject?.[normalizedProjectId];
      callback?.({ ok: true });
    });

    socket.on(
      "audio:state",
      (payload, callback) => {
        const { projectId, muted, speaking } = getEventPayload(payload);
        if (
          !mongoose.isValidObjectId(projectId) ||
          !socket.rooms.has(getAudioRoom(projectId)) ||
          typeof muted !== "boolean" ||
          typeof speaking !== "boolean"
        ) {
          return callback?.({ ok: false, message: "Invalid audio status." });
        }

        const normalizedProjectId = projectId.toString();
        const status = { muted, speaking: muted ? false : speaking };
        socket.data.audioStatusByProject ||= {};
        socket.data.audioStatusByProject[normalizedProjectId] = status;
        socket.to(getAudioRoom(normalizedProjectId)).emit(
          "audio:participant-state",
          {
            projectId: normalizedProjectId,
            socketId: socket.id,
            ...status,
          }
        );
        callback?.({ ok: true });
      }
    );

    const relayAudioSignal = (eventName, payloadName, isCandidate = false) => {
      socket.on(
        eventName,
        async (message, callback) => {
          const { projectId, to } = getEventPayload(message);
          const payload = getEventPayload(message)[payloadName];
          if (
            !mongoose.isValidObjectId(projectId) ||
            typeof to !== "string" ||
            to.length > 128 ||
            !socket.rooms.has(getAudioRoom(projectId))
          ) {
            return callback?.({ ok: false, message: "Invalid audio signal." });
          }

          const validPayload = isCandidate
            ? payload === null ||
              (payload &&
                typeof payload === "object" &&
                typeof payload.candidate === "string" &&
                payload.candidate.length <= 4096)
            : payload &&
              typeof payload === "object" &&
              ["offer", "answer"].includes(payload.type) &&
              typeof payload.sdp === "string" &&
              payload.sdp.length <= 65536;

          if (!validPayload) {
            return callback?.({ ok: false, message: "Invalid audio signal." });
          }

          const normalizedProjectId = projectId.toString();
          const audioRoom = getAudioRoom(normalizedProjectId);
          const roomSockets = await io.in(audioRoom).fetchSockets();
          if (!roomSockets.some((participant) => participant.id === to)) {
            return callback?.({
              ok: false,
              message: "Audio participant is not in this project room.",
            });
          }

          socket.to(to).emit(eventName, {
            projectId: normalizedProjectId,
            fromSocketId: socket.id,
            participant: getAudioParticipant(socket, normalizedProjectId),
            [payloadName]: payload,
          });
          callback?.({ ok: true });
        }
      );
    };

    relayAudioSignal("audio:offer", "description");
    relayAudioSignal("audio:answer", "description");
    relayAudioSignal("audio:ice-candidate", "candidate", true);

    socket.on(
      "project:create-file",
      async ({ projectId, fileName, content = "" } = {}, callback) => {
        try {
          if (
            !mongoose.isValidObjectId(projectId) ||
            !isValidProjectFileName(fileName) ||
            typeof content !== "string" ||
            Buffer.byteLength(content, "utf8") > MAX_PROJECT_FILE_BYTES
          ) {
            return callback?.({
              ok: false,
              message: "Invalid file name or file exceeds the 64 KB limit.",
            });
          }

          if (!socket.rooms.has(getRoom(projectId))) {
            return callback?.({
              ok: false,
              message: "Join the project before creating files.",
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
          }).select("_id files");

          if (!project) {
            return callback?.({
              ok: false,
              message: "You do not have permission to create project files.",
            });
          }

          const existingFiles = Array.from(project.files?.values?.() || []);
          const duplicate = [
            ...Object.keys(DEFAULT_FILES),
            ...existingFiles.map((file) => file.name).filter(Boolean),
          ].some((existingName) => existingName.toLowerCase() === fileName.toLowerCase());
          if (duplicate) {
            return callback?.({
              ok: false,
              message: "A file with that name already exists.",
            });
          }

          if (new Set([
            ...Object.keys(DEFAULT_FILES),
            ...existingFiles.map((file) => file.name).filter(Boolean),
          ]).size >= MAX_PROJECT_FILES) {
            return callback?.({
              ok: false,
              message: `Projects can contain up to ${MAX_PROJECT_FILES} files.`,
            });
          }

          const storageKey = getStorageKey(fileName);
          const doc = new Y.Doc();
          if (content) {
            doc.getText("code").insert(0, content);
          }
          const encodedState = Buffer.from(Y.encodeStateAsUpdate(doc)).toString(
            "base64"
          );
          doc.destroy();

          const fields = {
            [`files.${storageKey}.name`]: fileName,
            [`files.${storageKey}.content`]: content,
            [`files.${storageKey}.yjsState`]: encodedState,
          };
          const created = await Project.updateOne(
            {
              _id: projectId,
              members: {
                $elemMatch: {
                  user: socket.userId,
                  role: { $in: ["owner", "admin", "editor"] },
                },
              },
              [`files.${storageKey}`]: { $exists: false },
            },
            { $set: fields }
          );

          if (!created.modifiedCount) {
            return callback?.({
              ok: false,
              message: "A file with that name already exists or access changed.",
            });
          }

          const { doc: sharedDoc } = await loadDocument(
            projectId.toString(),
            fileName
          );
          const file = {
            content: sharedDoc.getText("code").toString(),
            yjsState: Buffer.from(Y.encodeStateAsUpdate(sharedDoc)).toString(
              "base64"
            ),
          };

          socket.to(getRoom(projectId)).emit("project:file-created", {
            projectId: projectId.toString(),
            fileName,
            ...file,
          });
          callback?.({ ok: true, file });
        } catch (error) {
          console.error("Project file creation failed:", error);
          callback?.({
            ok: false,
            message: "Could not create project file.",
          });
        }
      }
    );

    socket.on(
      "project:rename-file",
      async ({ projectId, oldName, newName } = {}, callback) => {
        let operationKey;
        try {
          if (
            !mongoose.isValidObjectId(projectId) ||
            !isValidProjectFileName(oldName) ||
            !isValidProjectFileName(newName) ||
            oldName.toLowerCase() === newName.toLowerCase()
          ) {
            return callback?.({
              ok: false,
              message: "Enter a valid new file name.",
            });
          }

          if (Object.prototype.hasOwnProperty.call(DEFAULT_FILES, oldName)) {
            return callback?.({
              ok: false,
              message: "Built-in workspace files cannot be renamed.",
            });
          }

          if (!socket.rooms.has(getRoom(projectId))) {
            return callback?.({
              ok: false,
              message: "Join the project before renaming files.",
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
          }).select("_id files");

          if (!project) {
            return callback?.({
              ok: false,
              message: "You do not have permission to rename project files.",
            });
          }

          const oldStorageKey = getStorageKey(oldName);
          const newStorageKey = getStorageKey(newName);
          const file = project.files?.get(oldStorageKey);
          if (file?.name !== oldName) {
            return callback?.({
              ok: false,
              message: "Project file does not exist.",
            });
          }

          const duplicate = [
            ...Object.keys(DEFAULT_FILES),
            ...Array.from(project.files?.values?.() || [])
              .filter((candidate) => candidate.name !== oldName)
              .map((candidate) => candidate.name)
              .filter(Boolean),
          ].some((existingName) => existingName.toLowerCase() === newName.toLowerCase());
          if (duplicate) {
            return callback?.({
              ok: false,
              message: "A file with that name already exists.",
            });
          }

          const oldDocumentKey = getDocumentKey(projectId.toString(), oldName);
          if (fileOperations.has(oldDocumentKey)) {
            return callback?.({
              ok: false,
              message: "This file is already being changed.",
            });
          }
          operationKey = oldDocumentKey;
          fileOperations.add(operationKey);
          const oldEntry =
            documents.get(oldDocumentKey) ||
            (await loadDocument(projectId.toString(), oldName));
          const pending = persistenceQueues.get(oldDocumentKey);
          if (pending) await pending;

          const content = oldEntry.doc.getText("code").toString();
          const yjsState = Buffer.from(
            Y.encodeStateAsUpdate(oldEntry.doc)
          ).toString("base64");
          const renamed = await Project.updateOne(
            {
              _id: projectId,
              members: {
                $elemMatch: {
                  user: socket.userId,
                  role: { $in: ["owner", "admin", "editor"] },
                },
              },
              [`files.${oldStorageKey}.name`]: oldName,
              [`files.${newStorageKey}`]: { $exists: false },
            },
            {
              $set: {
                [`files.${newStorageKey}.name`]: newName,
                [`files.${newStorageKey}.content`]: content,
                [`files.${newStorageKey}.yjsState`]: yjsState,
              },
              $unset: { [`files.${oldStorageKey}`]: 1 },
            }
          );

          if (!renamed.modifiedCount) {
            return callback?.({
              ok: false,
              message: "The file changed or a file with that name already exists.",
            });
          }

          if (oldEntry.updateHandler) {
            oldEntry.doc.off("update", oldEntry.updateHandler);
          }
          documents.delete(oldDocumentKey);
          persistenceQueues.delete(oldDocumentKey);
          const newDocumentKey = getDocumentKey(projectId.toString(), newName);
          documents.set(newDocumentKey, oldEntry);
          attachPersistenceHandler(
            projectId.toString(),
            newName,
            newStorageKey,
            oldEntry
          );

          const renamedFile = { content, yjsState };
          socket.to(getRoom(projectId)).emit("project:file-renamed", {
            projectId: projectId.toString(),
            oldName,
            newName,
            file: renamedFile,
          });
          callback?.({ ok: true, file: renamedFile });
        } catch (error) {
          console.error("Project file rename failed:", error);
          callback?.({
            ok: false,
            message: "Could not rename project file.",
          });
        } finally {
          if (operationKey) fileOperations.delete(operationKey);
        }
      }
    );

    socket.on(
      "project:delete-file",
      async ({ projectId, fileName } = {}, callback) => {
        let operationKey;
        try {
          if (
            !mongoose.isValidObjectId(projectId) ||
            !isValidProjectFileName(fileName)
          ) {
            return callback?.({
              ok: false,
              message: "Invalid project file.",
            });
          }

          if (Object.prototype.hasOwnProperty.call(DEFAULT_FILES, fileName)) {
            return callback?.({
              ok: false,
              message: "Built-in workspace files cannot be deleted.",
            });
          }

          if (!socket.rooms.has(getRoom(projectId))) {
            return callback?.({
              ok: false,
              message: "Join the project before deleting files.",
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
          }).select("_id files");

          if (!project) {
            return callback?.({
              ok: false,
              message: "You do not have permission to delete project files.",
            });
          }

          const storageKey = getStorageKey(fileName);
          if (project.files?.get(storageKey)?.name !== fileName) {
            return callback?.({
              ok: false,
              message: "Project file does not exist.",
            });
          }

          const documentKey = getDocumentKey(projectId.toString(), fileName);
          if (fileOperations.has(documentKey)) {
            return callback?.({
              ok: false,
              message: "This file is already being changed.",
            });
          }
          operationKey = documentKey;
          fileOperations.add(operationKey);
          const pending = persistenceQueues.get(documentKey);
          if (pending) await pending;

          const deleted = await Project.updateOne(
            {
              _id: projectId,
              members: {
                $elemMatch: {
                  user: socket.userId,
                  role: { $in: ["owner", "admin", "editor"] },
                },
              },
              [`files.${storageKey}.name`]: fileName,
            },
            { $unset: { [`files.${storageKey}`]: 1 } }
          );

          if (!deleted.modifiedCount) {
            return callback?.({
              ok: false,
              message: "The file changed or no longer exists.",
            });
          }

          removeProjectDocument(projectId.toString(), fileName);
          socket.to(getRoom(projectId)).emit("project:file-deleted", {
            projectId: projectId.toString(),
            fileName,
          });
          callback?.({ ok: true });
        } catch (error) {
          console.error("Project file deletion failed:", error);
          callback?.({
            ok: false,
            message: "Could not delete project file.",
          });
        } finally {
          if (operationKey) fileOperations.delete(operationKey);
        }
      }
    );

    socket.on("disconnecting", () => {
      const projectIds = Array.from(socket.rooms)
        .filter((room) => room.startsWith("project:"))
        .map((room) => room.slice("project:".length));

      projectIds.forEach((projectId) => {
        const audioRoom = getAudioRoom(projectId);
        if (socket.rooms.has(audioRoom)) {
          socket.to(audioRoom).emit("audio:participant-left", {
            projectId,
            socketId: socket.id,
          });
        }
        emitProjectPresence(io, projectId, socket.id).catch((error) => {
          console.error("Could not update project presence:", error);
        });
      });
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
            !isValidProjectFileName(fileName) ||
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
          }).select("_id files");

          if (!project) {
            return callback?.({
              ok: false,
              message: "You do not have permission to edit this project.",
            });
          }

          const storageKey = getStorageKey(fileName);
          const file = project.files?.get(storageKey);
          if (
            !Object.prototype.hasOwnProperty.call(DEFAULT_FILES, fileName) &&
            file?.name !== fileName
          ) {
            return callback?.({
              ok: false,
              message: "Project file does not exist.",
            });
          }
          const documentKey = getDocumentKey(projectId.toString(), fileName);
          if (fileOperations.has(documentKey)) {
            return callback?.({
              ok: false,
              message: "This file is currently being renamed or deleted.",
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
          if (fileOperations.has(documentKey)) {
            return callback?.({
              ok: false,
              message: "This file is currently being renamed or deleted.",
            });
          }

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

module.exports = {
  emitProjectMembers,
  registerSocketHandlers,
  updateProjectMemberAccess,
};

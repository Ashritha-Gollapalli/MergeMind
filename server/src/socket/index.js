
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Y = require("yjs");
const Project = require("../models/Project");
const User = require("../models/User");

const documents = new Map();
const persistenceQueues = new Map();

function getRoom(projectId) {
  return `project:${projectId}`;
}

async function loadDocument(projectId) {
  const existing = documents.get(projectId);
  if (existing) return existing;

  const project = await Project.findById(projectId).select(
    "_id code yjsState"
  );

  if (!project) {
    throw new Error("Project not found.");
  }

  const doc = new Y.Doc();

  if (project.yjsState) {
    const state = Buffer.from(project.yjsState, "base64");
    Y.applyUpdate(doc, new Uint8Array(state));
  } else if (project.code) {
    doc.getText("code").insert(0, project.code);
  }

  const entry = { doc };
  documents.set(projectId, entry);

  doc.on("update", () => {
    const previous = persistenceQueues.get(projectId) || Promise.resolve();

    const next = previous
      .catch(() => {})
      .then(async () => {
        const current = documents.get(projectId);
        if (!current || current.doc !== doc) return;

        const state = Y.encodeStateAsUpdate(doc);
        const code = doc.getText("code").toString();

        await Project.updateOne(
          { _id: projectId },
          {
            $set: {
              yjsState: Buffer.from(state).toString("base64"),
              code,
            },
          }
        );
      });

    persistenceQueues.set(projectId, next);

    next.catch((error) => {
      console.error("Yjs persistence failed:", error);
    });
  });

  // Save the initial state, including migrated legacy code.
  const initialState = Y.encodeStateAsUpdate(doc);

  await Project.updateOne(
    { _id: projectId },
    {
      $set: {
        yjsState: Buffer.from(initialState).toString("base64"),
        code: doc.getText("code").toString(),
      },
    }
  );

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

        const { doc } = await loadDocument(projectId.toString());

        await socket.join(getRoom(projectId));

        const state = Y.encodeStateAsUpdate(doc);

        callback?.({
          ok: true,
          projectId: projectId.toString(),
          yjsState: Buffer.from(state).toString("base64"),
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
      async ({ projectId, update, userName, lineNumber } = {}, callback) => {
        try {
          if (
            !mongoose.isValidObjectId(projectId) ||
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

          const bytes = Buffer.from(update, "base64");

          if (bytes.length > 1024 * 1024) {
            return callback?.({
              ok: false,
              message: "Update cannot exceed 1 MB.",
            });
          }

          const { doc } = await loadDocument(projectId.toString());

          Y.applyUpdate(doc, new Uint8Array(bytes), socket.id);

          socket.to(getRoom(projectId)).emit("project:yjs-update", {
            projectId: projectId.toString(),
            update,
            userName: socket.userName || "Collaborator",
            lineNumber,
          });

          const pending = persistenceQueues.get(projectId.toString());
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

          const pending = persistenceQueues.get(projectId.toString());
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

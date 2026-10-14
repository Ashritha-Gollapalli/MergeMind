
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Project = require("../models/Project");

function registerSocketHandlers(io) {
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;

      if (!token) {
        return next(new Error("Authentication required."));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id || decoded.userId || decoded._id;

      if (!socket.userId || !mongoose.isValidObjectId(socket.userId)) {
        return next(new Error("Invalid authentication token."));
      }

      next();
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
          "members.user": socket.userId,
        }).select("_id code");

        if (!project) {
          return callback?.({
            ok: false,
            message: "You do not have access to this project.",
          });
        }

        const room = `project:${project._id}`;
        await socket.join(room);

        callback?.({
          ok: true,
          projectId: project._id.toString(),
          code: project.code || "",
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
        socket.leave(`project:${projectId}`);
      }
    });

    socket.on("project:code-change", async ({ projectId, code } = {}, callback) => {
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

        const project = await Project.findOne({
          _id: projectId,
          "members.user": socket.userId,
          "members.role": { $in: ["owner", "admin", "editor"] },
        });

        if (!project) {
          return callback?.({
            ok: false,
            message: "You do not have permission to edit this project.",
          });
        }

        // Require the sender to have joined this project's room.
        if (!socket.rooms.has(`project:${projectId}`)) {
          return callback?.({
            ok: false,
            message: "Join the project before editing.",
          });
        }

        project.code = code;
        await project.save();

        socket.to(`project:${projectId}`).emit("project:code-change", {
          projectId,
          code,
          userId: socket.userId,
        });

        callback?.({ ok: true });
      } catch (error) {
        console.error("Socket code update failed:", error);
        callback?.({
          ok: false,
          message: "Could not save code update.",
        });
      }
    });
  });
}

module.exports = { registerSocketHandlers };

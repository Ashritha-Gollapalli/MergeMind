const mongoose = require("mongoose");
const User = require("../models/User");
const Project = require("../models/Project");
const {
  emitProjectMembers,
  updateProjectMemberAccess,
} = require("../socket");

async function addProjectMember(req, res, next) {
  try {
    const { projectId } = req.params;
    const { email, role = "editor" } = req.body;

    if (typeof email !== "string" || !email.trim()) {
      return res.status(400).json({
        message: "A valid email is required",
      });
    }

    const allowedRoles = ["admin", "editor", "viewer"];

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        message: "Role must be admin, editor, or viewer",
      });
    }

    if (req.projectMembership.role === "admin" && role === "admin") {
      return res.status(403).json({
        message: "Only the project owner can assign the admin role",
      });
    }

    const project = await Project.findById(projectId);

    if (!project) {
      return res.status(404).json({
        message: "Project not found",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(404).json({
        message: "No registered user found with that email",
      });
    }

    const alreadyMember = project.members.some(
      (member) => member.user.toString() === user._id.toString()
    );

    if (alreadyMember) {
      return res.status(409).json({
        message: "User is already a project member",
      });
    }

    project.members.push({
      user: user._id,
      role,
    });

    await project.save();

    await emitProjectMembers(req.app.get("io"), projectId);

    return res.status(201).json({
      message: "Member added successfully",
      project,
    });
  } catch (error) {
    next(error);
  }
}

async function removeProjectMember(req, res, next) {
  try {
    const { projectId, userId } = req.params;

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({
        message: "Invalid user ID",
      });
    }

    const project = await Project.findById(projectId);

    if (!project) {
      return res.status(404).json({
        message: "Project not found",
      });
    }

    if (project.owner.toString() === userId) {
      return res.status(403).json({
        message: "The project owner cannot be removed",
      });
    }

    const memberExists = project.members.some(
      (member) => member.user.toString() === userId
    );

    if (!memberExists) {
      return res.status(404).json({
        message: "Project member not found",
      });
    }

    project.members = project.members.filter(
      (member) => member.user.toString() !== userId
    );

    await project.save();

    const io = req.app.get("io");
    await updateProjectMemberAccess(io, projectId, userId, null);
    await emitProjectMembers(io, projectId);

    return res.status(200).json({
      message: "Member removed successfully",
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  addProjectMember,
  removeProjectMember,
};
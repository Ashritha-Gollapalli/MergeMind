const mongoose = require("mongoose");
const Project = require("../models/Project");

async function updateMemberRole(req, res, next) {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({
        message: "Invalid user ID",
      });
    }

    if (!["admin", "editor", "viewer"].includes(role)) {
      return res.status(400).json({
        message: "Role must be admin, editor, or viewer",
      });
    }

    const project = req.project;

    if (project.owner.toString() === userId) {
      return res.status(403).json({
        message: "The project owner's role cannot be changed",
      });
    }

    const member = project.members.find(
      (item) => item.user.toString() === userId
    );

    if (!member) {
      return res.status(404).json({
        message: "Project member not found",
      });
    }

    // Admins cannot change another member to admin.
    if (
      req.projectMembership.role === "admin" &&
      role === "admin"
    ) {
      return res.status(403).json({
        message: "Only the project owner can assign the admin role",
      });
    }

    member.role = role;
    await project.save();

    return res.status(200).json({
      message: "Member role updated successfully",
      project,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { updateMemberRole };
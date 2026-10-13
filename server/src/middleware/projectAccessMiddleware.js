const mongoose = require("mongoose");
const Project = require("../models/Project");

function allowProjectRoles(...allowedRoles) {
  return async function projectRoleMiddleware(req, res, next) {
    try {
      const { projectId } = req.params;

      if (!mongoose.isValidObjectId(projectId)) {
        return res.status(400).json({
          message: "Invalid project ID",
        });
      }

      const project = await Project.findById(projectId);

      if (!project) {
        return res.status(404).json({
          message: "Project not found",
        });
      }

      const membership = project.members.find(
        (member) =>
          member.user.toString() === req.user._id.toString()
      );

      if (!membership) {
        return res.status(403).json({
          message: "You are not a member of this project",
        });
      }

      if (!allowedRoles.includes(membership.role)) {
        return res.status(403).json({
          message: "You do not have permission to perform this action",
        });
      }

      req.project = project;
      req.projectMembership = membership;

      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { allowProjectRoles };
const mongoose = require("mongoose");
const { z } = require("zod");
const Project = require("../models/Project");

const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).optional().default(""),
});

async function createProject(req, res, next) {
  try {
    const parsed = createProjectSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid project data",
        errors: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const project = await Project.create({
      name: parsed.data.name,
      description: parsed.data.description,
      owner: req.user._id,
      members: [
        {
          user: req.user._id,
          role: "owner",
        },
      ],
    });

    return res.status(201).json({
      message: "Project created successfully",
      project,
    });
  } catch (error) {
    return next(error);
  }
}

async function getProjects(req, res, next) {
  try {
    const projects = await Project.find({
      "members.user": req.user._id,
    })
      .sort({ updatedAt: -1 })
      .populate("owner", "name email")
      .populate("members.user", "name email");

    return res.status(200).json({ projects });
  } catch (error) {
    return next(error);
  }
}

async function getProjectById(req, res, next) {
  try {
    const { projectId } = req.params;

    if (!mongoose.isValidObjectId(projectId)) {
      return res.status(400).json({ message: "Invalid project ID" });
    }

    const project = await Project.findOne({
      _id: projectId,
      "members.user": req.user._id,
    })
      .populate("owner", "name email")
      .populate("members.user", "name email");

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    return res.status(200).json({ project });
  } catch (error) {
    return next(error);
  }
}

async function updateProject(req, res, next) {
  try {
    const { name, description } = req.body;
    const updates = {};

    if (name !== undefined) {
      if (
        typeof name !== "string" ||
        name.trim().length < 2 ||
        name.trim().length > 100
      ) {
        return res.status(400).json({
          message: "Project name must be between 2 and 100 characters",
        });
      }

      updates.name = name.trim();
    }

    if (description !== undefined) {
      if (
        typeof description !== "string" ||
        description.trim().length > 1000
      ) {
        return res.status(400).json({
          message: "Description must be at most 1000 characters",
        });
      }

      updates.description = description.trim();
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        message: "Provide a name or description to update",
      });
    }

    const project = await Project.findByIdAndUpdate(
      req.project._id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    return res.status(200).json({
      message: "Project updated successfully",
      project,
    });
  } catch (error) {
    return next(error);
  }
}
async function deleteProject(req, res, next) {
  try {
    await Project.findByIdAndDelete(req.project._id);

    return res.status(200).json({
      message: "Project deleted successfully",
    });
  } catch (error) {
    return next(error);
  }
}
module.exports = {
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  deleteProject,
};
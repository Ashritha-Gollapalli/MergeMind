const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const {
  allowProjectRoles,
} = require("../middleware/projectAccessMiddleware");

const {
  createProject,
  getProjects,
  getProjectById,
} = require("../controllers/projectController");

const {
  addProjectMember,
  removeProjectMember,
} = require("../controllers/projectMemberController");

const {
  updateProject,
  deleteProject,
} = require("../controllers/projectController");

const {
  updateMemberRole,
} = require("../controllers/projectRoleController");

const {
  getProjectCode,
  saveProjectCode,
} = require("../controllers/codeController");

const router = express.Router();

router.use(protect);

// Project operations
router.post("/", createProject);
router.get("/", getProjects);
router.patch(
  "/:projectId",
  allowProjectRoles("owner", "admin", "editor"),
  updateProject
);

router.patch(
  "/:projectId/members/:userId",
  allowProjectRoles("owner", "admin"),
  updateMemberRole
);

router.delete(
  "/:projectId",
  allowProjectRoles("owner"),
  deleteProject
);
router.get(
  "/:projectId/code",
  allowProjectRoles("owner", "admin", "editor", "viewer"),
  getProjectCode
);

router.put(
  "/:projectId/code",
  allowProjectRoles("owner", "admin", "editor"),
  saveProjectCode
);
router.get("/:projectId", getProjectById);

// Membership operations
router.post(
  "/:projectId/members",
  allowProjectRoles("owner", "admin"),
  addProjectMember
);

router.delete(
  "/:projectId/members/:userId",
  allowProjectRoles("owner", "admin"),
  removeProjectMember
);

module.exports = router;
const express = require("express");
const rateLimit = require("express-rate-limit");
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
const { runProjectCode } = require("../controllers/executionController");
const { askAssistant } = require("../controllers/aiAssistantController");

const router = express.Router();
const executionLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Code execution limit reached. Try again in a minute.",
  },
});
const assistantLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "AI assistant limit reached. Try again in a minute.",
  },
});

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
router.post(
  "/:projectId/run",
  allowProjectRoles("owner", "admin", "editor"),
  executionLimiter,
  runProjectCode
);
router.post(
  "/:projectId/assistant",
  allowProjectRoles("owner", "admin", "editor", "viewer"),
  assistantLimiter,
  askAssistant
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
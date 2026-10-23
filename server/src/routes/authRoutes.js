const express = require("express");
const rateLimit = require("express-rate-limit");
const {
  register,
  login,
  forgotPassword,
  resetPassword,
  getMe,
} = require("../controllers/authController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many reset requests. Please try again in 15 minutes.",
  },
});
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many reset attempts. Please try again in 15 minutes.",
  },
});

router.post("/register", register);
router.post("/login", login);
router.post("/forgot-password", forgotPasswordLimiter, forgotPassword);
router.post("/reset-password", resetPasswordLimiter, resetPassword);
router.get("/me", protect, getMe);

module.exports = router;
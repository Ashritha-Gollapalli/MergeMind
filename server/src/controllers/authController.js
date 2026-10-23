const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { z } = require("zod");
const User = require("../models/User");

const normalizedEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(254);

const registrationEmailSchema = normalizedEmailSchema.refine(
  (email) => email.split("@")[0].length >= 3,
  {
    message: "Email must contain at least 3 characters before the @",
  },
);

const passwordSchema = z
  .string()
  .min(8)
  .max(72)
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a number")
  .regex(/[^A-Za-z0-9]/, "Password must contain a special character");

const registerSchema = z.object({
  name: z.string().trim().min(3).max(80),
  email: registrationEmailSchema,
  password: passwordSchema,
});

const loginSchema = z.object({
  email: normalizedEmailSchema,
  password: z.string().min(1).max(72),
});

const forgotPasswordSchema = z.object({
  email: normalizedEmailSchema,
});

const resetPasswordSchema = z.object({
  email: normalizedEmailSchema,
  otp: z.string().regex(/^\d{6}$/, "OTP must be 6 digits"),
  password: passwordSchema,
});

const resetOtpLifetimeMs = 10 * 60 * 1000;
const maxResetOtpAttempts = 5;

function hashResetOtp(userId, otp) {
  return crypto
    .createHmac("sha256", process.env.JWT_SECRET)
    .update(`${userId}:${otp}`)
    .digest("hex");
}

async function sendPasswordResetEmail(email, otp) {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
  const from = process.env.SMTP_FROM || SMTP_USER;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !from) {
    throw new Error(
      "SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM (or SMTP_USER) must be configured",
    );
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from,
    to: email,
    subject: "Your MergeMind password reset code",
    text: `Your password reset code is ${otp}. It expires in 10 minutes. If you did not request this, you can ignore this email.`,
    html: `<p>Your MergeMind password reset code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${otp}</p><p>This code expires in 10 minutes. If you did not request this, you can ignore this email.</p>`,
  });
}

function createToken(userId) {
  return jwt.sign(
    { sub: userId.toString() },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "1d" },
  );
}

function publicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}

async function register(req, res, next) {
  try {
    const parsed = registerSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid registration data",
        errors: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const { name, email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    const existingUser = await User.findOne({
      email: normalizedEmail,
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists",
      });
    }

    const user = await User.create({
      name,
      email: normalizedEmail,
      password,
    });

    const token = createToken(user._id);

    return res.status(201).json({
      success: true,
      message: "Account created successfully",
      token,
      user: publicUser(user),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists",
      });
    }

    return next(error);
  }
}

async function forgotPassword(req, res, next) {
  try {
    const parsed = forgotPasswordSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid email address",
        errors: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const { email } = parsed.data;
    const user = await User.findOne({ email }).select(
      "+resetOtpHash +resetOtpExpiresAt +resetOtpAttempts",
    );

    if (!user) {
      return res.status(200).json({
        success: true,
        message: "If an account exists for that email, a reset code has been sent.",
      });
    }

    const otp = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
    const otpHash = hashResetOtp(user._id, otp);
    user.resetOtpHash = otpHash;
    user.resetOtpExpiresAt = new Date(Date.now() + resetOtpLifetimeMs);
    user.resetOtpAttempts = 0;
    await user.save();

    try {
      await sendPasswordResetEmail(email, otp);
    } catch (error) {
      user.resetOtpHash = undefined;
      user.resetOtpExpiresAt = undefined;
      user.resetOtpAttempts = 0;
      await user.save();
      console.error("Password reset email delivery failed:", error);

      return res.status(503).json({
        success: false,
        message: "Unable to send the reset email. Check the mail server configuration and try again.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "If an account exists for that email, a reset code has been sent.",
    });
  } catch (error) {
    return next(error);
  }
}

async function resetPassword(req, res, next) {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid reset data",
        errors: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const { email, otp, password } = parsed.data;
    const user = await User.findOne({ email }).select(
      "+resetOtpHash +resetOtpExpiresAt +resetOtpAttempts +password",
    );

    if (
      !user ||
      !user.resetOtpHash ||
      !user.resetOtpExpiresAt ||
      user.resetOtpExpiresAt <= new Date() ||
      user.resetOtpAttempts >= maxResetOtpAttempts
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset code. Request a new code.",
      });
    }

    const submittedHash = hashResetOtp(user._id, otp);
    const expectedHash = Buffer.from(user.resetOtpHash, "hex");
    const actualHash = Buffer.from(submittedHash, "hex");

    if (
      expectedHash.length !== actualHash.length ||
      !crypto.timingSafeEqual(expectedHash, actualHash)
    ) {
      user.resetOtpAttempts += 1;

      if (user.resetOtpAttempts >= maxResetOtpAttempts) {
        user.resetOtpHash = undefined;
        user.resetOtpExpiresAt = undefined;
      }

      await user.save();

      return res.status(400).json({
        success: false,
        message:
          user.resetOtpAttempts >= maxResetOtpAttempts
            ? "Too many incorrect codes. Request a new code."
            : "Invalid or expired reset code.",
      });
    }

    user.password = password;
    user.resetOtpHash = undefined;
    user.resetOtpExpiresAt = undefined;
    user.resetOtpAttempts = 0;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password changed successfully. You can now sign in.",
    });
  } catch (error) {
    return next(error);
  }
}

async function login(req, res, next) {
  try {
    const parsed = loginSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid login data",
        errors: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const { email, password } = parsed.data;

    const user = await User.findOne({
      email: email.toLowerCase(),
    }).select("+password");

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const token = createToken(user._id);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: publicUser(user),
    });
  } catch (error) {
    return next(error);
  }
}

async function getMe(req, res) {
  return res.status(200).json({
    success: true,
    user: publicUser(req.user),
  });
}

module.exports = {
  register,
  login,
  forgotPassword,
  resetPassword,
  getMe,
};
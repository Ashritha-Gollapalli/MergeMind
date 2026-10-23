const assert = require("node:assert/strict");
const test = require("node:test");
const nodemailer = require("nodemailer");
const User = require("../src/models/User");
const {
  register,
  forgotPassword,
  resetPassword,
} = require("../src/controllers/authController");

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function invoke(handler, body) {
  const response = createResponse();
  await handler({ body }, response, (error) => {
    throw error;
  });
  return response;
}

test("registration validates input and password reset emails and accepts its OTP", async (t) => {
  const originalFindOne = User.findOne;
  const originalCreateTransport = nodemailer.createTransport;
  const originalEnvironment = Object.fromEntries(
    ["JWT_SECRET", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]
      .map((key) => [key, process.env[key]]),
  );
  const user = {
    _id: "test-user-id",
    resetOtpHash: null,
    resetOtpExpiresAt: null,
    resetOtpAttempts: 0,
    async save() {},
  };
  let deliveredEmail;

  t.after(() => {
    User.findOne = originalFindOne;
    nodemailer.createTransport = originalCreateTransport;

    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  process.env.JWT_SECRET = "auth-test-secret";
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_USER = "test@example.com";
  process.env.SMTP_PASS = "test-password";
  User.findOne = () => ({ select: async () => user });
  nodemailer.createTransport = () => ({
    sendMail: async (message) => {
      deliveredEmail = message;
    },
  });

  const invalidRegistrations = [
    { name: "Al", email: "alex@example.com", password: "Password1!" },
    { name: "Alex", email: "ab@example.com", password: "Password1!" },
    { name: "Alex", email: "alex@example.com", password: "password1!" },
  ];

  for (const payload of invalidRegistrations) {
    const response = await invoke(register, payload);
    assert.equal(response.statusCode, 400);
  }

  const validRegistration = await invoke(register, {
    name: "Alex",
    email: "alex@example.com",
    password: "Password1!",
  });
  assert.equal(validRegistration.statusCode, 409);

  const forgotResponse = await invoke(forgotPassword, {
    email: "user@example.com",
  });
  assert.equal(forgotResponse.statusCode, 200);
  assert.equal(deliveredEmail.to, "user@example.com");

  const otp = deliveredEmail.text.match(/\b\d{6}\b/)[0];
  const resetResponse = await invoke(resetPassword, {
    email: "user@example.com",
    otp,
    password: "NewPassword1!",
  });

  assert.equal(resetResponse.statusCode, 200);
  assert.equal(user.password, "NewPassword1!");
  assert.equal(user.resetOtpHash, undefined);
  assert.equal(user.resetOtpExpiresAt, undefined);
});

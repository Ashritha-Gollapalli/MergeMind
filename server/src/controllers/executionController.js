const {
  executeProgram,
  executeReactProject,
  RunnerUnavailableError,
} = require("../services/codeExecutionService");

const MAX_APP_BYTES = 64 * 1024;
const MAX_CSS_BYTES = 32 * 1024;
const MAX_STDIN_BYTES = 32 * 1024;
const SUPPORTED_LANGUAGES = new Set([
  "python",
  "java",
  "c",
  "cpp",
  "go",
  "rust",
  "node",
]);

async function runProjectCode(req, res, next) {
  const language = req.body?.language;
  if (language && language !== "react") {
    if (!SUPPORTED_LANGUAGES.has(language)) {
      return res.status(400).json({ message: "Unsupported execution language." });
    }

    const { source, stdin = "" } = req.body;
    if (
      typeof source !== "string" ||
      typeof stdin !== "string"
    ) {
      return res.status(400).json({
        message: "Source code and standard input must be provided as text.",
      });
    }

    if (
      Buffer.byteLength(source, "utf8") > MAX_APP_BYTES ||
      Buffer.byteLength(stdin, "utf8") > MAX_STDIN_BYTES
    ) {
      return res.status(413).json({
        message: "Execution input exceeds the allowed size.",
      });
    }

    try {
      const result = await executeProgram({ language, source, stdin });
      return res.status(200).json({
        success: !result.error,
        ...result,
      });
    } catch (error) {
      if (error instanceof RunnerUnavailableError) {
        return res.status(503).json({ message: error.message });
      }

      return next(error);
    }
  }

  const appCode = req.body?.files?.["App.jsx"];
  const cssCode = req.body?.files?.["App.css"] ?? "";

  if (typeof appCode !== "string" || typeof cssCode !== "string") {
    return res.status(400).json({
      message: "App.jsx and App.css must be provided as text.",
    });
  }

  if (
    Buffer.byteLength(appCode, "utf8") > MAX_APP_BYTES ||
    Buffer.byteLength(cssCode, "utf8") > MAX_CSS_BYTES
  ) {
    return res.status(413).json({
      message: "Execution input exceeds the allowed size.",
    });
  }

  try {
    const result = await executeReactProject({ appCode, cssCode });

    return res.status(200).json({
      success: !result.error,
      ...result,
    });
  } catch (error) {
    if (error instanceof RunnerUnavailableError) {
      return res.status(503).json({ message: error.message });
    }

    if (error.errors?.length) {
      return res.status(400).json({
        message: error.errors.map((item) => item.text).join("\n"),
      });
    }

    return next(error);
  }
}

module.exports = { runProjectCode };

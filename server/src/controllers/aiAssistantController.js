const {
  AiAssistantError,
  generateAssistantResponse,
} = require("../services/aiAssistantService");

const MAX_PROMPT_LENGTH = 4000;
const MAX_CODE_BYTES = 64 * 1024;

async function askAssistant(req, res, next) {
  const { prompt, fileName, language, code, history = [] } = req.body || {};

  if (
    typeof prompt !== "string" ||
    !prompt.trim() ||
    prompt.trim().length > MAX_PROMPT_LENGTH ||
    typeof fileName !== "string" ||
    !fileName.trim() ||
    fileName.length > 128 ||
    typeof language !== "string" ||
    language.length > 40 ||
    typeof code !== "string" ||
    !Array.isArray(history) ||
    history.length > 10 ||
    history.some(
      (message) =>
        !message ||
        !["user", "assistant"].includes(message.role) ||
        typeof message.content !== "string" ||
        message.content.length > MAX_PROMPT_LENGTH
    )
  ) {
    return res.status(400).json({
      message: `Provide a prompt (up to ${MAX_PROMPT_LENGTH} characters), file name, language, and code.`,
    });
  }

  if (Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES) {
    return res.status(413).json({
      message: "Code context exceeds the 64 KB assistant limit.",
    });
  }

  try {
    const answer = await generateAssistantResponse({
      prompt: prompt.trim(),
      fileName: fileName.trim(),
      language,
      code,
      history,
    });

    return res.status(200).json({ answer });
  } catch (error) {
    if (error instanceof AiAssistantError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return next(error);
  }
}

module.exports = { askAssistant };

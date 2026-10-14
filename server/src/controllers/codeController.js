
const Project = require("../models/Project");

async function getProjectCode(req, res, next) {
  try {
    res.status(200).json({
      code: req.project.code || "",
    });
  } catch (error) {
    next(error);
  }
}

async function saveProjectCode(req, res, next) {
  try {
    const { code } = req.body;

    if (typeof code !== "string") {
      return res.status(400).json({
        message: "Code must be a string.",
      });
    }

    // Prevent excessively large requests.
    if (Buffer.byteLength(code, "utf8") > 1024 * 1024) {
      return res.status(413).json({
        message: "Code cannot exceed 1 MB.",
      });
    }

    req.project.code = code;
    await req.project.save();

    res.status(200).json({
      message: "Project code saved successfully.",
      code: req.project.code,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getProjectCode,
  saveProjectCode,
};

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { getClientOrigins } = require("./config/clientOrigins");
const authRoutes = require("./routes/authRoutes");
const projectRoutes = require("./routes/projectRoutes");
const app = express();
app.set("trust proxy", 1);

app.use(helmet());
app.use(cors({ origin: getClientOrigins() }));
app.use(express.json({ limit: "1mb" }));


app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "MergeMind API is running",
  });
});
app.use("/api/auth", authRoutes);
app.use("/api/projects", projectRoutes);
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

module.exports = app;

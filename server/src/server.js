require("dotenv").config();

const http = require("http");
const app = require("./app");
const connectDB = require("./config/db");

const PORT = Number(process.env.PORT) || 5000;

async function startServer() {
  try {
    await connectDB();

    const server = http.createServer(app);

    server.listen(PORT, () => {
      console.log(`MergeMind backend running on port ${PORT}`);
    });

    server.on("error", (error) => {
      console.error("HTTP server error:", error.message);
    });
  } catch (error) {
    console.error("Backend startup failed:", error.message);
    process.exitCode = 1;
  }
}

startServer();
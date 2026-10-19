require("dotenv").config();

const fs = require("fs");
const https = require("https");
const http = require("http");
const { Server } = require("socket.io");
const app = require("./app");
const connectDB = require("./config/db");
const { registerSocketHandlers } = require("./socket");

const PORT = Number(process.env.PORT) || 5000;

function createHttpServer() {
  const keyPath = process.env.HTTPS_KEY_PATH;
  const certPath = process.env.HTTPS_CERT_PATH;

  if (Boolean(keyPath) !== Boolean(certPath)) {
    throw new Error("HTTPS_KEY_PATH and HTTPS_CERT_PATH must be configured together.");
  }

  if (keyPath && certPath) {
    return https.createServer(
      {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      },
      app
    );
  }

  return http.createServer(app);
}

const httpServer = createHttpServer();

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

app.set("io", io);
registerSocketHandlers(io);

async function startServer() {
  try {
    await connectDB();

    httpServer.listen(PORT, () => {
      console.log(`MergeMind backend running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Backend startup failed:", error);
    process.exit(1);
  }
}

startServer();

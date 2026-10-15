require("dotenv").config();

const http = require("http");
const { Server } = require("socket.io");
const app = require("./app");
const connectDB = require("./config/db");
const { registerSocketHandlers } = require("./socket");

const PORT = Number(process.env.PORT) || 5000;

const httpServer = http.createServer(app);

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

const mongoose = require("mongoose");

async function connectDB() {
  const mongoURI = process.env.MONGODB_URI;

  if (!mongoURI) {
    throw new Error("MONGODB_URI is missing from the environment");
  }

  await mongoose.connect(mongoURI, {
    serverSelectionTimeoutMS: 5000,
  });

  console.log("MongoDB connected successfully");
}

module.exports = connectDB;
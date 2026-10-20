function getClientOrigins(value = process.env.CLIENT_URL) {
  return (value || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

module.exports = { getClientOrigins };

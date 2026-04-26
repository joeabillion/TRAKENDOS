process.on("uncaughtException", (err) => {
  if (err.message && err.message.includes("handleUpgrade")) {
    console.error("WebSocket upgrade error (suppressed):", err.message);
    return;
  }
  console.error("Uncaught exception:", err);
  process.exit(1);
});
require("./dist/index.js");

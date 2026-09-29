"use strict";

const server = require("./src/server/main.js");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Atlas whiteboard server running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  });
}

module.exports = server;

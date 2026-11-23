
const express = require("express");
const http = require("http");
const { ExpressPeerServer } = require("peer");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.json({
    name: "Flight Friends PeerJS Server",
    status: "online"
  });
});

const peerServer = ExpressPeerServer(server, {
  path: "/",
  proxied: true,
  debug: false
});

app.use("/peerjs", peerServer);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor PeerJS online na porta ${PORT}`);
});

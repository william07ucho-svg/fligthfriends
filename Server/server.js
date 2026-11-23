
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { ExpressPeerServer } = require("peer");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 4;

const rooms = new Map();

app.get("/", (req, res) => {
  res.json({
    name: "Flight Friends Server",
    status: "online",
    version: "1.0.0"
  });
});

// Servidor de sinalização PeerJS
const peerServer = ExpressPeerServer(server, {
  path: "/",
  proxied: true,
  debug: false
});

app.use("/peerjs", peerServer);

// Servidor WebSocket das salas
const roomsServer = http.createServer();

const wss = new WebSocket.Server({
  server: roomsServer,
  path: "/rooms"
});

function send(socket, data) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

function broadcast(room, data, excludedSocket = null) {
  const clients = rooms.get(room);

  if (!clients) return;

  clients.forEach(client => {
    if (client !== excludedSocket) {
      send(client.socket, data);
    }
  });
}

function leaveRoom(socket) {
  if (!socket.room || !socket.peerId) return;

  const room = socket.room;
  const clients = rooms.get(room);

  if (clients) {
    clients.delete(socket.peerId);

    broadcast(room, {
      type: "peer-left",
      peerId: socket.peerId
    });

    if (clients.size === 0) {
      rooms.delete(room);
    }
  }

  socket.room = null;
  socket.peerId = null;
}

wss.on("connection", socket => {

  socket.on("message", message => {
    let data;

    try {
      data = JSON.parse(message.toString());
    } catch {
      send(socket, {
        type: "error",
        message: "Mensagem inválida."
      });
      return;
    }

    if (data.type !== "join") return;

    if (socket.room) {
      send(socket, {
        type: "error",
        message: "Você já está em uma sala."
      });
      return;
    }

    const room = String(data.room || "")
      .trim()
      .toLowerCase();

    const peerId = String(data.peerId || "");

    if (!/^[a-z0-9_-]{3,32}$/.test(room)) {
      send(socket, {
        type: "error",
        message: "Nome de sala inválido. Use 3 a 32 letras, números, - ou _."
      });
      return;
    }

    if (!peerId || peerId.length > 128) {
      send(socket, {
        type: "error",
        message: "ID de participante inválido."
      });
      return;
    }

    if (!rooms.has(room)) {
      rooms.set(room, new Map());
    }

    const clients = rooms.get(room);

    if (clients.size >= MAX_PLAYERS) {
      send(socket, {
        type: "error",
        message: "Esta sala já possui quatro pilotos."
      });
      return;
    }

    if (clients.has(peerId)) {
      send(socket, {
        type: "error",
        message: "Este participante já está na sala."
      });
      return;
    }

    socket.room = room;
    socket.peerId = peerId;

    const existingMembers = [...clients.keys()];

    clients.set(peerId, {
      socket,
      peerId
    });

    send(socket, {
      type: "joined",
      room,
      members: existingMembers,
      count: clients.size
    });

    broadcast(
      room,
      {
        type: "peer-joined",
        peerId,
        count: clients.size
      },
      socket
    );

    console.log(
      `Piloto ${peerId} entrou na sala ${room}. Total: ${clients.size}`
    );
  });

  socket.on("close", () => {
    leaveRoom(socket);
  });

  socket.on("error", () => {
    leaveRoom(socket);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Flight Friends online na porta ${PORT}`);
});

roomsServer.listen(3001, "0.0.0.0", () => {
  console.log("Servidor de salas online na porta 3001");
});
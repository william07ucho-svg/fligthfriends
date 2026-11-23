
window.FLIGHT_CONFIG = {
  PEER_SERVER_URL: "http://localhost:3000",
  ROOMS_SERVER_URL: "ws://localhost:3001/rooms",

  ICE_SERVERS: [
    { urls: "stun:stun.l.google.com:19302" }
  ],

  MAX_PLAYERS: 4,
  WIDTH: 1280,
  HEIGHT: 720,
  FPS: 30
};


const CONFIG = {
  SERVER_URL: "http://localhost:3000",

  ICE_SERVERS: [
    {
      urls: "stun:stun.l.google.com:19302"
    }
  ],

  MAX_PLAYERS: 4,
  WIDTH: 1280,
  HEIGHT: 720,
  FPS: 30
};

window.FLIGHT_CONFIG = CONFIG;

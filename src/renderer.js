


const $ = id => document.getElementById(id);

let peer = null;
let roomSocket = null;
let localStream = null;
let displayStream = null;
let micStream = null;
let audioContext = null;
let audioDestination = null;
let micEnabled = true;
let joined = false;
let myPeerId = null;

const members = new Set();
const calls = new Map();
const remoteStreams = new Map();
const cards = new Map();

function serverAddress(path) {
  const url = new URL(CONFIG.SERVER_URL);
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url;
}

function setConnection(online, message) {
  $("connectionDot").classList.toggle("online", online);
  $("connectionText").textContent = message;
}

function updateCount() {
  $("playerCount").textContent =
    `${members.size + (joined ? 1 : 0)} / ${CONFIG.MAX_PLAYERS} pilotos`;
}

async function loadSources() {
  const sources = await window.flightAPI.getSources();
  const select = $("sourceSelect");

  select.innerHTML = "";

  sources.forEach(source => {
    const option = document.createElement("option");
    option.value = source.id;
    option.textContent = source.name;
    select.appendChild(option);
  });
}

async function loadMicrophones() {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });

    const devices = await navigator.mediaDevices.enumerateDevices();

    $("micSelect").innerHTML = "";

    devices
      .filter(device => device.kind === "audioinput")
      .forEach(device => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent =
          device.label || "Microfone " + ( $("micSelect").length + 1 );

        $("micSelect").appendChild(option);
      });

    if ($("micSelect").options.length === 0) {
      $("micSelect").add(new Option("Microfone padrão", ""));
    }
  } catch (error) {
    console.warn("Não foi possível listar microfones:", error);
  }
}

function createCard(id, name, stream, local = false) {
  removeCard(id);

  const card = document.createElement("div");
  card.className = "video-card";
  card.dataset.peer = id;

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = local;
  video.srcObject = stream;

  const info = document.createElement("div");
  info.className = "video-info";

  const title = document.createElement("strong");
  title.textContent = local ? name + " (Você)" : name;

  const volume = document.createElement("input");
  volume.type = "range";
  volume.min = "0";
  volume.max = "1";
  volume.step = "0.05";
  volume.value = "0.8";
  volume.title = "Volume individual";

  volume.addEventListener("input", () => {
    video.volume = Number(volume.value);
  });

  if (local) {
    volume.disabled = true;
  }

  info.append(title, volume);
  card.append(video, info);

  card.addEventListener("dblclick", () => {
    card.classList.toggle("expanded");
  });

  $("videoGrid").appendChild(card);

  cards.set(id, card);
  return card;
}

function removeCard(id) {
  const card = cards.get(id);

  if (card) {
    card.remove();
    cards.delete(id);
  }
}

function displayRemote(id, stream) {
  remoteStreams.set(id, stream);
  createCard(id, "Piloto " + id.slice(0, 7), stream);
}

function removeRemote(id) {
  remoteStreams.delete(id);
  removeCard(id);

  const call = calls.get(id);

  if (call) {
    call.close();
    calls.delete(id);
  }
}

function connectTo(id) {
  if (!localStream || !peer || id === myPeerId) return;
  if (calls.has(id)) return;

  const call = peer.call(id, localStream);

  if (!call) return;

  calls.set(id, call);
  configureCall(id, call);
}

function configureCall(id, call) {
  call.on("stream", stream => {
    displayRemote(id, stream);
  });

  call.on("close", () => {
    removeRemote(id);
  });

  call.on("error", error => {
    console.error("Erro na chamada:", error);
  });
}

function handleIncomingCalls() {
  peer.on("call", call => {
    const remoteId = call.peer;

    call.answer(localStream || undefined);

    calls.set(remoteId, call);
    configureCall(remoteId, call);
  });
}

function connectRoomSocket(roomName) {
  return new Promise((resolve, reject) => {
    const url = new URL(CONFIG.SERVER_URL);
url.port = "3001";
url.pathname = "/rooms";
url.search = "";
url.hash = "";
url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

    roomSocket = new WebSocket(url);

    roomSocket.onopen = () => {
      roomSocket.send(JSON.stringify({
        type: "join",
        room: roomName,
        peerId: myPeerId
      }));
    };

    roomSocket.onmessage = event => {
      const data = JSON.parse(event.data);

      if (data.type === "joined") {
        joined = true;

        data.members.forEach(id => {
          if (id !== myPeerId) members.add(id);
        });

        updateCount();
        setConnection(true, "Conectado à sala");
        resolve();
      }

      if (data.type === "peer-joined") {
        if (data.peerId !== myPeerId) {
          members.add(data.peerId);
          updateCount();

          connectTo(data.peerId);
        }
      }

      if (data.type === "peer-left") {
        members.delete(data.peerId);
        removeRemote(data.peerId);
        updateCount();
      }

      if (data.type === "error") {
        setConnection(false, data.message);
        reject(new Error(data.message));
      }
    };

    roomSocket.onerror = () => {
      reject(new Error("Falha na conexão com o servidor de salas."));
    };

    roomSocket.onclose = () => {
      if (joined) {
        joined = false;
        setConnection(false, "Conexão encerrada");
        updateCount();
      }
    };
  });
}

async function joinRoom() {
  const roomName = $("roomName").value.trim();

  if (!roomName) {
    alert("Digite o nome da sala.");
    return;
  }

  $("joinBtn").disabled = true;
  setConnection(false, "Conectando...");

  try {
    const server = serverAddress("/");

    peer = new Peer(undefined, {
      host: server.hostname,
      port: server.port || (server.protocol === "https:" ? 443 : 80),
      secure: server.protocol === "https:",
      path: "/peerjs",
      config: {
        iceServers: CONFIG.ICE_SERVERS
      }
    });

    peer.on("open", async id => {
      myPeerId = id;

      handleIncomingCalls();

      try {
        await connectRoomSocket(roomName);

        $("joinBtn").disabled = true;
        $("leaveBtn").disabled = false;
      } catch (error) {
        alert(error.message);
        leaveRoom();
      }
    });

    peer.on("error", error => {
      console.error("PeerJS:", error);
      setConnection(false, "Erro PeerJS");
    });

  } catch (error) {
    alert(error.message);
    $("joinBtn").disabled = false;
  }
}

async function startSharing() {
  if (!joined || !peer) {
    alert("Entre em uma sala antes de transmitir.");
    return;
  }

  try {
    const sourceId = $("sourceSelect").value;

    if (!sourceId) {
      alert("Selecione uma janela ou tela.");
      return;
    }

    await window.flightAPI.selectSource(sourceId);

    const fps = Number($("fpsSelect").value);

    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: CONFIG.WIDTH, max: CONFIG.WIDTH },
        height: { ideal: CONFIG.HEIGHT, max: CONFIG.HEIGHT },
        frameRate: { ideal: fps, max: fps }
      },
      audio: true
    });

    const videoTrack = displayStream.getVideoTracks()[0];

    if (videoTrack) {
      await videoTrack.applyConstraints({
        width: { ideal: 1280, max: 1280 },
        height: { ideal: 720, max: 720 },
        frameRate: { ideal: fps, max: fps }
      }).catch(console.warn);

      videoTrack.onended = stopSharing;
    }

    const micId = $("micSelect").value;

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: micId
        ? {
            deviceId: { exact: micId },
            echoCancellation: true,
            noiseSuppression: true
          }
        : {
            echoCancellation: true,
            noiseSuppression: true
          },
      video: false
    });

    audioContext = new AudioContext();
    audioDestination = audioContext.createMediaStreamDestination();

    const systemTracks = displayStream.getAudioTracks();

    if (systemTracks.length > 0) {
      const systemAudio = new MediaStream(systemTracks);
      const systemNode = audioContext.createMediaStreamSource(systemAudio);

      systemNode.connect(audioDestination);
    }

    const micNode = audioContext.createMediaStreamSource(micStream);

    micNode.connect(audioDestination);

    localStream = new MediaStream([
      videoTrack,
      ...audioDestination.stream.getAudioTracks()
    ]);

    createCard(myPeerId, "Você", localStream, true);

    members.forEach(id => connectTo(id));

    $("shareBtn").disabled = true;
    $("stopBtn").disabled = false;

  } catch (error) {
    console.error(error);
    alert(
      "Não foi possível iniciar a transmissão: " + error.message
    );

    stopSharing();
  }
}

function toggleMic() {
  if (!micStream) {
    alert("Inicie a transmissão primeiro.");
    return;
  }

  micEnabled = !micEnabled;

  micStream.getAudioTracks().forEach(track => {
    track.enabled = micEnabled;
  });

  $("micBtn").textContent = micEnabled
    ? "🎙 Microfone ligado"
    : "🔇 Microfone mutado";
}

function stopSharing() {
  if (calls.size) {
    calls.forEach(call => call.close());
    calls.clear();
  }

  if (displayStream) {
    displayStream.getTracks().forEach(track => track.stop());
    displayStream = null;
  }

  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }

  if (audioContext) {
    audioContext.close().catch(console.error);
    audioContext = null;
  }

  localStream = null;
  audioDestination = null;

  removeCard(myPeerId);

  $("shareBtn").disabled = false;
  $("stopBtn").disabled = true;
  $("micBtn").textContent = "🎙 Microfone ligado";
  micEnabled = true;
}

function leaveRoom() {
  stopSharing();

  if (roomSocket) {
    roomSocket.close();
    roomSocket = null;
  }

  if (peer) {
    peer.destroy();
    peer = null;
  }

  members.clear();
  calls.clear();
  remoteStreams.clear();

  [...cards.keys()].forEach(removeCard);

  joined = false;
  myPeerId = null;

  $("joinBtn").disabled = false;
  $("leaveBtn").disabled = true;

  setConnection(false, "Desconectado");
  updateCount();
}

$("joinBtn").addEventListener("click", joinRoom);
$("leaveBtn").addEventListener("click", leaveRoom);
$("shareBtn").addEventListener("click", startSharing);
$("stopBtn").addEventListener("click", stopSharing);
$("micBtn").addEventListener("click", toggleMic);

window.addEventListener("beforeunload", leaveRoom);

loadSources();
loadMicrophones();

updateCount();

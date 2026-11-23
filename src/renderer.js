
const CONFIG = window.FLIGHT_CONFIG;
const $ = id => document.getElementById(id);

let peer = null;
let roomSocket = null;
let localStream = null;
let displayStream = null;
let micStream = null;
let audioContext = null;
let audioDestination = null;

let micEnabled = true;
let screenAudioEnabled = true;

// Volume inicial do microfone: 150%.
let micVolume = 1.5;

let micGain = null;
let systemAudioGain = null;

let joined = false;
let myPeerId = null;

const members = new Set();
const calls = new Map();
const remoteStreams = new Map();
const cards = new Map();

function setConnection(online, message) {
  $("connectionDot").classList.toggle("online", online);
  $("connectionText").textContent = message;
}

function updateCount() {
  $("playerCount").textContent =
    `${members.size + (joined ? 1 : 0)} / ${CONFIG.MAX_PLAYERS} pilotos`;
}

function updateAudioButtons() {
  const micBtn = $("micBtn");
  const screenBtn = $("screenAudioBtn");

  if (micBtn) {
    micBtn.textContent = micEnabled
      ? "🎙 Microfone ligado"
      : "🔇 Microfone mutado";
  }

  if (screenBtn) {
    screenBtn.textContent = screenAudioEnabled
      ? "🔊 Áudio da tela ligado"
      : "🔇 Áudio da tela mutado";
  }
}

// Cria automaticamente o botão de áudio da tela.
function createScreenAudioButton() {
  if ($("screenAudioBtn")) return;

  const micBtn = $("micBtn");

  if (!micBtn) return;

  const button = document.createElement("button");

  button.id = "screenAudioBtn";
  button.type = "button";
  button.className = micBtn.className;
  button.textContent = "🔊 Áudio da tela ligado";
  button.disabled = true;
  button.title = "Controlar o áudio do simulador ou da tela";

  micBtn.insertAdjacentElement("afterend", button);

  button.addEventListener("click", toggleScreenAudio);
}

// Cria o controle de volume do microfone.
function createMicVolumeControl() {
  if ($("micVolumeContainer")) return;

  const anchor = $("screenAudioBtn") || $("micBtn");

  if (!anchor) return;

  const container = document.createElement("div");
  container.id = "micVolumeContainer";

  container.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin: 8px 0;
    padding: 8px 10px;
    max-width: 260px;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.12);
  `;

  const label = document.createElement("label");
  label.htmlFor = "micVolumeSlider";
  label.textContent = "🎙 Volume do microfone: ";

  const value = document.createElement("strong");
  value.id = "micVolumeValue";
  value.textContent = "150%";

  label.appendChild(value);

  const slider = document.createElement("input");
  slider.id = "micVolumeSlider";
  slider.type = "range";
  slider.min = "100";
  slider.max = "300";
  slider.step = "10";
  slider.value = "150";
  slider.title = "Ajustar o volume do microfone";

  slider.style.cssText = `
    width: 100%;
    cursor: pointer;
  `;

  slider.addEventListener("input", () => {
    micVolume = Number(slider.value) / 100;

    value.textContent = slider.value + "%";

    // Ajusta o microfone imediatamente, sem afetar o áudio da tela.
    if (micGain && audioContext) {
      const targetVolume = micEnabled ? micVolume : 0;

      micGain.gain.setTargetAtTime(
        targetVolume,
        audioContext.currentTime,
        0.03
      );
    }
  });

  container.append(label, slider);

  anchor.insertAdjacentElement("afterend", container);
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
    const permissionStream =
      await navigator.mediaDevices.getUserMedia({ audio: true });

    permissionStream.getTracks().forEach(track => track.stop());

    const devices = await navigator.mediaDevices.enumerateDevices();

    $("micSelect").innerHTML = "";

    devices
      .filter(device => device.kind === "audioinput")
      .forEach(device => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent =
          device.label || "Microfone " + ($("micSelect").length + 1);

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

  video.play().catch(error => {
    console.warn("Não foi possível reproduzir o vídeo:", error);
  });

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
    calls.delete(id);
    call.close();
  }
}

function connectTo(id) {
  if (!peer || id === myPeerId || !members.has(id)) return;

  if (calls.has(id)) return;

  const call = peer.call(id, localStream || undefined);

  if (!call) return;

  calls.set(id, call);
  configureCall(id, call);
}

function configureCall(id, call) {
  call.on("stream", stream => {
    if (calls.get(id) === call) {
      displayRemote(id, stream);
    }
  });

  call.on("close", () => {
    if (calls.get(id) !== call) return;

    calls.delete(id);
    remoteStreams.delete(id);
    removeCard(id);
  });

  call.on("error", error => {
    console.error("Erro na chamada:", error);
  });
}

function handleIncomingCalls() {
  peer.on("call", call => {
    const remoteId = call.peer;

    const existingCall = calls.get(remoteId);

    if (existingCall) {
      console.warn("Já existe uma chamada com:", remoteId);
      call.close();
      return;
    }

    calls.set(remoteId, call);

    configureCall(remoteId, call);

    call.answer(localStream || undefined);
  });
}

function connectRoomSocket(roomName) {
  return new Promise((resolve, reject) => {
    roomSocket = new WebSocket(CONFIG.ROOMS_SERVER_URL);

    roomSocket.onopen = () => {
      roomSocket.send(JSON.stringify({
        type: "join",
        room: roomName,
        peerId: myPeerId
      }));
    };

    roomSocket.onmessage = event => {
      let data;

      try {
        data = JSON.parse(event.data);
      } catch (error) {
        console.error("Mensagem inválida do servidor:", error);
        return;
      }

      if (data.type === "joined") {
        joined = true;

        data.members.forEach(id => {
          if (id !== myPeerId) {
            members.add(id);
          }
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
    peer = new Peer(undefined, {
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
        console.error("Erro ao entrar na sala:", error);
        alert(error.message);
        leaveRoom();
      }
    });

    peer.on("error", error => {
      console.error("PeerJS:", error);
      setConnection(false, "Erro PeerJS");
      $("joinBtn").disabled = false;
    });

  } catch (error) {
    console.error(error);
    alert(error.message);
    $("joinBtn").disabled = false;
  }
}

async function startSharing() {
  if (!joined || !peer) {
    alert("Entre em uma sala antes de transmitir.");
    return;
  }

  if (localStream) {
    alert("Você já está compartilhando sua tela.");
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

      videoTrack.onended = () => stopSharing();
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

    // Cria o sistema de áudio separado.
    audioContext = new AudioContext();

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    audioDestination = audioContext.createMediaStreamDestination();

    // Áudio do simulador ou da tela.
    const systemTracks = displayStream.getAudioTracks();

    systemAudioGain = null;
    screenAudioEnabled = true;

    if (systemTracks.length > 0) {
      const systemAudio = new MediaStream(systemTracks);
      const systemNode = audioContext.createMediaStreamSource(systemAudio);

      systemAudioGain = audioContext.createGain();
      systemAudioGain.gain.value = 1;

      systemNode.connect(systemAudioGain);
      systemAudioGain.connect(audioDestination);
    }

    // Microfone com amplificação independente.
    const micNode = audioContext.createMediaStreamSource(micStream);

    micGain = audioContext.createGain();
    micGain.gain.value = micEnabled ? micVolume : 0;

    micNode.connect(micGain);
    micGain.connect(audioDestination);

    // Junta os áudios já controlados em uma faixa de saída.
    localStream = new MediaStream([
      ...displayStream.getVideoTracks(),
      ...audioDestination.stream.getAudioTracks()
    ]);

    micEnabled = true;

    // Aplica o volume selecionado ao iniciar.
    micGain.gain.value = micVolume;

    createCard(myPeerId, "Você", localStream, true);

    members.forEach(id => connectTo(id));

    $("shareBtn").disabled = true;
    $("stopBtn").disabled = false;

    $("screenAudioBtn").disabled = systemTracks.length === 0;

    if (systemTracks.length === 0) {
      console.warn(
        "A tela compartilhada não forneceu áudio. Verifique se a opção de compartilhar áudio está disponível e selecionada."
      );
    }

    updateAudioButtons();

  } catch (error) {
    console.error(error);

    alert(
      "Não foi possível iniciar a transmissão: " + error.message
    );

    stopSharing(false);
  }
}

// Controle exclusivo do microfone.
function toggleMic() {
  if (!micStream || !micGain) {
    alert("Inicie a transmissão primeiro.");
    return;
  }

  micEnabled = !micEnabled;

  micGain.gain.setTargetAtTime(
    micEnabled ? micVolume : 0,
    audioContext.currentTime,
    0.03
  );

  updateAudioButtons();
}

// Controle exclusivo do áudio do simulador ou da tela.
function toggleScreenAudio() {
  if (!displayStream || !systemAudioGain) {
    alert(
      "O áudio da tela não está disponível. Verifique se a tela compartilhada está transmitindo áudio."
    );
    return;
  }

  screenAudioEnabled = !screenAudioEnabled;

  systemAudioGain.gain.value = screenAudioEnabled ? 1 : 0;

  updateAudioButtons();
}

function stopSharing(reconnect = true) {
  const peerIds = [...members];

  calls.forEach((call, id) => {
    calls.delete(id);
    call.close();
  });

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

  micGain = null;
  systemAudioGain = null;

  removeCard(myPeerId);

  micEnabled = true;
  screenAudioEnabled = true;

  $("shareBtn").disabled = false;
  $("stopBtn").disabled = true;
  $("screenAudioBtn").disabled = true;

  updateAudioButtons();

  if (reconnect && joined && peer) {
    peerIds.forEach(id => connectTo(id));
  }
}

function leaveRoom() {
  stopSharing(false);

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

createScreenAudioButton();
createMicVolumeControl();

$("joinBtn").addEventListener("click", joinRoom);
$("leaveBtn").addEventListener("click", leaveRoom);
$("shareBtn").addEventListener("click", startSharing);
$("stopBtn").addEventListener("click", stopSharing);
$("micBtn").addEventListener("click", toggleMic);

window.addEventListener("beforeunload", leaveRoom);

loadSources();
loadMicrophones();

updateCount();

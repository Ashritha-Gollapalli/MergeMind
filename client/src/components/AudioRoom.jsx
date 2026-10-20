import { useEffect, useRef, useState } from "react";
import {
  Headphones,
  Mic,
  MicOff,
  PhoneOff,
  Users,
} from "lucide-react";
import { io } from "socket.io-client";
import { getSocketUrl } from "../config/urls";

function getIceServers() {
  const stunUrls = (
    import.meta.env.VITE_STUN_URL || "stun:stun.l.google.com:19302"
  )
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  const iceServers = stunUrls.map((url) => ({ urls: url }));
  const turnUrl = import.meta.env.VITE_TURN_SERVER_URL;

  if (turnUrl) {
    const username = import.meta.env.VITE_TURN_USERNAME;
    const credential = import.meta.env.VITE_TURN_CREDENTIAL;
    if (!username || !credential) {
      throw new Error(
        "Configure VITE_TURN_USERNAME and VITE_TURN_CREDENTIAL with the TURN server."
      );
    }
    iceServers.push({ urls: turnUrl, username, credential });
  }

  return iceServers;
}

function cleanupAudioResources(refs) {
  refs.activeRef.current = false;
  refs.joinedRef.current = false;
  refs.peersRef.current.forEach((peer) => {
    peer.ontrack = null;
    peer.onicecandidate = null;
    peer.onconnectionstatechange = null;
    peer.close();
  });
  refs.peersRef.current.clear();
  refs.pendingCandidatesRef.current.clear();
  refs.iceRestartAttemptsRef.current.clear();
  refs.iceRestartsInProgressRef.current.clear();
  refs.streamRef.current?.getTracks().forEach((track) => track.stop());
  refs.socketRef.current?.removeAllListeners();
  refs.socketRef.current?.disconnect();
  if (refs.speakingFrameRef.current !== null) {
    window.cancelAnimationFrame(refs.speakingFrameRef.current);
  }
  refs.audioContextRef.current?.close();
}

export default function AudioRoom({
  projectId,
  userName = "You",
  token: accessToken,
}) {
  const [status, setStatus] = useState("off");
  const [muted, setMuted] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [error, setError] = useState("");
  const [rosterOpen, setRosterOpen] = useState(false);
  const socketRef = useRef(null);
  const streamRef = useRef(null);
  const peersRef = useRef(new Map());
  const pendingCandidatesRef = useRef(new Map());
  const iceRestartAttemptsRef = useRef(new Map());
  const iceRestartsInProgressRef = useRef(new Set());
  const joinedRef = useRef(false);
  const joiningRef = useRef(false);
  const activeRef = useRef(true);
  const statusRef = useRef({ muted: true, speaking: false });
  const audioContextRef = useRef(null);
  const speakingFrameRef = useRef(null);

  function updateParticipant(socketId, update) {
    setParticipants((current) => {
      const existing = current.find(
        (participant) => participant.socketId === socketId
      );
      if (!existing) {
        return [...current, { socketId, userName: "Collaborator", ...update }];
      }

      return current.map((participant) =>
        participant.socketId === socketId
          ? { ...participant, ...update }
          : participant
      );
    });
  }

  function removeParticipant(socketId) {
    const peer = peersRef.current.get(socketId);
    if (peer) {
      peer.ontrack = null;
      peer.onicecandidate = null;
      peer.onconnectionstatechange = null;
      peer.close();
    }
    peersRef.current.delete(socketId);
    pendingCandidatesRef.current.delete(socketId);
    iceRestartAttemptsRef.current.delete(socketId);
    iceRestartsInProgressRef.current.delete(socketId);
    setParticipants((current) =>
      current.filter((participant) => participant.socketId !== socketId)
    );
  }

  function closePeerConnections() {
    peersRef.current.forEach((peer) => {
      peer.ontrack = null;
      peer.onicecandidate = null;
      peer.onconnectionstatechange = null;
      peer.close();
    });
    peersRef.current.clear();
    pendingCandidatesRef.current.clear();
    iceRestartAttemptsRef.current.clear();
    iceRestartsInProgressRef.current.clear();
    setParticipants([]);
  }

  function emitAudioStatus(nextMuted, nextSpeaking) {
    const nextStatus = {
      muted: nextMuted,
      speaking: nextMuted ? false : nextSpeaking,
    };
    statusRef.current = nextStatus;
    if (!activeRef.current) return;
    setSpeaking(nextStatus.speaking);

    if (joinedRef.current) {
      socketRef.current?.emit("audio:state", {
        projectId,
        ...nextStatus,
      });
    }
  }

  function stopSpeakingDetection() {
    if (speakingFrameRef.current !== null) {
      window.cancelAnimationFrame(speakingFrameRef.current);
      speakingFrameRef.current = null;
    }
    audioContextRef.current?.close();
    audioContextRef.current = null;
  }

  function startSpeakingDetection() {
    stopSpeakingDetection();
    const AudioContextConstructor = window.AudioContext;
    if (!AudioContextConstructor || !streamRef.current) {
      setError("Speaking detection is unavailable in this browser.");
      return;
    }

    try {
      const context = new AudioContextConstructor();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(streamRef.current).connect(analyser);
      context.resume().catch((resumeError) => {
        console.error("Could not resume speaking detection:", resumeError);
        if (activeRef.current) {
          setError("Speaking detection could not be resumed.");
        }
      });
      const samples = new Uint8Array(analyser.fftSize);
      audioContextRef.current = context;

      const detect = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          const value = (sample - 128) / 128;
          sum += value * value;
        }
        const speaking =
          !statusRef.current.muted &&
          Math.sqrt(sum / samples.length) > 0.045;

        if (speaking !== statusRef.current.speaking) {
          emitAudioStatus(statusRef.current.muted, speaking);
        }
        speakingFrameRef.current = window.requestAnimationFrame(detect);
      };

      speakingFrameRef.current = window.requestAnimationFrame(detect);
    } catch (detectionError) {
      console.error("Speaking detection failed:", detectionError);
      setError("Speaking detection could not be started.");
    }
  }

  async function sendSignal(eventName, payload) {
    const socket = socketRef.current;
    if (!socket?.connected) {
      throw new Error("Audio signaling is disconnected.");
    }

    return new Promise((resolve, reject) => {
      socket.emit(eventName, payload, (result) => {
        if (result?.ok) {
          resolve();
        } else {
          reject(new Error(result?.message || "Audio signaling failed."));
        }
      });
    });
  }

  function createPeerConnection(participant) {
    const existingPeer = peersRef.current.get(participant.socketId);
    if (existingPeer) return existingPeer;

    const peer = new RTCPeerConnection({ iceServers: getIceServers() });
    peersRef.current.set(participant.socketId, peer);
    updateParticipant(participant.socketId, participant);

    for (const track of streamRef.current?.getTracks() || []) {
      peer.addTrack(track, streamRef.current);
    }

    peer.ontrack = (event) => {
      const remoteStream =
        event.streams[0] || new MediaStream([event.track]);
      updateParticipant(participant.socketId, {
        ...participant,
        stream: remoteStream,
      });
    };
    peer.onicecandidate = (event) => {
      sendSignal("audio:ice-candidate", {
        projectId,
        to: participant.socketId,
        candidate: event.candidate,
      }).catch((signalError) => {
        if (activeRef.current) setError(signalError.message);
      });
    };
    peer.onconnectionstatechange = () => {
      if (!activeRef.current) return;
      if (peer.connectionState === "connected") {
        iceRestartAttemptsRef.current.delete(participant.socketId);
        return;
      }
      if (
        peer.connectionState !== "failed" ||
        !socketRef.current?.id ||
        socketRef.current?.id <= participant.socketId ||
        peer.signalingState !== "stable" ||
        iceRestartsInProgressRef.current.has(participant.socketId)
      ) {
        return;
      }

      const attempts =
        iceRestartAttemptsRef.current.get(participant.socketId) || 0;
      if (attempts >= 2) {
        setError("Audio connection failed. Check your network or TURN settings.");
        return;
      }

      iceRestartAttemptsRef.current.set(participant.socketId, attempts + 1);
      iceRestartsInProgressRef.current.add(participant.socketId);
      (async () => {
        try {
          const offer = await peer.createOffer({ iceRestart: true });
          await peer.setLocalDescription(offer);
          await sendSignal("audio:offer", {
            projectId,
            to: participant.socketId,
            description: peer.localDescription,
          });
        } catch (restartError) {
          if (activeRef.current) setError(restartError.message);
        } finally {
          iceRestartsInProgressRef.current.delete(participant.socketId);
        }
      })();
    };

    return peer;
  }

  async function applyPendingCandidates(socketId, peer) {
    const pending = pendingCandidatesRef.current.get(socketId) || [];
    pendingCandidatesRef.current.delete(socketId);
    for (const candidate of pending) {
      await peer.addIceCandidate(candidate);
    }
  }

  async function handleOffer(message) {
    try {
      const peer = createPeerConnection({
        ...message.participant,
        socketId: message.fromSocketId,
      });
      await peer.setRemoteDescription(message.description);
      await applyPendingCandidates(message.fromSocketId, peer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await sendSignal("audio:answer", {
        projectId,
        to: message.fromSocketId,
        description: peer.localDescription,
      });
    } catch (signalError) {
      if (activeRef.current) {
        setError(
          `Could not establish audio with a participant: ${signalError.message}`
        );
      }
    }
  }

  async function handleAnswer(message) {
    try {
      const peer = peersRef.current.get(message.fromSocketId);
      if (!peer) return;
      await peer.setRemoteDescription(message.description);
      await applyPendingCandidates(message.fromSocketId, peer);
    } catch (signalError) {
      if (activeRef.current) {
        setError(
          `Could not complete the audio connection: ${signalError.message}`
        );
      }
    }
  }

  async function handleIceCandidate(message) {
    try {
      const peer = peersRef.current.get(message.fromSocketId);
      if (!message.candidate) return;
      if (!peer || !peer.remoteDescription) {
        const pending =
          pendingCandidatesRef.current.get(message.fromSocketId) || [];
        pending.push(message.candidate);
        pendingCandidatesRef.current.set(message.fromSocketId, pending);
        return;
      }
      if (peer.remoteDescription) {
        await peer.addIceCandidate(message.candidate);
      }
    } catch (signalError) {
      if (activeRef.current) {
        setError(
          `Could not process an audio network candidate: ${signalError.message}`
        );
      }
    }
  }

  async function offerToParticipant(participant) {
    const localSocketId = socketRef.current?.id;
    if (
      !localSocketId ||
      localSocketId <= participant.socketId ||
      peersRef.current.has(participant.socketId)
    ) {
      return;
    }

    try {
      const peer = createPeerConnection(participant);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await sendSignal("audio:offer", {
        projectId,
        to: participant.socketId,
        description: peer.localDescription,
      });
    } catch (signalError) {
      if (activeRef.current) {
        setError(`Could not start audio with a participant: ${signalError.message}`);
      }
    }
  }

  async function joinAudioRoom() {
    if (
      !streamRef.current ||
      !socketRef.current?.connected ||
      joinedRef.current ||
      joiningRef.current
    ) {
      return;
    }

    joiningRef.current = true;
    setStatus("connecting");
    try {
      const result = await new Promise((resolve, reject) => {
        socketRef.current.emit("audio:join", { projectId }, (response) => {
          if (response?.ok) resolve(response);
          else reject(new Error(response?.message || "Could not join audio."));
        });
      });
      if (!activeRef.current) return;
      joinedRef.current = true;
      joiningRef.current = false;
      setStatus("connected");
      setError("");
      setParticipants(result.participants || []);
      emitAudioStatus(statusRef.current.muted, false);
      startSpeakingDetection();

      await Promise.all(
        (result.participants || []).map(offerToParticipant)
      );
    } catch (joinError) {
      joiningRef.current = false;
      if (!activeRef.current) return;
      setStatus(joinedRef.current ? "connected" : "error");
      setError(joinError.message);
    }
  }

  function createAudioSocket() {
    const token = accessToken || localStorage.getItem("token");
    if (!token) {
      throw new Error("Sign in again before joining project audio.");
    }

    getIceServers();
    const socket = io(getSocketUrl(), {
      auth: { token },
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;
    socket.on("connect", () => {
      setStatus("connecting");
      joinAudioRoom();
    });
    socket.on("connect_error", (connectError) => {
      setStatus("error");
      setError(`Audio connection failed: ${connectError.message}`);
    });
    socket.on("project:access-revoked", ({ projectId: roomId }) => {
      if (roomId === projectId) {
        leaveAudio();
        setError("Your access to this project was revoked.");
      }
    });
    socket.on("disconnect", () => {
      joinedRef.current = false;
      joiningRef.current = false;
      closePeerConnections();
      stopSpeakingDetection();
      if (streamRef.current) setStatus("reconnecting");
    });
    socket.on("audio:participant-joined", ({ projectId: roomId, participant }) => {
      if (roomId === projectId) {
        updateParticipant(participant.socketId, participant);
        offerToParticipant(participant);
      }
    });
    socket.on("audio:participant-left", ({ projectId: roomId, socketId }) => {
      if (roomId === projectId) removeParticipant(socketId);
    });
    socket.on(
      "audio:participant-state",
      ({ projectId: roomId, socketId, muted: isMuted, speaking }) => {
        if (roomId === projectId) {
          updateParticipant(socketId, { muted: isMuted, speaking });
        }
      }
    );
    socket.on("audio:offer", (message) => {
      if (message.projectId === projectId) handleOffer(message);
    });
    socket.on("audio:answer", (message) => {
      if (message.projectId === projectId) handleAnswer(message);
    });
    socket.on("audio:ice-candidate", (message) => {
      if (message.projectId === projectId) handleIceCandidate(message);
    });
  }

  async function joinAudio() {
    setError("");
    if (!window.isSecureContext) {
      setError("Microphone access requires HTTPS (or localhost).");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser does not support microphone access.");
      return;
    }
    if (!window.RTCPeerConnection) {
      setError("This browser does not support real-time audio connections.");
      return;
    }

    setStatus("connecting");
    try {
      if (!streamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!activeRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        stream.getAudioTracks().forEach((track) => {
          track.enabled = !statusRef.current.muted;
        });
      }
      if (!socketRef.current) createAudioSocket();
      if (socketRef.current.connected) joinAudioRoom();
    } catch (joinError) {
      console.error("Microphone access failed:", joinError);
      if (!activeRef.current) return;
      setStatus("error");
      setError(
        joinError.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow microphone access in your browser settings."
          : `Could not start the microphone: ${joinError.message}`
      );
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }

  function toggleMute() {
    const nextMuted = !statusRef.current.muted;
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setMuted(nextMuted);
    emitAudioStatus(nextMuted, false);
  }

  function leaveAudio() {
    const socket = socketRef.current;
    if (socket?.connected && joinedRef.current) {
      socket.emit("audio:leave", { projectId });
    }
    joinedRef.current = false;
    joiningRef.current = false;
    closePeerConnections();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    socket?.disconnect();
    socketRef.current = null;
    stopSpeakingDetection();
    statusRef.current = { muted: true, speaking: false };
    setSpeaking(false);
    setMuted(true);
    setStatus("off");
    setParticipants([]);
    setError("");
  }

  useEffect(
    () => {
      activeRef.current = true;
      return () =>
        cleanupAudioResources({
          activeRef,
          joinedRef,
          peersRef,
          pendingCandidatesRef,
          iceRestartAttemptsRef,
          iceRestartsInProgressRef,
          streamRef,
          socketRef,
          speakingFrameRef,
          audioContextRef,
        });
    },
    [projectId]
  );

  const joined = status === "connected" || status === "reconnecting";
  const participantCount = participants.length + (joined ? 1 : 0);

  return (
    <div className="audio-room">
      {joined ? (
        <>
          <button
            className="audio-control-button"
            type="button"
            onClick={toggleMute}
            aria-label={muted ? "Unmute microphone" : "Mute microphone"}
            title={muted ? "Unmute microphone" : "Mute microphone"}
          >
            {muted ? <MicOff size={16} /> : <Mic size={16} />}
            <span>{muted ? "Unmute" : "Mute"}</span>
          </button>
          <button
            className="audio-control-button audio-leave-button"
            type="button"
            onClick={leaveAudio}
            aria-label="Leave audio"
            title="Leave audio"
          >
            <PhoneOff size={16} />
            <span>Leave</span>
          </button>
        </>
      ) : (
        <button
          className="audio-control-button audio-join-button"
          type="button"
          onClick={joinAudio}
          disabled={status === "connecting"}
        >
          <Headphones size={16} />
          <span>{status === "connecting" ? "Connecting..." : "Join Audio"}</span>
        </button>
      )}

      {joined ? (
        <div className="audio-roster-anchor">
          <button
            className="audio-control-button audio-roster-button"
            type="button"
            onClick={() => setRosterOpen((open) => !open)}
            aria-expanded={rosterOpen}
            aria-label={`Audio participants: ${participantCount}`}
          >
            <Users size={16} />
            <span>{participantCount}</span>
          </button>
          {rosterOpen && (
            <div className="audio-roster" role="status">
              <strong>
                Audio participants
                {status === "reconnecting" ? " · Reconnecting" : ""}
              </strong>
              <div className="audio-participant">
                <span
                  className={`audio-speaking-indicator ${
                    speaking ? "is-speaking" : ""
                  }`}
                />
                <span>{userName} (you)</span>
                {muted ? <MicOff size={14} aria-label="Muted" /> : <Mic size={14} />}
              </div>
              {participants.map((participant) => (
                <div className="audio-participant" key={participant.socketId}>
                  <span
                    className={`audio-speaking-indicator ${
                      participant.speaking ? "is-speaking" : ""
                    }`}
                  />
                  <span>{participant.userName}</span>
                  {participant.muted ? (
                    <MicOff size={14} aria-label="Muted" />
                  ) : (
                    <Mic size={14} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        status === "error" &&
        streamRef.current && (
          <button
            className="audio-control-button audio-leave-button"
            type="button"
            onClick={leaveAudio}
          >
            <PhoneOff size={16} />
            <span>Cancel</span>
          </button>
        )
      )}

      <div className="audio-playback" aria-hidden="true">
        {participants.map(
          (participant) =>
            participant.stream && (
              <audio
                key={participant.socketId}
                autoPlay
                playsInline
                className="audio-remote-playback"
                ref={(element) => {
                  if (element && element.srcObject !== participant.stream) {
                    element.srcObject = participant.stream;
                    element.play().catch((playError) => {
                      console.error("Remote audio playback failed:", playError);
                      if (activeRef.current) {
                        setError(
                          "Remote audio playback was blocked. Interact with the page to enable audio."
                        );
                      }
                    });
                  }
                }}
              />
            )
        )}
      </div>

      {error && (
        <span className="audio-error" role="alert" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}

import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import {
  Send,
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  ArrowRight,
} from "lucide-react";

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  "https://debate-backend-production-0bba.up.railway.app/";

export default function App() {
  const [step, setStep] = useState("setup"); // 'setup', 'searching', 'chatting'
  const [socket, setSocket] = useState(null);
  const [filters, setFilters] = useState({ religion: "", language: "English" });
  const [localStream, setLocalStream] = useState(null);

  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState("");

  const [room, setRoom] = useState(null);
  const [peerId, setPeerId] = useState(null);

  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(false);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const chatBottomRef = useRef(null);

  // Initialize socket connection
  useEffect(() => {
    const newSocket = io(SERVER_URL, {
      transports: ["websocket", "polling"],
    });
    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // Request media permissions
  const getMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      return stream;
    } catch (err) {
      console.error("Failed to get local stream", err);
      alert("Could not access camera/microphone. Please allow permissions.");
      return null;
    }
  };

  // Scroll to latest message
  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Setup socket listeners for state
  useEffect(() => {
    if (!socket) return;

    socket.on("queued", () => {
      console.log("In queue...");
    });

    socket.on("matched", async (data) => {
      console.log("Matched with", data);
      setRoom(data.room);
      setPeerId(data.peerId);
      setStep("chatting");
      setMessages([
        {
          type: "system",
          text: "You are now connected with a debate partner!",
        },
      ]);

      // Make sure we have stream before connecting
      let stream = localStream;
      if (!stream) {
        stream = await getMedia();
      }

      initPeerConnection(stream, data.initiator, data.peerId);
    });

    socket.on("signal", async (data) => {
      if (peerConnectionRef.current) {
        const signal = data.signal;

        try {
          if (signal.type === "offer") {
            await peerConnectionRef.current.setRemoteDescription(
              new RTCSessionDescription(signal),
            );
            const answer = await peerConnectionRef.current.createAnswer();
            await peerConnectionRef.current.setLocalDescription(answer);
            socket.emit("signal", { to: data.from, signal: answer });
          } else if (signal.type === "answer") {
            await peerConnectionRef.current.setRemoteDescription(
              new RTCSessionDescription(signal),
            );
          } else if (signal.candidate) {
            await peerConnectionRef.current.addIceCandidate(
              new RTCIceCandidate(signal),
            );
          }
        } catch (err) {
          console.error("Error processing signaling data:", err);
        }
      }
    });

    socket.on("message", (data) => {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + Math.random(),
          type: data.fromUser === socket.id ? "own" : "remote",
          text: data.text,
        },
      ]);
    });

    // Partner disconnected logic
    socket.on("peerDisconnected", () => {
      handlePartnerDisconnect();
    });

    return () => {
      socket.off("queued");
      socket.off("matched");
      socket.off("signal");
      socket.off("message");
      socket.off("peerDisconnected");
    };
  }, [socket, localStream]);

  const initPeerConnection = (stream, isInitiator, targetPeerId) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:global.stun.twilio.com:3478" },
      ],
    });

    peerConnectionRef.current = pc;

    // Add local tracks
    if (stream) {
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("signal", { to: targetPeerId, signal: event.candidate });
      }
    };

    // Handle remote stream
    pc.ontrack = (event) => {
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    // If initiator, create offer
    if (isInitiator) {
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          socket.emit("signal", {
            to: targetPeerId,
            signal: pc.localDescription,
          });
        })
        .catch((err) => console.error("Error creating offer", err));
    }
  };

  const startSearching = async () => {
    await getMedia();
    setStep("searching");
    socket.emit("joinQueue", filters);
  };

  const cancelSearching = () => {
    socket.emit("leaveQueue");
    setStep("setup");
  };

  const nextPerson = () => {
    cleanupConnection();
    setStep("searching");
    socket.emit("joinQueue", filters);
  };

  const endChat = () => {
    cleanupConnection();
    setStep("setup");
  };

  const handlePartnerDisconnect = () => {
    setMessages((prev) => [
      ...prev,
      { type: "system", text: "Partner disconnected." },
    ]);
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  };

  const cleanupConnection = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    setRoom(null);
    setPeerId(null);
    setMessages([]);
    socket.emit("leaveQueue");
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (!messageInput.trim() || !room) return;

    socket.emit("message", {
      room,
      text: messageInput.trim(),
      fromUser: socket.id,
    });
    setMessageInput("");
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks()[0].enabled = isVideoMuted;
      setIsVideoMuted(!isVideoMuted);
    }
  };

  const toggleAudio = () => {
    if (localStream) {
      localStream.getAudioTracks()[0].enabled = isAudioMuted;
      setIsAudioMuted(!isAudioMuted);
    }
  };

  // Setup local video element whenever stream changes
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, step]);

  return (
    <div className="app-container">
      <header className="header">
        <div className="logo">Debatify.</div>
      </header>

      {step === "setup" && (
        <div className="setup-screen">
          <div className="setup-card glass-panel">
            <h2>Find Your Match</h2>

            <div className="form-group">
              <label>Your Stance / Religion</label>
              <select
                className="form-control"
                value={filters.religion}
                onChange={(e) =>
                  setFilters({ ...filters, religion: e.target.value })
                }
              >
                <option value="">Any Stance</option>
                <option value="Atheist">Atheist</option>
                <option value="Christian">Christian</option>
                <option value="Muslim">Muslim</option>
                <option value="Jewish">Jewish</option>
                <option value="Hindu">Hindu</option>
                <option value="Buddhist">Buddhist</option>
                <option value="Agnostic">Agnostic</option>
              </select>
            </div>

            <div className="form-group">
              <label>Preferred Language</label>
              <select
                className="form-control"
                value={filters.language}
                onChange={(e) =>
                  setFilters({ ...filters, language: e.target.value })
                }
              >
                <option value="English">English</option>
                <option value="Arabic">Arabic</option>
                <option value="French">French</option>
                <option value="Spanish">Spanish</option>
              </select>
            </div>

            <button className="primary-btn" onClick={startSearching}>
              Start Debating
            </button>
          </div>
        </div>
      )}

      {step === "searching" && (
        <div className="searching-container">
          <div className="radar-spinner">
            <div className="pulse"></div>
          </div>
          <div className="searching-text">Finding a worthy opponent...</div>
          <button className="cancel-btn" onClick={cancelSearching}>
            Cancel Search
          </button>
        </div>
      )}

      {step === "chatting" && (
        <div className="chat-layout">
          <div className="videos-panel">
            <div className="video-container remote glass-panel">
              <video ref={remoteVideoRef} autoPlay playsInline></video>
              <div className="video-label">Stranger</div>
            </div>

            <div className="video-container local glass-panel">
              <video ref={localVideoRef} autoPlay playsInline muted></video>
              <div className="video-label">You</div>

              <div className="floating-controls">
                <button
                  className={`control-btn ${isAudioMuted ? "danger" : ""}`}
                  onClick={toggleAudio}
                  title="Toggle Microphone"
                >
                  {isAudioMuted ? <MicOff size={20} /> : <Mic size={20} />}
                </button>
                <button
                  className={`control-btn ${isVideoMuted ? "danger" : ""}`}
                  onClick={toggleVideo}
                  title="Toggle Camera"
                >
                  {isVideoMuted ? <VideoOff size={20} /> : <Video size={20} />}
                </button>
                <button
                  className="control-btn danger"
                  onClick={endChat}
                  title="End Chat"
                >
                  <PhoneOff size={20} />
                </button>
                <button className="next-btn" onClick={nextPerson}>
                  Skip <ArrowRight size={18} />
                </button>
              </div>
            </div>
          </div>

          <div className="chat-panel">
            <div className="chat-header">
              <div className="status-dot"></div>
              Live Debate Session
            </div>

            <div className="chat-messages">
              {messages.map((msg, i) => (
                <div key={msg.id || i} className={`message ${msg.type}`}>
                  {msg.text}
                </div>
              ))}
              <div ref={chatBottomRef}></div>
            </div>

            <form className="chat-input-container" onSubmit={sendMessage}>
              <input
                type="text"
                className="chat-input"
                placeholder="Type your argument..."
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
              />
              <button
                type="submit"
                className="send-btn"
                disabled={!messageInput.trim()}
              >
                <Send size={20} />
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

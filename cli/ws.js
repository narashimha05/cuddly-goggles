const io = require("socket.io-client");

let socket = null;
let chatCallback = null;
let chatRequestCallback = null;
let messageReadCallback = null;

function connectSocket(token) {
  if (socket) return socket;
  socket = io("http://localhost:3000", {
    auth: { token },
  });
  socket.on("connect", () => {
    console.log("[WebSocket] Connected for real-time presence.");
  });
  socket.on("disconnect", () => {
    console.log("[WebSocket] Disconnected from server.");
  });
  socket.on("privateMessage", (m) => {
    // Emit messageRead to backend
    if (socket && m.from && m.from.userId) {
      socket.emit("messageRead", { fromUserId: m.from.userId });
    }
    if (chatCallback) chatCallback(m);
  });
  socket.on("chatRequest", (data) => {
    if (chatRequestCallback) chatRequestCallback(data);
  });
  socket.on("messageRead", (data) => {
    if (messageReadCallback) messageReadCallback(data);
  });
  return socket;
}

function onChatMessage(cb) {
  chatCallback = cb;
}

function onChatRequest(cb) {
  chatRequestCallback = cb;
}

function onMessageRead(cb) {
  messageReadCallback = cb;
}

function sendChatMessage(toUserId, text) {
  if (socket) {
    socket.emit("privateMessage", { toUserId, text });
  }
}

module.exports = {
  connectSocket,
  onChatMessage,
  onChatRequest,
  sendChatMessage,
  onMessageRead,
};

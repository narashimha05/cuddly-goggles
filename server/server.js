/*
  server.js - DevChat backend
  Minimal production: uses JWT, bcrypt, MongoDB, Socket.io.
  Start with: npm install && npm start
*/
const express = require("express");
const http = require("http");
const cors = require("cors");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { nanoid } = require("nanoid");

const { User, FriendRequest, Message } = require("./models");

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost:27017/devchat";
const PORT = process.env.PORT || 3000;

async function main() {
  await mongoose.connect(MONGO_URL, {});

  const app = express();
  app.use(cors());
  app.use(bodyParser.json());

  const server = http.createServer(app);
  const { Server } = require("socket.io");
  const io = new Server(server, { cors: { origin: "*" } });

  const online = new Map(); // userId -> socketId

  function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Missing token" });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = payload;
      next();
    } catch (err) {
      return res.status(401).json({ error: "Invalid token" });
    }
  }

  // Signup
  app.post("/signup", async (req, res) => {
    try {
      const { username, email, password } = req.body;
      if (!username || !password)
        return res.status(400).json({ error: "Missing fields" });
      const existing = await User.findOne({ username });
      if (existing) return res.status(400).json({ error: "Username taken" });

      const passwordHash = await bcrypt.hash(password, 10);
      const userId = nanoid(8).toUpperCase();
      const user = new User({ username, email, passwordHash, userId });
      await user.save();

      const token = jwt.sign(
        { id: user._id, userId: user.userId },
        JWT_SECRET,
        { expiresIn: "30d" }
      );
      res.json({
        token,
        user: { username: user.username, userId: user.userId },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Login
  app.post("/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      const user = await User.findOne({ username });
      if (!user) return res.status(400).json({ error: "Not found" });
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return res.status(400).json({ error: "Invalid credentials" });
      const token = jwt.sign(
        { id: user._id, userId: user.userId },
        JWT_SECRET,
        { expiresIn: "30d" }
      );
      res.json({
        token,
        user: { username: user.username, userId: user.userId },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Me
  app.get("/me", authMiddleware, async (req, res) => {
    const u = await User.findById(req.user.id)
      .select("-passwordHash")
      .populate("friends", "username userId");
    res.json(u);
  });

  // Friends list
  app.get("/friends", authMiddleware, async (req, res) => {
    const u = await User.findById(req.user.id).populate(
      "friends",
      "username userId"
    );
    res.json({
      friends: u.friends.map((f) => ({
        username: f.username,
        userId: f.userId,
      })),
    });
  });

  // Get pending friend requests
  app.get("/friend-requests", authMiddleware, async (req, res) => {
    try {
      const requests = await FriendRequest.find({
        to: req.user.id,
        status: "pending",
      }).populate("from", "username userId");
      res.json({ requests });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Online friends
  app.get("/friends/online", authMiddleware, async (req, res) => {
    const u = await User.findById(req.user.id).populate(
      "friends",
      "username userId"
    );
    const onlineFriends = u.friends
      .filter((f) => online.has(f.userId))
      .map((f) => ({ username: f.username, userId: f.userId }));
    res.json({ online: onlineFriends });
  });

  // Send friend request
  app.post("/friend-request", authMiddleware, async (req, res) => {
    try {
      const { targetUserId } = req.body;
      const target = await User.findOne({ userId: targetUserId });
      if (!target) return res.status(404).json({ error: "Target not found" });
      const me = await User.findById(req.user.id);
      if (me.friends.includes(target._id))
        return res.status(400).json({ error: "Already friends" });
      const fr = new FriendRequest({ from: me._id, to: target._id });
      await fr.save();
      const targetSockId = online.get(target.userId);
      if (targetSockId)
        io.to(targetSockId).emit("friendRequest", {
          from: { username: me.username, userId: me.userId },
          id: fr._id,
        });
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Accept friend request
  app.post("/friend-request/accept", authMiddleware, async (req, res) => {
    try {
      const { requestId } = req.body;
      const fr = await FriendRequest.findById(requestId).populate("from to");
      if (!fr) return res.status(404).json({ error: "Request not found" });
      if (fr.to._id.toString() !== req.user.id)
        return res.status(403).json({ error: "Not authorized" });
      fr.status = "accepted";
      await fr.save();
      const A = await User.findById(fr.from._id);
      const B = await User.findById(fr.to._id);
      if (!A.friends.includes(B._id)) A.friends.push(B._id);
      if (!B.friends.includes(A._id)) B.friends.push(A._id);
      await A.save();
      await B.save();
      const requesterSocket = online.get(A.userId);
      if (requesterSocket)
        io.to(requesterSocket).emit("friendRequestAccepted", {
          from: { username: B.username, userId: B.userId },
        });
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Reject friend request
  app.post("/friend-request/reject", authMiddleware, async (req, res) => {
    try {
      const { requestId } = req.body;
      const fr = await FriendRequest.findById(requestId);
      if (!fr) return res.status(404).json({ error: "Request not found" });
      if (fr.to.toString() !== req.user.id)
        return res.status(403).json({ error: "Not authorized" });
      fr.status = "declined";
      await fr.save();
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Chat request
  app.post("/chat/request", authMiddleware, async (req, res) => {
    try {
      const { targetUserId } = req.body;
      const target = await User.findOne({ userId: targetUserId });
      if (!target) return res.status(404).json({ error: "Target not found" });
      const me = await User.findById(req.user.id);
      const targetSockId = online.get(target.userId);
      if (targetSockId) {
        io.to(targetSockId).emit("chatRequest", {
          from: { username: me.username, userId: me.userId },
        });
        return res.json({ success: true, notified: true });
      } else {
        return res.json({ success: true, notified: false });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Messages history
  app.get("/messages/:friendUserId", authMiddleware, async (req, res) => {
    try {
      const friendUserId = req.params.friendUserId;
      const friend = await User.findOne({ userId: friendUserId });
      if (!friend) return res.status(404).json({ error: "Friend not found" });
      const msgs = await Message.find({
        $or: [
          { from: req.user.id, to: friend._id },
          { from: friend._id, to: req.user.id },
        ],
      }).sort({ createdAt: 1 });
      res.json({
        messages: msgs.map((m) => ({
          from: m.from.toString() === req.user.id ? "me" : "them",
          text: m.text,
          createdAt: m.createdAt,
        })),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Socket auth
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Missing token"));
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      socket.user = payload;
      return next();
    } catch (err) {
      return next(new Error("Invalid token"));
    }
  });

  io.on("connection", async (socket) => {
    try {
      const user = await User.findById(socket.user.id);
      if (!user) return socket.disconnect(true);
      online.set(user.userId, socket.id);

      const me = await User.findById(socket.user.id).populate(
        "friends",
        "userId username"
      );
      me.friends.forEach((f) => {
        const sock = online.get(f.userId);
        if (sock)
          io.to(sock).emit("presence", {
            userId: user.userId,
            username: user.username,
            status: "online",
          });
      });

      socket.on("privateMessage", async (payload) => {
        const { toUserId, text } = payload;
        const toUser = await User.findOne({ userId: toUserId });
        if (!toUser) return;
        const m = new Message({ from: socket.user.id, to: toUser._id, text });
        await m.save();
        const timestamp = m.createdAt;
        const targetSock = online.get(toUser.userId);
        if (targetSock) {
          io.to(targetSock).emit("privateMessage", {
            from: { username: user.username, userId: user.userId },
            text,
            createdAt: timestamp,
          });
        }
        // If recipient is offline, message is already stored in DB as unread
      });

      // Typing indicator
      socket.on("typing", async (payload) => {
        const { toUserId } = payload;
        const toUser = await User.findOne({ userId: toUserId });
        if (!toUser) return;
        const targetSock = online.get(toUser.userId);
        if (targetSock) {
          io.to(targetSock).emit("typing", {
            from: { username: user.username, userId: user.userId },
          });
        }
      });

      // Message read indicator
      socket.on("messageRead", async (payload) => {
        const { fromUserId } = payload;
        const fromUser = await User.findOne({ userId: fromUserId });
        if (!fromUser) return;
        const targetSock = online.get(fromUser.userId);
        if (targetSock) {
          io.to(targetSock).emit("messageRead", {
            by: { username: user.username, userId: user.userId },
          });
        }
      });

      socket.on("disconnect", async () => {
        online.delete(user.userId);
        me.friends.forEach((f) => {
          const sock = online.get(f.userId);
          if (sock)
            io.to(sock).emit("presence", {
              userId: user.userId,
              username: user.username,
              status: "offline",
            });
        });
      });
    } catch (err) {
      console.error("socket error", err);
    }
  });

  app.get("/", (req, res) => res.send("DevChat server running"));
  // Get unread messages for the logged-in user
  app.get("/messages/unread", authMiddleware, async (req, res) => {
    try {
      const msgs = await Message.find({ to: req.user.id }).sort({
        createdAt: 1,
      });
        res.json({
          messages: msgs.map((m) => ({
            from: m.from ? `${m.from.username} (${m.from.userId})` : "Unknown",
            text: m.text,
            createdAt: m.createdAt
          }))
        });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });
  server.listen(PORT, () => console.log("Server listening on", PORT));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

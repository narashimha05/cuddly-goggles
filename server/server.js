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
const crypto = require("crypto");

const {
  User,
  FriendRequest,
  Message,
  SharedFile,
  Reminder,
  Mail,
} = require("./models");

// Simple constants - no config file needed!
const JWT_SECRET =
  process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
const ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "devchat-encryption-key-32-chars"; // Must be consistent!
const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost:27017/devchat";
const PORT = process.env.PORT || 3000;

// Encryption/Decryption functions for API keys
function encryptApiKey(text) {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY, "salt", 32);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decryptApiKey(text) {
  const parts = text.split(":");
  const iv = Buffer.from(parts[0], "hex");
  const encryptedText = parts[1];
  const key = crypto.scryptSync(ENCRYPTION_KEY, "salt", 32);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

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

  // Get inbox - all messages received by the logged-in user (must come before parameterized route)
  app.get("/messages/inbox", authMiddleware, async (req, res) => {
    try {
      const msgs = await Message.find({ to: req.user.id })
        .populate("from", "username userId")
        .sort({ createdAt: -1 });
      res.json({
        messages: msgs.map((m) => ({
          _id: m._id,
          from: m.from
            ? { username: m.from.username, userId: m.from.userId }
            : { username: "Unknown", userId: "Unknown" },
          text: m.text,
          createdAt: m.createdAt,
        })),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Get unread messages for the logged-in user (must come before parameterized route)
  app.get("/messages/unread", authMiddleware, async (req, res) => {
    try {
      const msgs = await Message.find({ to: req.user.id })
        .populate("from", "username userId")
        .sort({
          createdAt: 1,
        });
      res.json({
        messages: msgs.map((m) => ({
          from: m.from ? `${m.from.username} (${m.from.userId})` : "Unknown",
          text: m.text,
          createdAt: m.createdAt,
        })),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Messages history (parameterized route must come after specific routes)
  app.get("/messages/:friendUserId", authMiddleware, async (req, res) => {
    try {
      const friendUserId = req.params.friendUserId;
      const limit = parseInt(req.query.limit) || 50;
      const friend = await User.findOne({ userId: friendUserId });
      if (!friend) return res.status(404).json({ error: "Friend not found" });

      const me = await User.findById(req.user.id);

      const msgs = await Message.find({
        $or: [
          { from: req.user.id, to: friend._id },
          { from: friend._id, to: req.user.id },
        ],
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate("from", "username userId");

      res.json({
        messages: msgs.reverse().map((m) => ({
          from: m.from && m.from._id.toString() === req.user.id ? "me" : "them",
          username: m.from ? m.from.username : "Unknown",
          userId: m.from ? m.from.userId : "Unknown",
          text: m.text,
          createdAt: m.createdAt,
        })),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Clear inbox messages (delete messages received by user)
  app.delete("/messages/clear", authMiddleware, async (req, res) => {
    try {
      const { messageIds } = req.body; // array of message IDs or "all"

      if (messageIds === "all") {
        // Delete all messages received by this user
        await Message.deleteMany({ to: req.user.id });
        res.json({ success: true, message: "All inbox messages cleared" });
      } else if (Array.isArray(messageIds) && messageIds.length > 0) {
        // Delete specific messages by _id
        await Message.deleteMany({ _id: { $in: messageIds }, to: req.user.id });
        res.json({
          success: true,
          message: `${messageIds.length} message(s) cleared`,
        });
      } else {
        res.status(400).json({ error: "Invalid messageIds parameter" });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Remove friend
  app.delete("/friends/:friendUserId", authMiddleware, async (req, res) => {
    try {
      const friendUserId = req.params.friendUserId;
      const friend = await User.findOne({ userId: friendUserId });
      if (!friend) return res.status(404).json({ error: "Friend not found" });

      const me = await User.findById(req.user.id);

      // Check if they are actually friends
      if (!me.friends.includes(friend._id)) {
        return res.status(400).json({ error: "Not friends with this user" });
      }

      // Remove from both friend lists
      await User.findByIdAndUpdate(req.user.id, {
        $pull: { friends: friend._id },
      });
      await User.findByIdAndUpdate(friend._id, { $pull: { friends: me._id } });

      res.json({
        success: true,
        message: `Removed ${friend.username} from friends`,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Delete user account
  app.delete("/user/delete", authMiddleware, async (req, res) => {
    try {
      const userId = req.user.id;
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ error: "User not found" });

      // Remove user from all friends' friend lists
      await User.updateMany(
        { friends: userId },
        { $pull: { friends: userId } }
      );

      // Delete all friend requests involving this user
      await FriendRequest.deleteMany({
        $or: [{ from: userId }, { to: userId }],
      });

      // Delete all messages involving this user
      await Message.deleteMany({
        $or: [{ from: userId }, { to: userId }],
      });

      // Delete all shared files by this user
      await SharedFile.deleteMany({ owner: userId });

      // Delete the user
      await User.findByIdAndDelete(userId);

      res.json({ success: true, message: "Account deleted successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Upload and share file
  app.post("/files/share", authMiddleware, async (req, res) => {
    try {
      const { filename, content, mimeType, size, sharedWith, description } =
        req.body;

      // Validate
      if (!filename || !content) {
        return res.status(400).json({ error: "Missing filename or content" });
      }

      // Size limit: 5MB
      const MAX_SIZE = 5 * 1024 * 1024;
      if (size > MAX_SIZE) {
        return res
          .status(400)
          .json({ error: "File too large. Maximum size is 5MB" });
      }

      // Verify shared users are friends
      if (sharedWith && sharedWith.length > 0) {
        const me = await User.findById(req.user.id);
        for (const userId of sharedWith) {
          const friend = await User.findOne({ userId });
          if (!friend) {
            return res.status(404).json({ error: `User ${userId} not found` });
          }
          if (!me.friends.includes(friend._id)) {
            return res
              .status(403)
              .json({ error: `Not friends with ${userId}` });
          }
        }
      }

      // Create share record
      const shareId = "SHR_" + nanoid(8).toUpperCase();
      const friendIds = [];

      if (sharedWith && sharedWith.length > 0) {
        for (const userId of sharedWith) {
          const friend = await User.findOne({ userId });
          friendIds.push(friend._id);
        }
      }

      const sharedFile = new SharedFile({
        owner: req.user.id,
        filename,
        mimeType,
        size,
        content,
        sharedWith: friendIds,
        shareId,
        description: description || "",
      });

      await sharedFile.save();

      // Send notification to shared users
      const owner = await User.findById(req.user.id);
      for (const friendId of friendIds) {
        const notifMsg = new Message({
          from: req.user.id,
          to: friendId,
          text: `📎 ${owner.username} shared a file: ${filename} (${(
            size / 1024
          ).toFixed(1)} KB)\nUse /download ${shareId}`,
        });
        await notifMsg.save();

        // Notify via WebSocket if online
        const friend = await User.findById(friendId);
        const targetSock = online.get(friend.userId);
        if (targetSock) {
          io.to(targetSock).emit("privateMessage", {
            from: { username: owner.username, userId: owner.userId },
            text: notifMsg.text,
            createdAt: notifMsg.createdAt,
          });
        }
      }

      res.json({
        success: true,
        shareId,
        message: `File shared with ${friendIds.length} friend(s)`,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // List files shared with me
  app.get("/files/shared-with-me", authMiddleware, async (req, res) => {
    try {
      const files = await SharedFile.find({ sharedWith: req.user.id })
        .populate("owner", "username userId")
        .sort({ createdAt: -1 });

      res.json({
        files: files.map((f) => ({
          shareId: f.shareId,
          filename: f.filename,
          size: f.size,
          mimeType: f.mimeType,
          owner: {
            username: f.owner.username,
            userId: f.owner.userId,
          },
          description: f.description,
          downloads: f.downloads,
          createdAt: f.createdAt,
        })),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // List my shared files
  app.get("/files/my-shares", authMiddleware, async (req, res) => {
    try {
      const files = await SharedFile.find({ owner: req.user.id })
        .populate("sharedWith", "username userId")
        .sort({ createdAt: -1 });

      res.json({
        files: files.map((f) => ({
          shareId: f.shareId,
          filename: f.filename,
          size: f.size,
          mimeType: f.mimeType,
          sharedWith: f.sharedWith.map((u) => ({
            username: u.username,
            userId: u.userId,
          })),
          description: f.description,
          downloads: f.downloads,
          createdAt: f.createdAt,
        })),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Download file
  app.get("/files/download/:shareId", authMiddleware, async (req, res) => {
    try {
      const { shareId } = req.params;
      const file = await SharedFile.findOne({ shareId }).populate(
        "owner",
        "username userId"
      );

      if (!file) {
        return res.status(404).json({ error: "File not found" });
      }

      // Check access: must be owner or in sharedWith list
      const hasAccess =
        file.owner._id.toString() === req.user.id ||
        file.sharedWith.some((id) => id.toString() === req.user.id);

      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Increment download count
      file.downloads += 1;
      await file.save();

      res.json({
        filename: file.filename,
        content: file.content,
        mimeType: file.mimeType,
        size: file.size,
        owner: {
          username: file.owner.username,
          userId: file.owner.userId,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Delete shared file
  app.delete("/files/:shareId", authMiddleware, async (req, res) => {
    try {
      const { shareId } = req.params;
      const file = await SharedFile.findOne({ shareId });

      if (!file) {
        return res.status(404).json({ error: "File not found" });
      }

      // Only owner can delete
      if (file.owner.toString() !== req.user.id) {
        return res
          .status(403)
          .json({ error: "Only the owner can delete this file" });
      }

      await SharedFile.findByIdAndDelete(file._id);
      res.json({ success: true, message: "File deleted" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Create reminder
  app.post("/reminders", authMiddleware, async (req, res) => {
    try {
      const { text } = req.body;

      if (!text || !text.trim()) {
        return res.status(400).json({ error: "Reminder text is required" });
      }

      const reminder = new Reminder({
        user: req.user.id,
        text: text.trim(),
      });
      await reminder.save();

      res.json({
        success: true,
        message: "Reminder saved!",
        reminder: {
          id: reminder._id,
          text: reminder.text,
          createdAt: reminder.createdAt,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Get all reminders
  app.get("/reminders", authMiddleware, async (req, res) => {
    try {
      const reminders = await Reminder.find({ user: req.user.id }).sort({
        createdAt: -1,
      });
      res.json({ reminders });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Delete single reminder
  app.delete("/reminders/:id", authMiddleware, async (req, res) => {
    try {
      const reminder = await Reminder.findOne({
        _id: req.params.id,
        user: req.user.id,
      });

      if (!reminder) {
        return res.status(404).json({ error: "Reminder not found" });
      }

      await Reminder.deleteOne({ _id: req.params.id });
      res.json({ success: true, message: "Reminder deleted" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Delete all reminders
  app.delete("/reminders", authMiddleware, async (req, res) => {
    try {
      const result = await Reminder.deleteMany({ user: req.user.id });
      res.json({
        success: true,
        message: `Deleted ${result.deletedCount} reminder(s)`,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Set API key (encrypted)
  app.post("/api-keys", authMiddleware, async (req, res) => {
    try {
      const { provider, apiKey } = req.body;

      if (!provider || !apiKey) {
        return res.status(400).json({ error: "Provider and API key required" });
      }

      const validProviders = ["openai", "anthropic", "gemini"];
      if (!validProviders.includes(provider.toLowerCase())) {
        return res.status(400).json({
          error: `Invalid provider. Use: ${validProviders.join(", ")}`,
        });
      }

      const user = await User.findById(req.user.id);
      if (!user.apiKeys) {
        user.apiKeys = new Map();
      }

      // Encrypt and store
      const encrypted = encryptApiKey(apiKey);
      user.apiKeys.set(provider.toLowerCase(), encrypted);
      await user.save();

      res.json({
        success: true,
        message: `${provider} API key saved successfully`,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Get available API keys (just provider names, not actual keys)
  app.get("/api-keys", authMiddleware, async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      const providers = user.apiKeys ? Array.from(user.apiKeys.keys()) : [];
      res.json({ providers });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Get decrypted API key (for internal use)
  app.post("/api-keys/decrypt", authMiddleware, async (req, res) => {
    try {
      const { provider } = req.body;
      const user = await User.findById(req.user.id);

      if (!user.apiKeys || !user.apiKeys.has(provider)) {
        return res
          .status(404)
          .json({ error: `No API key set for ${provider}` });
      }

      const encrypted = user.apiKeys.get(provider);
      const decrypted = decryptApiKey(encrypted);

      res.json({ apiKey: decrypted });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // ============================================
  // MAIL SYSTEM API ENDPOINTS
  // ============================================

  // Send mail
  app.post("/mail/send", authMiddleware, async (req, res) => {
    try {
      const { to, cc, bcc, subject, body, priority, readReceipt, attachments } =
        req.body;

      if (!to || to.length === 0 || !subject || !body) {
        return res
          .status(400)
          .json({ error: "Missing required fields (to, subject, body)" });
      }

      // Parse recipients: username@devchat.com -> username
      const parseRecipients = async (recipients) => {
        const userIds = [];
        for (const recipient of recipients) {
          const username = recipient.replace(/@devchat\.com$/, "");
          const user = await User.findOne({ username });
          if (!user) {
            return { error: `User not found: ${recipient}` };
          }
          userIds.push(user._id);
        }
        return { userIds };
      };

      const toResult = await parseRecipients(Array.isArray(to) ? to : [to]);
      if (toResult.error)
        return res.status(400).json({ error: toResult.error });

      let ccIds = [];
      if (cc && cc.length > 0) {
        const ccResult = await parseRecipients(Array.isArray(cc) ? cc : [cc]);
        if (ccResult.error)
          return res.status(400).json({ error: ccResult.error });
        ccIds = ccResult.userIds;
      }

      let bccIds = [];
      if (bcc && bcc.length > 0) {
        const bccResult = await parseRecipients(
          Array.isArray(bcc) ? bcc : [bcc]
        );
        if (bccResult.error)
          return res.status(400).json({ error: bccResult.error });
        bccIds = bccResult.userIds;
      }

      // Create thread ID for grouping
      const threadId = nanoid(12);

      const mail = new Mail({
        from: req.user.id,
        to: toResult.userIds,
        cc: ccIds,
        bcc: bccIds,
        subject,
        body,
        threadId,
        priority: priority || "normal",
        readReceiptRequested: readReceipt || false,
        attachments: attachments || [],
      });

      await mail.save();

      res.json({
        success: true,
        message: "Mail sent successfully",
        mailId: mail._id,
        threadId: mail.threadId,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Get inbox
  app.get("/mail/inbox", authMiddleware, async (req, res) => {
    try {
      const mails = await Mail.find({
        $or: [{ to: req.user.id }, { cc: req.user.id }, { bcc: req.user.id }],
        deletedBy: { $ne: req.user.id },
      })
        .populate("from", "username userId")
        .populate("to", "username userId")
        .populate("cc", "username userId")
        .sort({ createdAt: -1 })
        .limit(50);

      const formattedMails = mails.map((m) => ({
        _id: m._id,
        from: m.from,
        to: m.to,
        cc: m.cc,
        subject: m.subject,
        body: m.body.substring(0, 100) + (m.body.length > 100 ? "..." : ""),
        priority: m.priority,
        isRead: m.readBy.includes(req.user.id),
        isStarred: m.starredBy.includes(req.user.id),
        hasAttachments: m.attachments.length > 0,
        createdAt: m.createdAt,
        threadId: m.threadId,
      }));

      res.json({ mails: formattedMails });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Get sent mail
  app.get("/mail/sent", authMiddleware, async (req, res) => {
    try {
      const mails = await Mail.find({
        from: req.user.id,
        deletedBy: { $ne: req.user.id },
      })
        .populate("from", "username userId")
        .populate("to", "username userId")
        .populate("cc", "username userId")
        .sort({ createdAt: -1 })
        .limit(50);

      const formattedMails = mails.map((m) => ({
        _id: m._id,
        from: m.from,
        to: m.to,
        cc: m.cc,
        subject: m.subject,
        body: m.body.substring(0, 100) + (m.body.length > 100 ? "..." : ""),
        priority: m.priority,
        hasAttachments: m.attachments.length > 0,
        createdAt: m.createdAt,
        threadId: m.threadId,
      }));

      res.json({ mails: formattedMails });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Read a mail (full details)
  app.get("/mail/:mailId", authMiddleware, async (req, res) => {
    try {
      const mail = await Mail.findById(req.params.mailId)
        .populate("from", "username userId")
        .populate("to", "username userId")
        .populate("cc", "username userId")
        .populate("bcc", "username userId")
        .populate("attachments");

      if (!mail) {
        return res.status(404).json({ error: "Mail not found" });
      }

      // Check if user is recipient
      const isRecipient =
        mail.to.some((u) => u._id.equals(req.user.id)) ||
        mail.cc.some((u) => u._id.equals(req.user.id)) ||
        mail.bcc.some((u) => u._id.equals(req.user.id)) ||
        mail.from._id.equals(req.user.id);

      if (!isRecipient) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Mark as read if recipient (not sender)
      if (
        !mail.from._id.equals(req.user.id) &&
        !mail.readBy.includes(req.user.id)
      ) {
        mail.readBy.push(req.user.id);
        await mail.save();
      }

      res.json({ mail });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Reply to mail
  app.post("/mail/:mailId/reply", authMiddleware, async (req, res) => {
    try {
      const { body, replyAll } = req.body;

      if (!body) {
        return res.status(400).json({ error: "Missing body" });
      }

      const originalMail = await Mail.findById(req.params.mailId)
        .populate("from", "username userId")
        .populate("to", "username userId")
        .populate("cc", "username userId");

      if (!originalMail) {
        return res.status(404).json({ error: "Original mail not found" });
      }

      // Determine recipients for reply
      let toIds = [originalMail.from._id];
      let ccIds = [];

      if (replyAll) {
        // Include all original recipients except current user
        toIds = [
          originalMail.from._id,
          ...originalMail.to
            .filter((u) => !u._id.equals(req.user.id))
            .map((u) => u._id),
        ];
        ccIds = originalMail.cc
          .filter((u) => !u._id.equals(req.user.id))
          .map((u) => u._id);
      }

      const replyMail = new Mail({
        from: req.user.id,
        to: toIds,
        cc: ccIds,
        subject: originalMail.subject.startsWith("Re: ")
          ? originalMail.subject
          : `Re: ${originalMail.subject}`,
        body,
        threadId: originalMail.threadId,
        inReplyTo: originalMail._id,
        priority: originalMail.priority,
      });

      await replyMail.save();

      res.json({
        success: true,
        message: "Reply sent",
        mailId: replyMail._id,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Forward mail
  app.post("/mail/:mailId/forward", authMiddleware, async (req, res) => {
    try {
      const { to, cc, body } = req.body;

      if (!to || to.length === 0) {
        return res.status(400).json({ error: "Missing recipients" });
      }

      const originalMail = await Mail.findById(req.params.mailId);

      if (!originalMail) {
        return res.status(404).json({ error: "Original mail not found" });
      }

      // Parse recipients
      const parseRecipients = async (recipients) => {
        const userIds = [];
        for (const recipient of recipients) {
          const username = recipient.replace(/@devchat\.com$/, "");
          const user = await User.findOne({ username });
          if (!user) {
            return { error: `User not found: ${recipient}` };
          }
          userIds.push(user._id);
        }
        return { userIds };
      };

      const toResult = await parseRecipients(Array.isArray(to) ? to : [to]);
      if (toResult.error)
        return res.status(400).json({ error: toResult.error });

      let ccIds = [];
      if (cc && cc.length > 0) {
        const ccResult = await parseRecipients(Array.isArray(cc) ? cc : [cc]);
        if (ccResult.error)
          return res.status(400).json({ error: ccResult.error });
        ccIds = ccResult.userIds;
      }

      const forwardedBody = `${
        body || ""
      }\n\n---------- Forwarded message ----------\n${originalMail.body}`;

      const forwardMail = new Mail({
        from: req.user.id,
        to: toResult.userIds,
        cc: ccIds,
        subject: originalMail.subject.startsWith("Fwd: ")
          ? originalMail.subject
          : `Fwd: ${originalMail.subject}`,
        body: forwardedBody,
        threadId: nanoid(12), // New thread for forwards
        priority: originalMail.priority,
        attachments: originalMail.attachments,
      });

      await forwardMail.save();

      res.json({
        success: true,
        message: "Mail forwarded",
        mailId: forwardMail._id,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Star/unstar mail
  app.post("/mail/:mailId/star", authMiddleware, async (req, res) => {
    try {
      const mail = await Mail.findById(req.params.mailId);

      if (!mail) {
        return res.status(404).json({ error: "Mail not found" });
      }

      const isStarred = mail.starredBy.includes(req.user.id);

      if (isStarred) {
        mail.starredBy = mail.starredBy.filter((id) => !id.equals(req.user.id));
      } else {
        mail.starredBy.push(req.user.id);
      }

      await mail.save();

      res.json({
        success: true,
        starred: !isStarred,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Archive mail
  app.post("/mail/:mailId/archive", authMiddleware, async (req, res) => {
    try {
      const mail = await Mail.findById(req.params.mailId);

      if (!mail) {
        return res.status(404).json({ error: "Mail not found" });
      }

      const isArchived = mail.archivedBy.includes(req.user.id);

      if (isArchived) {
        mail.archivedBy = mail.archivedBy.filter(
          (id) => !id.equals(req.user.id)
        );
      } else {
        mail.archivedBy.push(req.user.id);
      }

      await mail.save();

      res.json({
        success: true,
        archived: !isArchived,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Delete mail (soft delete)
  app.delete("/mail/:mailId", authMiddleware, async (req, res) => {
    try {
      const mail = await Mail.findById(req.params.mailId);

      if (!mail) {
        return res.status(404).json({ error: "Mail not found" });
      }

      if (!mail.deletedBy.includes(req.user.id)) {
        mail.deletedBy.push(req.user.id);
        await mail.save();
      }

      res.json({
        success: true,
        message: "Mail deleted",
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Get thread (all mails in a conversation)
  app.get("/mail/thread/:threadId", authMiddleware, async (req, res) => {
    try {
      const mails = await Mail.find({
        threadId: req.params.threadId,
        deletedBy: { $ne: req.user.id },
      })
        .populate("from", "username userId")
        .populate("to", "username userId")
        .populate("cc", "username userId")
        .sort({ createdAt: 1 });

      res.json({ mails });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // ============================================
  // END MAIL SYSTEM API ENDPOINTS
  // ============================================

  // ============================================
  // GMAIL INTEGRATION API ENDPOINTS
  // ============================================

  // Setup Gmail credentials
  app.post("/gmail/setup", authMiddleware, async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "Email and password required" });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: "Invalid email format" });
      }

      // Encrypt the app password
      const encryptedPassword = encryptApiKey(password);

      // Update user with Gmail credentials
      await User.findByIdAndUpdate(req.user.id, {
        gmailCredentials: {
          email,
          password: encryptedPassword,
        },
      });

      res.json({
        success: true,
        message: "Gmail credentials saved successfully",
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Send email via Gmail
  app.post("/gmail/send", authMiddleware, async (req, res) => {
    try {
      const { to, subject, body, cc } = req.body;

      if (!to || !subject || !body) {
        return res
          .status(400)
          .json({ error: "To, subject, and body are required" });
      }

      // Get user's Gmail credentials
      const user = await User.findById(req.user.id);

      if (!user.gmailCredentials || !user.gmailCredentials.email) {
        return res.status(400).json({
          error: "Gmail not configured. Use /gmail setup first",
        });
      }

      // Decrypt password
      const decryptedPassword = decryptApiKey(user.gmailCredentials.password);

      // Create nodemailer transporter
      const nodemailer = require("nodemailer");
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: user.gmailCredentials.email,
          pass: decryptedPassword,
        },
      });

      // Setup email options
      const mailOptions = {
        from: user.gmailCredentials.email,
        to: Array.isArray(to) ? to.join(", ") : to,
        subject,
        text: body,
      };

      if (cc) {
        mailOptions.cc = Array.isArray(cc) ? cc.join(", ") : cc;
      }

      // Send email
      await transporter.sendMail(mailOptions);

      res.json({
        success: true,
        message: "Email sent successfully via Gmail",
      });
    } catch (err) {
      console.error(err);
      if (err.responseCode === 535) {
        res.status(401).json({
          error:
            "Gmail authentication failed. Please check your credentials and make sure you're using an App Password",
        });
      } else {
        res.status(500).json({ error: err.message || "Failed to send email" });
      }
    }
  });

  // Get Gmail setup status
  app.get("/gmail/status", authMiddleware, async (req, res) => {
    try {
      const user = await User.findById(req.user.id);

      const configured = !!(
        user.gmailCredentials && user.gmailCredentials.email
      );

      res.json({
        configured,
        email: configured ? user.gmailCredentials.email : null,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Remove Gmail credentials
  app.delete("/gmail/setup", authMiddleware, async (req, res) => {
    try {
      await User.findByIdAndUpdate(req.user.id, {
        $unset: { gmailCredentials: "" },
      });

      res.json({
        success: true,
        message: "Gmail credentials removed",
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // ============================================
  // END GMAIL INTEGRATION API ENDPOINTS
  // ============================================

  // ============================================

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
        console.log(
          new Date().toISOString(),
          "privateMessage from",
          user.userId,
          "to",
          toUserId
        );
        const m = new Message({ from: socket.user.id, to: toUser._id, text });
        await m.save();
        const timestamp = m.createdAt;
        const targetSock = online.get(toUser.userId);
        // Verify the socket is actually connected (avoid stale socket IDs)
        const targetSockObj = targetSock
          ? io.sockets.sockets.get(targetSock)
          : null;
        console.log(
          new Date().toISOString(),
          "targetSock lookup for",
          toUser.userId,
          "->",
          targetSock,
          "sockObjPresent:",
          !!targetSockObj
        );
        if (targetSock && targetSockObj && targetSockObj.connected) {
          console.log(
            new Date().toISOString(),
            "emitting privateMessage to socket",
            targetSock
          );
          io.to(targetSock).emit("privateMessage", {
            from: { username: user.username, userId: user.userId },
            text,
            createdAt: timestamp,
          });
        } else {
          console.log(
            new Date().toISOString(),
            "recipient offline or stale socket; notifying sender",
            socket.id
          );
          // Recipient appears offline — notify the sender immediately
          io.to(socket.id).emit("chatPartnerOffline", {
            userId: toUser.userId,
            username: toUser.username,
            message: `${toUser.username} is now offline and can't receive messages. Returning to main menu.`,
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
          if (sock) {
            io.to(sock).emit("presence", {
              userId: user.userId,
              username: user.username,
              status: "offline",
            });
            // Notify active chat partners that this user is now offline
            io.to(sock).emit("chatPartnerOffline", {
              userId: user.userId,
              username: user.username,
              message: `${user.username} is now offline and can't receive messages. Returning to main menu.`,
            });
          }
        });
      });
    } catch (err) {
      console.error("socket error", err);
    }
  });

  app.get("/", (req, res) => res.send("DevChat server running"));

  server.listen(PORT, () => console.log("Server listening on", PORT));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

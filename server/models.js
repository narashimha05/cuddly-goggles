// models.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const UserSchema = new Schema({
  username: { type: String, required: true, unique: true },
  email: String,
  passwordHash: String,
  userId: { type: String, unique: true },
  friends: [{ type: Schema.Types.ObjectId, ref: "User" }],
  apiKeys: {
    type: Map,
    of: String,
    default: new Map(),
  }, // Stores encrypted API keys: { openai: "encrypted_key", anthropic: "encrypted_key" }
  gmailCredentials: {
    email: String,
    password: String, // Encrypted app password
  },
  createdAt: { type: Date, default: Date.now },
});

const FriendRequestSchema = new Schema({
  from: { type: Schema.Types.ObjectId, ref: "User" },
  to: { type: Schema.Types.ObjectId, ref: "User" },
  status: {
    type: String,
    enum: ["pending", "accepted", "declined"],
    default: "pending",
  },
  createdAt: { type: Date, default: Date.now },
});

const MessageSchema = new Schema({
  from: { type: Schema.Types.ObjectId, ref: "User" },
  to: { type: Schema.Types.ObjectId, ref: "User" },
  text: String,
  createdAt: { type: Date, default: Date.now },
});

const SharedFileSchema = new Schema({
  owner: { type: Schema.Types.ObjectId, ref: "User", required: true },
  filename: { type: String, required: true },
  mimeType: String,
  size: { type: Number, required: true }, // bytes
  content: { type: String, required: true }, // Base64 encoded

  // Sharing settings
  sharedWith: [{ type: Schema.Types.ObjectId, ref: "User" }],
  shareId: { type: String, unique: true },

  // Metadata
  description: String,
  downloads: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

const ReminderSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, required: true },
  notifyAt: { type: Date }, // Optional: when to notify
  notified: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

const MailSchema = new Schema({
  from: { type: Schema.Types.ObjectId, ref: "User", required: true },
  to: [{ type: Schema.Types.ObjectId, ref: "User", required: true }], // Multiple recipients
  cc: [{ type: Schema.Types.ObjectId, ref: "User" }], // Carbon copy
  bcc: [{ type: Schema.Types.ObjectId, ref: "User" }], // Blind carbon copy

  subject: { type: String, required: true },
  body: { type: String, required: true },

  // Thread management
  threadId: String, // For grouping related mails
  inReplyTo: { type: Schema.Types.ObjectId, ref: "Mail" }, // Reference to parent mail

  // Status flags
  priority: {
    type: String,
    enum: ["low", "normal", "high"],
    default: "normal",
  },

  // Recipient-specific status (map userId to status)
  readBy: [{ type: Schema.Types.ObjectId, ref: "User" }], // Users who read this mail
  starredBy: [{ type: Schema.Types.ObjectId, ref: "User" }], // Users who starred this
  archivedBy: [{ type: Schema.Types.ObjectId, ref: "User" }], // Users who archived this
  deletedBy: [{ type: Schema.Types.ObjectId, ref: "User" }], // Soft delete per user

  // Attachments (references to SharedFile)
  attachments: [{ type: Schema.Types.ObjectId, ref: "SharedFile" }],

  // Read receipt
  readReceiptRequested: { type: Boolean, default: false },

  createdAt: { type: Date, default: Date.now },
});

module.exports = {
  User: mongoose.model("User", UserSchema),
  FriendRequest: mongoose.model("FriendRequest", FriendRequestSchema),
  Message: mongoose.model("Message", MessageSchema),
  SharedFile: mongoose.model("SharedFile", SharedFileSchema),
  Reminder: mongoose.model("Reminder", ReminderSchema),
  Mail: mongoose.model("Mail", MailSchema),
};

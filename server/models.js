// models.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const UserSchema = new Schema({
  username: { type: String, required: true, unique: true },
  email: String,
  passwordHash: String,
  userId: { type: String, unique: true },
  friends: [{ type: Schema.Types.ObjectId, ref: "User" }],
  createdAt: { type: Date, default: Date.now }
});

const FriendRequestSchema = new Schema({
  from: { type: Schema.Types.ObjectId, ref: "User" },
  to: { type: Schema.Types.ObjectId, ref: "User" },
  status: { type: String, enum: ["pending","accepted","declined"], default: "pending" },
  createdAt: { type: Date, default: Date.now }
});

const MessageSchema = new Schema({
  from: { type: Schema.Types.ObjectId, ref: "User" },
  to: { type: Schema.Types.ObjectId, ref: "User" },
  text: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = {
  User: mongoose.model("User", UserSchema),
  FriendRequest: mongoose.model("FriendRequest", FriendRequestSchema),
  Message: mongoose.model("Message", MessageSchema)
};

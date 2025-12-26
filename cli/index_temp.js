#!/usr/bin/env node

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const {
  connectSocket,
  onChatMessage,
  sendChatMessage,
  onMessageRead,
  onChatPartnerOffline,
  onPresence,
  disconnectSocket,
} = require("./ws");
const readline = require("readline");
const API = "http://localhost:3000";
let token = "";
let currentUser = null;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(q) {
  return new Promise((res) => rl.question(q, res));
}

async function login() {
  if (token) {
    console.log("You are already logged in as", currentUser.username);
    return;
  }

  try {
    const username = await prompt("Username: ");
    const password = await prompt("Password: ");
    const res = await axios.post(API + "/login", { username, password });
    token = res.data.token;
    currentUser = res.data.user;
    console.log("Login successful! Your ID:", res.data.user.userId);
    connectSocket(token);
  } catch (e) {
    console.log("Login failed:", e.response?.data?.error || e.message);
  }
}

async function signup() {
  if (token) {
    console.log("You are already logged in as", currentUser.username);
    console.log(
      "Please logout first or use /deleteaccount to remove your account."
    );
    return;
  }

  try {
    const username = await prompt("Username: ");
    const email = await prompt("Email: ");
    const password = await prompt("Password: ");
    const confirmPassword = await prompt("Confirm Password: ");

    if (password !== confirmPassword) {
      console.log("Passwords do not match!");
      return;
    }

    const res = await axios.post(API + "/signup", {
      username,
      email,
      password,
    });
    token = res.data.token;
    currentUser = res.data.user;
    console.log("Signup successful! Your ID:", res.data.user.userId);
    connectSocket(token);
  } catch (e) {
    console.log("Signup failed:", e.response?.data?.error || e.message);
  }
}

let inboxMessages = []; // Store fetched inbox messages for /read and /reply
let inboxOffset = 0; // Track how many messages we've shown

// Theme Management System
const THEME_FILE = path.join(__dirname, 'theme.json');
let currentTheme = {};

// Load theme configuration
function loadTheme() {
  try {
    if (fs.existsSync(THEME_FILE)) {
      const config = JSON.parse(fs.readFileSync(THEME_FILE, 'utf8'));
      const themeName = config.currentTheme || 'default';
      currentTheme = config.themes[themeName] || config.themes.default;
      return config;
    }
  } catch (e) {
    console.log('Error loading theme:', e.message);
  }
  // Return default theme if file doesn't exist or error
  currentTheme = {
    username: '', timestamp: '', success: '', error: '', info: '',
    warning: '', border: '', prompt: '', highlight: '', reset: ''
  };
  return null;
}

// Save theme configuration
function saveTheme(config) {
  try {
    fs.writeFileSync(THEME_FILE, JSON.stringify(config, null, 2));
    return true;
  } catch (e) {
    console.log('Error saving theme:', e.message);
    return false;
  }
}

// Apply theme colors to text
function applyColor(text, colorType) {
  if (!currentTheme[colorType]) return text;
  return `${currentTheme[colorType]}${text}${currentTheme.reset}`;
}

// Initialize theme on startup
loadTheme();

// View pending friend requests
async function viewRequests() {
  try {
    const res = await axios.get(API + "/friend-requests", {
      headers: { Authorization: "Bearer " + token },
    });
    if (res.data.requests.length === 0) {
      console.log("\nNo pending friend requests.");
    } else {
      console.log(
        `\n📬 ${res.data.requests.length} pending friend request(s):\n`
      );
      res.data.requests.forEach((r, i) => {
        console.log(
          `  ${i + 1}. From: @${r.from.username} (ID: ${r.from.userId})`
        );
        console.log(`     Request ID: ${r._id}\n`);
      });
      console.log("Use /acceptrequest or /rejectrequest to respond");
    }
  } catch (e) {
    console.log(
      "Error fetching friend requests:",
      e.response?.data?.error || e.message
    );
  }
}

// Send a message to a friend
async function sendMessage() {
  const input = await prompt("Send to (username or userId): ");
  const message = await prompt("Message: ");

  if (!message.trim()) {
    console.log("Message cannot be empty.");
    return;
  }

  try {
    // First, find the user
    const friendsRes = await axios.get(API + "/friends", {
      headers: { Authorization: "Bearer " + token },
    });

    const friend = friendsRes.data.friends.find(
      (f) =>
        f.username.toLowerCase() === input.toLowerCase() || f.userId === input
    );

    if (!friend) {
      console.log(`\u274c User '${input}' not found in your friends list.`);
      return;
    }

    // Send via WebSocket
    sendChatMessage(friend.userId, message);
    console.log(`\u2713 Message dropped in @${friend.username}'s mailbox.`);
  } catch (e) {
    console.log("Error sending message:", e.response?.data?.error || e.message);
  }
}

// View inbox
async function inbox() {
  try {
    const res = await axios.get(API + "/messages/inbox", {
      headers: { Authorization: "Bearer " + token },
    });

    if (res.data.messages.length === 0) {
      console.log("\u{1F4EC} No new messages. Your inbox is empty.");
      return;
    }

    inboxMessages = res.data.messages;
    inboxOffset = 0; // Reset offset

    // Show first 7 messages
    const messagesToShow = inboxMessages.slice(0, 7);
    console.log(
      `\n\u{1F4EC} Showing ${messagesToShow.length} of ${inboxMessages.length} message(s):\n`
    );

    messagesToShow.forEach((m, i) => {
      const timeAgo = getTimeAgo(new Date(m.createdAt));
      const preview =
        m.text.length > 50 ? m.text.substring(0, 50) + "..." : m.text;
      const username = applyColor(`@${m.from.username}`, 'username');
      const timestamp = applyColor(`[${timeAgo}]`, 'timestamp');
      console.log(
        `  ${i + 1}. ${username} "${preview}" ${timestamp}`
      );
    });

    inboxOffset = 7;

    if (inboxMessages.length > 7) {
      console.log(
        `\n${
          inboxMessages.length - 7
        } older message(s). Use /more to load more.`
      );
    }
    console.log(`\nUse /read <number> to view a message`);
    console.log(`Use /clear-inbox <number|range|all> to delete messages`);
  } catch (e) {
    console.log("Error fetching inbox:", e.response?.data?.error || e.message);
  }
}

// Load more messages from inbox
async function loadMore() {
  if (inboxMessages.length === 0) {
    console.log("No messages loaded. Use /inbox first.");
    return;
  }

  if (inboxOffset >= inboxMessages.length) {
    console.log("No more messages to load.");
    return;
  }

  const messagesToShow = inboxMessages.slice(inboxOffset, inboxOffset + 7);
  console.log(
    `\n\u{1F4EC} Showing ${messagesToShow.length} more message(s):\n`
  );

  messagesToShow.forEach((m, i) => {
    const actualIndex = inboxOffset + i;
    const timeAgo = getTimeAgo(new Date(m.createdAt));
    const preview =
      m.text.length > 50 ? m.text.substring(0, 50) + "..." : m.text;
    const username = applyColor(`@${m.from.username}`, 'username');
    const timestamp = applyColor(`[${timeAgo}]`, 'timestamp');
    console.log(
      `  ${actualIndex + 1}. ${username} "${preview}" ${timestamp}`
    );
  });

  inboxOffset += 7;

  if (inboxOffset < inboxMessages.length) {
    console.log(
      `\n${
        inboxMessages.length - inboxOffset
      } older message(s). Use /more to load more.`
    );
  }
}

// Read a specific message
async function readMessage(msgNum) {
  let num;

  if (msgNum) {
    num = parseInt(msgNum);
  } else {
    const numStr = await prompt("Message number: ");
    num = parseInt(numStr);
  }

  if (isNaN(num) || num < 1 || num > inboxMessages.length) {
    console.log("Invalid message number. Use /inbox to see your messages.");
    return;
  }

  const msg = inboxMessages[num - 1];
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`From: @${msg.from.username} (${msg.from.userId})`);
  console.log(`Time: ${new Date(msg.createdAt).toLocaleString()}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`\n${msg.text}\n`);
  console.log(`Use /reply ${num} to respond\n`);
}

// Reply to a message
async function replyMessage(msgNum) {
  let num;

  if (msgNum) {
    num = parseInt(msgNum);
  } else {
    const input = await prompt("Reply to message number: ");
    num = parseInt(input);
  }

  if (isNaN(num) || num < 1 || num > inboxMessages.length) {
    console.log("Invalid message number. Use /inbox to see your messages.");
    return;
  }

  const message = await prompt("Your reply: ");

  if (!message.trim()) {
    console.log("Reply cannot be empty.");
    return;
  }

  const original = inboxMessages[num - 1];

  try {
    // Send via WebSocket
    sendChatMessage(original.from.userId, message);
    console.log(`\u2713 Reply sent to @${original.from.username}`);
  } catch (e) {
    console.log("Error sending reply:", e.response?.data?.error || e.message);
  }
}

// Helper function to calculate time ago
function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

// Clear inbox messages
async function clearInbox(rangeStr) {
  if (inboxMessages.length === 0) {
    console.log("No messages in inbox. Use /inbox first.");
    return;
  }

  let messageIds = [];
  let range;

  if (rangeStr) {
    range = rangeStr;
  } else {
    range = await prompt(
      "Enter message number(s) to clear (e.g., 1, 1-5, or 'all'): "
    );
  }

  if (range === "all") {
    const confirm = await prompt(
      "Clear ALL inbox messages? Type 'YES' to confirm: "
    );
    if (confirm !== "YES") {
      console.log("Cancelled.");
      return;
    }
    messageIds = "all";
  } else if (range.includes("-")) {
    // Range: e.g., 1-5 or 7-9
    const [start, end] = range.split("-").map((n) => parseInt(n.trim()));
    if (
      isNaN(start) ||
      isNaN(end) ||
      start < 1 ||
      end > inboxMessages.length ||
      start > end
    ) {
      console.log("Invalid range. Use format like 1-5.");
      return;
    }
    messageIds = inboxMessages.slice(start - 1, end).map((m) => m._id);
  } else {
    // Single number
    const num = parseInt(range);
    if (isNaN(num) || num < 1 || num > inboxMessages.length) {
      console.log("Invalid message number.");
      return;
    }
    messageIds = [inboxMessages[num - 1]._id];
  }

  try {
    const res = await axios.delete(API + "/messages/clear", {
      headers: { Authorization: "Bearer " + token },
      data: { messageIds },
    });
    console.log("\u2713", res.data.message);
    // Refresh inbox
    await inbox();
  } catch (e) {
    console.log(
      "Error clearing messages:",
      e.response?.data?.error || e.message
    );
  }
}

// Remove a friend
async function removeFriend(friendUserIdArg) {
  let friendUserId;

  if (friendUserIdArg) {
    friendUserId = friendUserIdArg;
  } else {
    // Show friends first
    try {
      const res = await axios.get(API + "/friends", {
        headers: { Authorization: "Bearer " + token },
      });
      if (res.data.friends.length === 0) {
        console.log("You have no friends to remove.");
        return;
      }
      console.log("\nYour Friends:");
      res.data.friends.forEach((f, i) =>
        console.log(`  ${i + 1}. ${f.username} (ID: ${f.userId})`)
      );
    } catch (e) {
      console.log(
        "Error fetching friends:",
        e.response?.data?.error || e.message
      );
      return;
    }

    friendUserId = await prompt("\nEnter friend ID to remove: ");
  }

  const confirm = await prompt(
    `Remove friend ${friendUserId}? Type 'YES' to confirm: `
  );
  if (confirm !== "YES") {
    console.log("Cancelled.");
    return;
  }

  try {
    const res = await axios.delete(API + "/friends/" + friendUserId, {
      headers: { Authorization: "Bearer " + token },
    });
    console.log("\u2713", res.data.message);
  } catch (e) {
    console.log("Error removing friend:", e.response?.data?.error || e.message);
  }
}

// View message history with a friend
async function history(friendUserIdArg) {
  let friendUserId;

  if (friendUserIdArg) {
    friendUserId = friendUserIdArg;
  } else {
    // Show friends first
    try {
      const res = await axios.get(API + "/friends", {
        headers: { Authorization: "Bearer " + token },
      });
      if (res.data.friends.length === 0) {
        console.log("You have no friends. Use /friendrequest to add friends.");
        return;
      }
      console.log("\nYour Friends:");
      res.data.friends.forEach((f, i) =>
        console.log(`  ${i + 1}. ${f.username} (ID: ${f.userId})`)
      );
    } catch (e) {
      console.log(
        "Error fetching friends:",
        e.response?.data?.error || e.message
      );
      return;
    }

    friendUserId = await prompt("\nEnter friend ID to view history: ");
  }

  try {
    const res = await axios.get(API + "/messages/" + friendUserId, {
      headers: { Authorization: "Bearer " + token },
    });

    const messages = res.data.messages;
    if (messages.length === 0) {
      console.log(`\nNo message history with user ${friendUserId}.`);
      return;
    }

    console.log(
      `\n\u{1F4DC} Message History with ${messages[0].username} (${friendUserId}):\n`
    );
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    messages.forEach((m) => {
      const time = new Date(m.createdAt).toLocaleString();
      const sender = m.from === "me" ? `You` : `${m.username}`;
      const colorType = m.from === "me" ? 'success' : 'username';
      const timestamp = applyColor(`[${time}]`, 'timestamp');
      const senderText = applyColor(sender, colorType);
      console.log(`${timestamp} ${senderText}: ${m.text}`);
    });

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  } catch (e) {
    console.log(
      "Error fetching history:",
      e.response?.data?.error || e.message
    );
  }
}

// Share a file with friends
async function shareFile(filePath, friendUserIdArg) {
  let filepath;

  if (filePath) {
    filepath = filePath;
  } else {
    filepath = await prompt("Enter file path to share: ");
  }

  // Check if file exists
  if (!fs.existsSync(filepath)) {
    console.log("❌ File not found:", filepath);
    return;
  }

  // Check if it's a directory
  const stats = fs.statSync(filepath);
  if (stats.isDirectory()) {
    console.log("❌ This is a folder. Use /share-folder to share folders.");
    return;
  }

  // Check file size
  const MAX_SIZE = 5 * 1024 * 1024; // 5MB
  if (stats.size > MAX_SIZE) {
    console.log(
      `❌ File too large: ${(stats.size / 1024 / 1024).toFixed(2)} MB`
    );
    console.log("   Maximum size is 5 MB");
    return;
  }

  // Read file and convert to Base64
  const content = fs.readFileSync(filepath, { encoding: "base64" });
  const filename = path.basename(filepath);
  const mimeType = getMimeType(filename);

  let sharedWith = [];

  if (friendUserIdArg) {
    sharedWith = [friendUserIdArg];
  } else {
    // Show friends list
    try {
      const res = await axios.get(API + "/friends", {
        headers: { Authorization: "Bearer " + token },
      });

      if (res.data.friends.length === 0) {
        console.log("You have no friends. Use /friendrequest to add friends.");
        return;
      }

      console.log("\nYour Friends:");
      res.data.friends.forEach((f, i) =>
        console.log(`  ${i + 1}. ${f.username} (ID: ${f.userId})`)
      );
    } catch (e) {
      console.log(
        "Error fetching friends:",
        e.response?.data?.error || e.message
      );
      return;
    }

    const friendIds = await prompt("\nEnter friend ID(s) (comma-separated): ");
    sharedWith = friendIds.split(",").map((id) => id.trim());
  }

  const description = await prompt("Description (optional): ");

  console.log(
    `\n📤 Uploading ${filename} (${(stats.size / 1024).toFixed(1)} KB)...`
  );

  try {
    const res = await axios.post(
      API + "/files/share",
      {
        filename,
        content,
        mimeType,
        size: stats.size,
        sharedWith,
        description,
      },
      { headers: { Authorization: "Bearer " + token } }
    );

    console.log("✅", res.data.message);
    console.log("📋 Share ID:", res.data.shareId);
  } catch (e) {
    console.log("Error sharing file:", e.response?.data?.error || e.message);
  }
}

// List files shared with me
async function listShares() {
  try {
    const res = await axios.get(API + "/files/shared-with-me", {
      headers: { Authorization: "Bearer " + token },
    });

    const files = res.data.files;

    if (files.length === 0) {
      console.log("\n📭 No files shared with you.");
      return;
    }

    console.log(`\n📥 Files Shared With You (${files.length}):\n`);

    files.forEach((f, i) => {
      const timeAgo = getTimeAgo(new Date(f.createdAt));
      const sizeKB = (f.size / 1024).toFixed(1);
      console.log(`${i + 1}. ${f.filename} (${sizeKB} KB)`);
      console.log(`   From: @${f.owner.username} (${f.owner.userId})`);
      console.log(`   Type: ${f.mimeType || "unknown"}`);
      if (f.description) console.log(`   Note: ${f.description}`);
      console.log(`   Downloads: ${f.downloads} • ${timeAgo}`);
      console.log(`   Share ID: ${f.shareId}`);
      console.log("");
    });

    console.log("Use /download <shareId> to download a file\n");
  } catch (e) {
    console.log("Error fetching shares:", e.response?.data?.error || e.message);
  }
}

// List my shared files
async function myShares() {
  try {
    const res = await axios.get(API + "/files/my-shares", {
      headers: { Authorization: "Bearer " + token },
    });

    const files = res.data.files;

    if (files.length === 0) {
      console.log("\n📭 You haven't shared any files.");
      return;
    }

    console.log(`\n📤 Your Shared Files (${files.length}):\n`);

    files.forEach((f, i) => {
      const timeAgo = getTimeAgo(new Date(f.createdAt));
      const sizeKB = (f.size / 1024).toFixed(1);
      console.log(`${i + 1}. ${f.filename} (${sizeKB} KB)`);
      console.log(
        `   Shared with: ${f.sharedWith
          .map((u) => `@${u.username}`)
          .join(", ")}`
      );
      console.log(`   Downloads: ${f.downloads} • ${timeAgo}`);
      console.log(`   Share ID: ${f.shareId}`);
      console.log("");
    });

    console.log("Use /unshare <shareId> to delete a shared file\n");
  } catch (e) {
    console.log("Error fetching shares:", e.response?.data?.error || e.message);
  }
}

// Download a file
async function downloadFile(shareIdArg) {
  let shareId;

  if (shareIdArg) {
    shareId = shareIdArg;
  } else {
    shareId = await prompt("Enter Share ID: ");
  }

  try {
    console.log(`\n📥 Downloading ${shareId}...`);

    const res = await axios.get(API + `/files/download/${shareId}`, {
      headers: { Authorization: "Bearer " + token },
    });

    const { filename, content, size } = res.data;

    // Create downloads directory if it doesn't exist
    const downloadsDir = path.join(process.cwd(), "downloads");
    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir);
    }

    // Save file
    const filePath = path.join(downloadsDir, filename);
    const buffer = Buffer.from(content, "base64");
    fs.writeFileSync(filePath, buffer);

    console.log(`✅ Downloaded to: ${filePath}`);
    console.log(`   Size: ${(size / 1024).toFixed(1)} KB`);
  } catch (e) {
    console.log(
      "Error downloading file:",
      e.response?.data?.error || e.message
    );
  }
}

// Delete a shared file
async function unshareFile(shareIdArg) {
  let shareId;

  if (shareIdArg) {
    shareId = shareIdArg;
  } else {
    shareId = await prompt("Enter Share ID to delete: ");
  }

  const confirm = await prompt(
    `Delete share ${shareId}? Type 'YES' to confirm: `
  );
  if (confirm !== "YES") {
    console.log("Cancelled.");
    return;
  }

  try {
    const res = await axios.delete(API + `/files/${shareId}`, {
      headers: { Authorization: "Bearer " + token },
    });
    console.log("✅", res.data.message);
  } catch (e) {
    console.log("Error deleting share:", e.response?.data?.error || e.message);
  }
}

// Helper: Get MIME type from filename
function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    ".txt": "text/plain",
    ".js": "text/javascript",
    ".json": "application/json",
    ".html": "text/html",
    ".css": "text/css",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".xml": "text/xml",
    ".csv": "text/csv",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

// Store a reminder
async function remember(textInput) {
  let text;

  if (textInput) {
    // Remove quotes if present
    text = textInput.replace(/^"|"$/g, "").trim();
  } else {
    text = await prompt("What do you want to remember? ");
  }

  if (!text || !text.trim()) {
    console.log("Reminder text cannot be empty.");
    return;
  }

  try {
    const res = await axios.post(
      API + "/reminders",
      { text: text.trim() },
      { headers: { Authorization: "Bearer " + token } }
    );
    console.log("✅", res.data.message);
  } catch (e) {
    console.log("Error saving reminder:", e.response?.data?.error || e.message);
  }
}

// View and delete reminders
async function recall() {
  try {
    // Get reminders
    const res = await axios.get(API + "/reminders", {
      headers: { Authorization: "Bearer " + token },
    });

    const reminders = res.data.reminders;

    if (reminders.length === 0) {
      console.log("\n📭 No reminders stored.");
      return;
    }

    console.log(`\n📝 Your Reminders (${reminders.length}):\n`);

    reminders.forEach((r, i) => {
      const timeAgo = getTimeAgo(new Date(r.createdAt));
      console.log(`${i + 1}. ${r.text}`);
      console.log(`   Created: ${timeAgo}\n`);
    });

    // Ask to delete specific reminder
    const input = await prompt(
      "Delete reminder number (or 'all' for all, Enter to skip): "
    );

    if (!input.trim()) {
      console.log("No reminders deleted.");
      return;
    }

    if (input.toLowerCase() === "all") {
      const confirm = await prompt("Delete ALL reminders? Type 'YES': ");
      if (confirm !== "YES") {
        console.log("Cancelled.");
        return;
      }
      const deleteRes = await axios.delete(API + "/reminders", {
        headers: { Authorization: "Bearer " + token },
      });
      console.log("✅", deleteRes.data.message);
    } else {
      const num = parseInt(input);
      if (isNaN(num) || num < 1 || num > reminders.length) {
        console.log("Invalid reminder number.");
        return;
      }

      const reminderId = reminders[num - 1]._id;
      await axios.delete(API + `/reminders/${reminderId}`, {
        headers: { Authorization: "Bearer " + token },
      });
      console.log(`✅ Deleted reminder: ${reminders[num - 1].text}`);
    }
  } catch (e) {
    console.log("Error with reminders:", e.response?.data?.error || e.message);
  }
}

// ============================================
// MAIL SYSTEM FUNCTIONS
// ============================================

let mailInbox = []; // Store fetched mails

async function handleMail(args) {
  const subcommand = args[0];

  if (subcommand === "send") {
    await sendMail();
  } else if (subcommand === "inbox") {
    await viewMailInbox();
  } else if (subcommand === "sent") {
    await viewSentMail();
  } else if (subcommand === "read") {
    await readMail(args[1]);
  } else if (subcommand === "reply") {
    await replyMail(args[1]);
  } else if (subcommand === "forward") {
    await forwardMail(args[1]);
  } else if (subcommand === "star") {
    await starMail(args[1]);
  } else if (subcommand === "delete") {
    await deleteMail(args[1]);
  } else {
    console.log("\n📧 Mail Commands:");
    console.log("  /mail send     - Send a new mail");
    console.log("  /mail inbox    - View inbox");
    console.log("  /mail sent     - View sent mail");
    console.log("  /mail read <#> - Read mail");
    console.log("  /mail reply <#>- Reply to mail");
    console.log("  /mail forward <#> - Forward mail");
    console.log("  /mail star <#> - Star/unstar mail");
    console.log("  /mail delete <#> - Delete mail");
  }
}

async function sendMail() {
  console.log("\n📧 ══════════════════════════════════════");
  console.log("       COMPOSE NEW MAIL");
  console.log("══════════════════════════════════════\n");

  const to = await prompt("To (username@devchat.com, comma-separated): ");
  if (!to.trim()) {
    console.log("❌ Recipient required.");
    return;
  }

  const cc = await prompt("CC (optional, comma-separated): ");
  const subject = await prompt("Subject: ");
  if (!subject.trim()) {
    console.log("❌ Subject required.");
    return;
  }

  const priority = await prompt(
    "Priority (low/normal/high, default: normal): "
  );
  console.log("\nBody (type your message, then press Enter twice):");

  let body = "";
  let emptyCount = 0;
  while (emptyCount < 1) {
    const line = await prompt("");
    if (line === "") {
      emptyCount++;
    } else {
      emptyCount = 0;
      body += line + "\n";
    }
  }

  if (!body.trim()) {
    console.log("❌ Body cannot be empty.");
    return;
  }

  const readReceipt = await prompt("Request read receipt? (y/n): ");

  console.log("\n📤 Sending mail...");

  try {
    const payload = {
      to: to.split(",").map((t) => t.trim()),
      subject: subject.trim(),
      body: body.trim(),
      priority: priority.trim() || "normal",
      readReceipt: readReceipt.toLowerCase() === "y",
    };

    if (cc.trim()) {
      payload.cc = cc.split(",").map((c) => c.trim());
    }

    const res = await axios.post(API + "/mail/send", payload, {
      headers: { Authorization: "Bearer " + token },
    });

    console.log("✅", res.data.message);
    console.log("📬 Mail ID:", res.data.mailId);
  } catch (e) {
    console.log("❌ Error:", e.response?.data?.error || e.message);
  }
}

async function viewMailInbox() {
  try {
    const res = await axios.get(API + "/mail/inbox", {
      headers: { Authorization: "Bearer " + token },
    });

    mailInbox = res.data.mails;

    if (mailInbox.length === 0) {
      console.log("\n📭 No mail in inbox.");
      return;
    }

    console.log("\n📬 ══════════════════════════════════════");
    console.log(`       MAIL INBOX (${mailInbox.length})`);
    console.log("══════════════════════════════════════\n");

    mailInbox.forEach((m, i) => {
      const readFlag = m.isRead ? "  " : "🔵";
      const starFlag = m.isStarred ? "⭐" : "  ";
      const priorityFlag =
        m.priority === "high" ? "🔴" : m.priority === "low" ? "🟢" : "  ";
      const attachFlag = m.hasAttachments ? "📎" : "  ";
      const timeAgo = getTimeAgo(new Date(m.createdAt));

      console.log(
        `${i + 1}. ${readFlag}${starFlag}${priorityFlag}${attachFlag} From: ${
          m.from.username
        }@devchat.com`
      );
      console.log(`   Subject: ${m.subject}`);
      if (m.cc && m.cc.length > 0) {
        console.log(`   CC: ${m.cc.map((u) => u.username).join(", ")}`);
      }
      console.log(`   ${timeAgo}\n`);
    });

    console.log("Use /mail read <number> to read a mail");
  } catch (e) {
    console.log("❌ Error:", e.response?.data?.error || e.message);
  }
}

async function viewSentMail() {
  try {
    const res = await axios.get(API + "/mail/sent", {
      headers: { Authorization: "Bearer " + token },
    });

    const mails = res.data.mails;

    if (mails.length === 0) {
      console.log("\n📭 No sent mail.");
      return;
    }

    console.log("\n📤 ══════════════════════════════════════");
    console.log(`       SENT MAIL (${mails.length})`);
    console.log("══════════════════════════════════════\n");

    mails.forEach((m, i) => {
      const priorityFlag =
        m.priority === "high" ? "🔴" : m.priority === "low" ? "🟢" : "  ";
      const attachFlag = m.hasAttachments ? "📎" : "  ";
      const timeAgo = getTimeAgo(new Date(m.createdAt));

      console.log(
        `${i + 1}. ${priorityFlag}${attachFlag} To: ${m.to
          .map((u) => u.username)
          .join(", ")}@devchat.com`
      );
      console.log(`   Subject: ${m.subject}`);
      if (m.cc && m.cc.length > 0) {
        console.log(`   CC: ${m.cc.map((u) => u.username).join(", ")}`);
      }
      console.log(`   ${timeAgo}\n`);
    });
  } catch (e) {
    console.log("❌ Error:", e.response?.data?.error || e.message);
  }
}

async function readMail(mailNum) {
  let num;

  if (mailNum) {
    num = parseInt(mailNum);
  } else {
    num = parseInt(await prompt("Mail number: "));
  }

  if (isNaN(num) || num < 1 || num > mailInbox.length) {
    console.log("❌ Invalid mail number. Use /mail inbox first.");
    return;
  }

  try {
    const mailId = mailInbox[num - 1]._id;
    const res = await axios.get(API + `/mail/${mailId}`, {
      headers: { Authorization: "Bearer " + token },
    });

    const m = res.data.mail;

    console.log("\n📧 ══════════════════════════════════════");
    console.log(`From: ${m.from.username}@devchat.com`);
    console.log(`To: ${m.to.map((u) => u.username).join(", ")}@devchat.com`);
    if (m.cc && m.cc.length > 0) {
      console.log(`CC: ${m.cc.map((u) => u.username).join(", ")}@devchat.com`);
    }
    console.log(`Subject: ${m.subject}`);
    console.log(`Priority: ${m.priority}`);
    console.log(`Date: ${new Date(m.createdAt).toLocaleString()}`);
    console.log("══════════════════════════════════════\n");
    console.log(m.body);
    console.log("\n══════════════════════════════════════");
    if (m.attachments && m.attachments.length > 0) {
      console.log(`\n📎 Attachments: ${m.attachments.length}`);
    }
    console.log(`\nUse /mail reply ${num} or /mail forward ${num}`);
  } catch (e) {
    console.log("❌ Error:", e.response?.data?.error || e.message);
  }
}

async function replyMail(mailNum) {
  let num;

  if (mailNum) {
    num = parseInt(mailNum);
  } else {
    num = parseInt(await prompt("Reply to mail number: "));
  }

  if (isNaN(num) || num < 1 || num > mailInbox.length) {
    console.log("❌ Invalid mail number.");
    return;
  }

  const replyAll =
    (await prompt("Reply to all? (y/n): ")).toLowerCase() === "y";

  console.log("\nYour reply (press Enter twice to finish):");
  let body = "";
  let emptyCount = 0;
  while (emptyCount < 1) {
    const line = await prompt("");
    if (line === "") {
      emptyCount++;
    } else {
      emptyCount = 0;
      body += line + "\n";
    }
  }

  if (!body.trim()) {
    console.log("❌ Reply cannot be empty.");
    return;
  }

  try {
    const mailId = mailInbox[num - 1]._id;
    const res = await axios.post(
      API + `/mail/${mailId}/reply`,
      {
        body: body.trim(),
        replyAll,
      },
      {
        headers: { Authorization: "Bearer " + token },
      }
    );

    console.log("✅", res.data.message);
  } catch (e) {
    console.log("❌ Error:", e.response?.data?.error || e.message);
  }
}

async function forwardMail(mailNum) {
  let num;

  if (mailNum) {
    num = parseInt(mailNum);
  } else {
    num = parseInt(await prompt("Forward mail number: "));
  }

  if (isNaN(num) || num < 1 || num > mailInbox.length) {
    console.log("❌ Invalid mail number.");
    return;
  }

  const to = await prompt(
    "Forward to (username@devchat.com, comma-separated): "
  );
  if (!to.trim()) {
    console.log("❌ Recipient required.");
    return;
  }

  const cc = await prompt("CC (optional): ");
  const note = await prompt("Add a note (optional): ");

  try {
    const mailId = mailInbox[num - 1]._id;
    const payload = {
      to: to.split(",").map((t) => t.trim()),
      body: note.trim(),
    };

    if (cc.trim()) {
      payload.cc = cc.split(",").map((c) => c.trim());
    }

    const res = await axios.post(API + `/mail/${mailId}/forward`, payload, {
      headers: { Authorization: "Bearer " + token },
    });

    console.log("✅", res.data.message);
  } catch (e) {
    console.log("❌ Error:", e.response?.data?.error || e.message);
  }
}

async function starMail(mailNum) {
  let num;

  if (mailNum) {
    num = parseInt(mailNum);
  } else {
    num = parseInt(await prompt("Star mail number: "));
  }

  if (isNaN(num) || num < 1 || num > mailInbox.length) {
    console.log("❌ Invalid mail number.");
    return;
  }

  try {
    const mailId = mailInbox[num - 1]._id;
    const res = await axios.post(
      API + `/mail/${mailId}/star`,
      {},
      {
        headers: { Authorization: "Bearer " + token },
      }
    );

    console.log(res.data.starred ? "⭐ Starred" : "✅ Unstarred");
  } catch (e) {
    console.log("❌ Error:", e.response?.data?.error || e.message);
  }
}

async function deleteMail(mailNum) {
  let num;

  if (mailNum) {
    num = parseInt(mailNum);
  } else {
    num = parseInt(await prompt("Delete mail number: "));
  }

  if (isNaN(num) || num < 1 || num > mailInbox.length) {
    console.log("❌ Invalid mail number.");
    return;
  }

  const confirm = await prompt("Delete this mail? (y/n): ");
  if (confirm.toLowerCase() !== "y") {
    console.log("Cancelled.");
    return;
  }

  try {
    const mailId = mailInbox[num - 1]._id;
    const res = await axios.delete(API + `/mail/${mailId}`, {
      headers: { Authorization: "Bearer " + token },
    });

    console.log("✅", res.data.message);
    // Refresh inbox
    await viewMailInbox();
  } catch (e) {
    console.log("❌ Error:", e.response?.data?.error || e.message);
  }
}

// ============================================
// END MAIL SYSTEM FUNCTIONS
// ============================================

// ============================================
// GMAIL INTEGRATION FUNCTIONS
// ============================================

async function handleGmail(args) {
  const subcommand = args[0];

  if (subcommand === "setup") {
    await setupGmail();
  } else if (subcommand === "send") {
    await sendGmail();
  } else if (subcommand === "status") {
    await gmailStatus();
  } else if (subcommand === "remove") {
    await removeGmail();
  } else {
    console.log("\n📧 Gmail Commands:");
    console.log("  /gmail setup   - Configure Gmail credentials");
    console.log("  /gmail send    - Send email via Gmail");
    console.log("  /gmail status  - Check setup status");
    console.log("  /gmail remove  - Remove credentials");
    console.log(
      "\nNote: You need a Gmail App Password (not your regular password)"
    );
    console.log("Get one at: https://myaccount.google.com/apppasswords");
  }
}

async function setupGmail() {
  console.log("\n📧 ══════════════════════════════════════");
  console.log("       GMAIL SETUP");
  console.log("══════════════════════════════════════");
  console.log(
    "\n⚠️  IMPORTANT: Use a Gmail App Password, not your regular password!"
  );
  console.log("Generate one at: https://myaccount.google.com/apppasswords\n");

  const email = await prompt("Gmail address: ");
  if (!email.trim()) {
    console.log("❌ Email required.");
    return;
  }

  const password = await prompt("Gmail App Password: ");
  if (!password.trim()) {
    console.log("❌ Password required.");
    return;
  }

  try {
    const res = await axios.post(
      API + "/gmail/setup",
      {
        email: email.trim(),
        password: password.trim(),
      },
      {
        headers: { Authorization: "Bearer " + token },
      }
    );

    console.log("✅", res.data.message);
    console.log("\n✨ You can now use /gmail send to send emails!");
  } catch (e) {
    console.log("❌ Error:", e.response?.data?.error || e.message);
  }
}

async function sendGmail() {
  console.log("\n📧 ══════════════════════════════════════");
  console.log("       SEND EMAIL VIA GMAIL");
  console.log("══════════════════════════════════════\n");

  // Check if Gmail is configured
  try {
    const statusRes = await axios.get(API + "/gmail/status", {
      headers: { Authorization: "Bearer " + token },
    });

    if (!statusRes.data.configured) {
      console.log("❌ Gmail not configured. Use /gmail setup first.");
      return;
    }

    console.log(`📬 Sending from: ${statusRes.data.email}\n`);
  } catch (e) {
    console.log(
      "❌ Error checking status:",
      e.response?.data?.error || e.message
    );
    return;
  }

  const to = await prompt("To (email address, comma-separated): ");
  if (!to.trim()) {
    console.log("❌ Recipient required.");
    return;
  }

  const cc = await prompt("CC (optional, comma-separated): ");
  const subject = await prompt("Subject: ");
  if (!subject.trim()) {
    console.log("❌ Subject required.");
    return;
  }

  console.log("\nBody (type your message, then press Enter twice):");

  let body = "";
  let emptyCount = 0;
  while (emptyCount < 1) {
    const line = await prompt("");
    if (line === "") {
      emptyCount++;
    } else {
      emptyCount = 0;
      body += line + "\n";
    }
  }

  if (!body.trim()) {
    console.log("❌ Body cannot be empty.");
    return;
  }

  console.log("\n📤 Sending email via Gmail...");

  try {
    const payload = {
      to: to.split(",").map((t) => t.trim()),
      subject: subject.trim(),
      body: body.trim(),
    };

    if (cc.trim()) {
      payload.cc = cc.split(",").map((c) => c.trim());
    }

    const res = await axios.post(API + "/gmail/send", payload, {
      headers: { Authorization: "Bearer " + token },
    });

    console.log("✅", res.data.message);
  } catch (e) {
    console.log("❌ Error:", e.response?.data?.error || e.message);
    if (e.response?.status === 401) {
      console.log("\n💡 Tip: Make sure you're using a Gmail App Password");
      console.log("   Get one at: https://myaccount.google.com/apppasswords");
    }
  }
}

async function gmailStatus() {
  try {
    const res = await axios.get(API + "/gmail/status", {
      headers: { Authorization: "Bearer " + token },
    });

    console.log("\n📧 Gmail Status:");
    if (res.data.configured) {
      console.log("✅ Configured");
      console.log(`📬 Email: ${res.data.email}`);
    } else {
      console.log("❌ Not configured");
      console.log("Use /gmail setup to configure");
    }
  } catch (e) {
    console.log("❌ Error:", e.response?.data?.error || e.message);
  }
}

async function removeGmail() {
  const confirm = await prompt("Remove Gmail credentials? (y/n): ");
  if (confirm.toLowerCase() !== "y") {
    console.log("Cancelled.");
    return;
  }

  try {
    const res = await axios.delete(API + "/gmail/setup", {
      headers: { Authorization: "Bearer " + token },
    });

    console.log("✅", res.data.message);
  } catch (e) {
    console.log("❌ Error:", e.response?.data?.error || e.message);
  }
}

// ============================================
// END GMAIL INTEGRATION FUNCTIONS
// ============================================

// ============================================
// ============================================

  const subcommand = args[0];

  if (!subcommand || subcommand === "help") {
    return;
  }

  switch (subcommand) {
    case "setup":
      break;
    case "create":
      break;
    case "today":
      await listTodayEvents();
      break;
    case "week":
      await listWeekEvents();
      break;
    case "list":
      break;
    case "view":
      break;
    case "update":
      break;
    case "delete":
      break;
    case "sync":
      break;
    case "status":
      break;
    case "settings":
      break;
    case "remove":
      break;
    default:
  }
}

  console.log("2. OAuth 2.0 credentials (Client ID and Secret)");
  console.log("3. A refresh token from OAuth flow\n");

  console.log("📖 Quick Setup Guide:");
  console.log("1. Go to: https://console.cloud.google.com/");
  console.log("2. Create/select a project");
  console.log("4. Create OAuth 2.0 credentials (Desktop app)");
  console.log("5. Copy your Client ID and Client Secret");
  console.log("6. Use OAuth playground to get refresh token:");
  console.log("   https://developers.google.com/oauthplayground/");
  console.log("   - Click settings, use your own OAuth credentials");
  console.log("   - Exchange auth code for tokens\n");

  console.log("💡 All credentials are encrypted and stored securely in your account.\n");

  const clientId = await prompt("Google OAuth Client ID: ");
  const clientSecret = await prompt("Google OAuth Client Secret: ");
  const refreshToken = await prompt("OAuth Refresh Token: ");

  if (!clientId.trim() || !clientSecret.trim() || !email.trim() || !refreshToken.trim()) {
    console.log("Setup cancelled - all fields required.");
    return;
  }


  try {
    const res = await axios.post(
      { 
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        email: email.trim(),
        refreshToken: refreshToken.trim()
      },
      { headers: { Authorization: "Bearer " + token } }
    );

    console.log("✅", res.data.message);
    console.log("💡 All credentials are stored encrypted in your account.");
  } catch (e) {
    console.log("❌ Error:", e.response?.data?.error || e.message);
  }
}


  const title = await prompt("Event title: ");
  if (!title.trim()) {
    console.log("Title is required.");
    return;
  }

  const description = await prompt("Description (optional): ");
  const location = await prompt("Location (optional): ");

  // Date and time prompts
  console.log("\n📅 Event Date & Time");
  console.log("Enter date in format: YYYY-MM-DD (e.g., 2025-12-31)");
  const dateStr = await prompt("Date: ");

  console.log("\nEnter time in 24-hour format: HH:MM (e.g., 14:30)");
  const startTimeStr = await prompt("Start time: ");

  let durationInput = await prompt("Duration in minutes (default: 60): ");
  const duration = durationInput.trim() ? parseInt(durationInput) : 60;

  // Parse date and time
  const [year, month, day] = dateStr.split("-").map(Number);
  const [startHour, startMin] = startTimeStr.split(":").map(Number);

  const startTime = new Date(year, month - 1, day, startHour, startMin);
  const endTime = new Date(startTime.getTime() + duration * 60 * 1000);

  // Validate dates
  if (isNaN(startTime.getTime())) {
    console.log("❌ Invalid date or time format.");
    return;
  }

  // Timezone
  const timezoneInput = await prompt(
    "Timezone (default: UTC, e.g., America/New_York): "
  );
  const timezone = timezoneInput.trim() || "UTC";

  // All-day event
  const allDayInput = await prompt("All-day event? (y/n, default: n): ");
  const allDay = allDayInput.toLowerCase() === "y";

  // Reminders
  console.log("\n⏰ Reminders");
  const reminderInput = await prompt(
    "Reminder before event in minutes (default: 15): "
  );
  const reminderMinutes = reminderInput.trim()
    ? parseInt(reminderInput)
    : 15;

  const reminders = [{ method: "popup", minutes: reminderMinutes }];

  // Recurring
  const recurringInput = await prompt("Recurring event? (y/n, default: n): ");
  const recurring = recurringInput.toLowerCase() === "y";
  let recurrenceRule = "";

  if (recurring) {
    console.log("\n🔁 Recurrence Options:");
    console.log("1. Daily");
    console.log("2. Weekly");
    console.log("3. Monthly");
    console.log("4. Custom RRULE");
    const recurChoice = await prompt("Choose (1-4): ");

    switch (recurChoice) {
      case "1":
        recurrenceRule = "RRULE:FREQ=DAILY";
        break;
      case "2":
        recurrenceRule = "RRULE:FREQ=WEEKLY";
        break;
      case "3":
        recurrenceRule = "RRULE:FREQ=MONTHLY";
        break;
      case "4":
        recurrenceRule = await prompt("Enter RRULE: ");
        break;
      default:
        console.log("Invalid choice, skipping recurrence.");
        recurring = false;
    }
  }

  // Attendees (invite friends)
  const inviteInput = await prompt(
    "Invite DevChat friends? (y/n, default: n): "
  );
  const attendees = [];

  if (inviteInput.toLowerCase() === "y") {
    try {
      const friendsRes = await axios.get(API + "/friends", {
        headers: { Authorization: "Bearer " + token },
      });

      if (friendsRes.data.friends.length === 0) {
        console.log("You have no friends to invite.");
      } else {
        console.log("\nYour Friends:");
        friendsRes.data.friends.forEach((f, i) =>
          console.log(`  ${i + 1}. ${f.username} (${f.email || "no email"})`)
        );

        const friendIds = await prompt(
          "Enter friend numbers to invite (comma-separated): "
        );
        const indices = friendIds
          .split(",")
          .map((n) => parseInt(n.trim()) - 1);

        indices.forEach((idx) => {
          if (idx >= 0 && idx < friendsRes.data.friends.length) {
            const friend = friendsRes.data.friends[idx];
            attendees.push({
              userId: friend._id,
              email: friend.email,
            });
          }
        });

        console.log(`✓ ${attendees.length} friend(s) invited.`);
      }
    } catch (e) {
      console.log("Error fetching friends:", e.message);
    }
  }


  try {
    const payload = {
      title: title.trim(),
      description: description.trim(),
      location: location.trim(),
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      timezone,
      allDay,
      reminders,
      recurring,
      recurrenceRule,
      attendees,
    };

      headers: { Authorization: "Bearer " + token },
    });

    console.log("✅", res.data.message);

    if (res.data.googleEventLink) {
    }

    console.log("\n📋 Event Details:");
    console.log(`  Title: ${title}`);
    console.log(`  Start: ${startTime.toLocaleString()}`);
    console.log(`  End: ${endTime.toLocaleString()}`);
    console.log(`  Duration: ${duration} minutes`);
    if (location.trim()) console.log(`  Location: ${location}`);
    if (recurring) console.log(`  Recurring: ${recurrenceRule}`);
    if (attendees.length > 0)
      console.log(`  Attendees: ${attendees.length} invited`);
  } catch (e) {
    console.log("❌ Error:", e.response?.data?.error || e.message);
  }
}

async function listTodayEvents() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

      headers: { Authorization: "Bearer " + token },
      params: {
        from: today.toISOString(),
        to: tomorrow.toISOString(),
      },
    });

    const events = res.data.events;

    if (events.length === 0) {
      console.log("\n📅 No events scheduled for today.");
      return;
    }

    console.log(`\n📅 Today's Events (${events.length}):\n`);

    events.forEach((e, i) => {
      const start = new Date(e.startTime);
      const end = new Date(e.endTime);
      const time = e.allDay
        ? "All day"
        : `${start.toLocaleTimeString()} - ${end.toLocaleTimeString()}`;

      console.log(`${i + 1}. ${e.title}`);
      console.log(`   Time: ${time}`);
      if (e.location) console.log(`   Location: ${e.location}`);
      if (e.description) console.log(`   Note: ${e.description}`);
      console.log(`   ID: ${e._id}`);
      console.log();
    });
  } catch (e) {
    console.log("❌ Error:", e.response?.data?.error || e.message);
  }
}

async function listWeekEvents() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);

      headers: { Authorization: "Bearer " + token },
      params: {
        from: today.toISOString(),
        to: nextWeek.toISOString(),
      },
    });

    const events = res.data.events;

    if (events.length === 0) {
      console.log("\n📅 No events scheduled for this week.");
      return;
    }

    console.log(`\n📅 This Week's Events (${events.length}):\n`);

    events.forEach((e, i) => {
      const start = new Date(e.startTime);
      const end = new Date(e.endTime);
      const dateStr = start.toLocaleDateString();
      const time = e.allDay
        ? "All day"
        : `${start.toLocaleTimeString()} - ${end.toLocaleTimeString()}`;

      console.log(`${i + 1}. ${e.title} - ${dateStr}`);
      console.log(`   Time: ${time}`);
      if (e.location) console.log(`   Location: ${e.location}`);
      console.log(`   ID: ${e._id}\n`);
    });
  } catch (e) {
    console.log("❌ Error:", e.response?.data?.error || e.message);
  }
}

  try {
    const limitInput = await prompt("How many events to show? (default: 20): ");
    const limit = limitInput.trim() ? parseInt(limitInput) : 20;

      headers: { Authorization: "Bearer " + token },
      params: { limit },
    });

    const events = res.data.events;

    if (events.length === 0) {
      console.log("\n📅 No upcoming events.");
      return;
    }

    console.log(`\n📅 Upcoming Events (${events.length}):\n`);

    events.forEach((e, i) => {
      const start = new Date(e.startTime);
      const dateStr = start.toLocaleDateString();
      const timeStr = start.toLocaleTimeString();

      console.log(`${i + 1}. ${e.title}`);
      console.log(`   When: ${dateStr} at ${timeStr}`);
      if (e.location) console.log(`   Where: ${e.location}`);
      if (e.syncedToGoogle) console.log("   ✓ Synced to Google");
      console.log(`   ID: ${e._id}\n`);
    });

  } catch (e) {
    console.log("❌ Error:", e.response?.data?.error || e.message);
  }
}

  if (!eventId) {
    eventId = await prompt("Enter event ID: ");
  }

  try {
      headers: { Authorization: "Bearer " + token },
    });

    const e = res.data.event;
    const start = new Date(e.startTime);
    const end = new Date(e.endTime);

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📅 EVENT DETAILS");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`\nTitle: ${e.title}`);
    console.log(`Start: ${start.toLocaleString()}`);
    console.log(`End: ${end.toLocaleString()}`);
    console.log(`Duration: ${Math.round((end - start) / 60000)} minutes`);
    if (e.description) console.log(`Description: ${e.description}`);
    if (e.location) console.log(`Location: ${e.location}`);
    console.log(`Timezone: ${e.timezone}`);
    console.log(`All-day: ${e.allDay ? "Yes" : "No"}`);

    if (e.recurring) {
      console.log(`Recurring: Yes`);
      console.log(`Rule: ${e.recurrenceRule}`);
    }

    if (e.attendees && e.attendees.length > 0) {
      console.log(`\nAttendees (${e.attendees.length}):`);
      e.attendees.forEach((a) => {
        const user = a.userId;
        console.log(
          `  - ${user?.username || a.email} (${a.status || "pending"})`
        );
      });
    }

    if (e.reminders && e.reminders.length > 0) {
      console.log(`\nReminders:`);
      e.reminders.forEach((r) => {
        console.log(`  - ${r.method}: ${r.minutes} minutes before`);
      });
    }

    console.log(`\nStatus: ${e.status}`);
    console.log(
      `Synced to Google: ${e.syncedToGoogle ? "Yes" : "No"}`
    );
    console.log(`Created: ${new Date(e.createdAt).toLocaleString()}`);
    console.log(`\nEvent ID: ${e._id}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━\n");
  } catch (e) {
    console.log("❌ Error:", e.response?.data?.error || e.message);
  }
}

  if (!eventId) {
    eventId = await prompt("Enter event ID to update: ");
  }

  try {
    // First fetch the event
      headers: { Authorization: "Bearer " + token },
    });

    const event = eventRes.data.event;

    console.log("\n=== UPDATE EVENT ===");
    console.log(`Current: ${event.title}\n`);
    console.log("Leave blank to keep current value\n");

    const title = await prompt(`New title (${event.title}): `);
    const description = await prompt(
      `New description (${event.description || "none"}): `
    );
    const location = await prompt(
      `New location (${event.location || "none"}): `
    );

    const updates = {};
    if (title.trim()) updates.title = title.trim();
    if (description.trim()) updates.description = description.trim();
    if (location.trim()) updates.location = location.trim();

    if (Object.keys(updates).length === 0) {
      console.log("No changes made.");
      return;
    }

    const res = await axios.put(
      updates,
      { headers: { Authorization: "Bearer " + token } }
    );

    console.log("✅", res.data.message);
  } catch (e) {
    console.log("❌ Error:", e.response?.data?.error || e.message);
  }
}

  if (!eventId) {
    eventId = await prompt("Enter event ID to delete: ");
  }

  const confirm = await prompt(
    "Delete this event? Type 'YES' to confirm: "
  );
  if (confirm !== "YES") {
    console.log("Cancelled.");
    return;
  }

  try {
      headers: { Authorization: "Bearer " + token },
    });

    console.log("✅", res.data.message);
  } catch (e) {
    console.log("❌ Error:", e.response?.data?.error || e.message);
  }
}


  if (!reminderId) {
    // Show reminders first
    try {
      const res = await axios.get(API + "/reminders", {
        headers: { Authorization: "Bearer " + token },
      });

      if (res.data.reminders.length === 0) {
        console.log("You have no reminders to sync.");
        return;
      }

      console.log("Your Reminders:");
      res.data.reminders.forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.text}`);
        console.log(`     ID: ${r._id}\n`);
      });

      reminderId = await prompt("Enter reminder ID to sync: ");
    } catch (e) {
      console.log("Error fetching reminders:", e.message);
      return;
    }
  }

  // Get event details for the reminder
  console.log("\n📅 Event Details for Reminder\n");

  console.log("Enter date in format: YYYY-MM-DD (e.g., 2025-12-31)");
  const dateStr = await prompt("Date: ");

  console.log("\nEnter time in 24-hour format: HH:MM (e.g., 14:30)");
  const timeStr = await prompt("Start time: ");

  const durationInput = await prompt("Duration in minutes (default: 60): ");
  const duration = durationInput.trim() ? parseInt(durationInput) : 60;

  const location = await prompt("Location (optional): ");
  const description = await prompt("Additional description (optional): ");

  // Parse date and time
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, min] = timeStr.split(":").map(Number);
  const startTime = new Date(year, month - 1, day, hour, min);

  if (isNaN(startTime.getTime())) {
    console.log("❌ Invalid date or time format.");
    return;
  }


  try {
    const payload = {
      startTime: startTime.toISOString(),
      duration,
      location: location.trim(),
      description: description.trim(),
    };

    const res = await axios.post(
      payload,
      { headers: { Authorization: "Bearer " + token } }
    );

    console.log("✅", res.data.message);

    if (res.data.googleEventLink) {
    }
  } catch (e) {
    console.log("❌ Error:", e.response?.data?.error || e.message);
  }
}

  try {
      headers: { Authorization: "Bearer " + token },
    });

    if (res.data.configured) {
      if (res.data.incomplete) {
        console.log("⚠️  Partially configured (missing OAuth credentials)");
        console.log(`📧 Account: ${res.data.email}`);
        console.log(`🔄 Auto-sync: ${res.data.autoSync ? "Enabled" : "Disabled"}`);
        console.log("\n❌ Google sync will fail!");
        console.log("   1. Client ID");
        console.log("   2. Client Secret");
        console.log("   3. Email");
        console.log("   4. Refresh Token");
      } else {
        console.log("✅ Fully connected");
        console.log(`📧 Account: ${res.data.email}`);
        console.log(`🔄 Auto-sync: ${res.data.autoSync ? "Enabled" : "Disabled"}`);
      }
    } else {
      console.log("❌ Not configured");
    }
  } catch (e) {
    console.log("❌ Error:", e.response?.data?.error || e.message);
  }
}


  const autoSyncInput = await prompt(
  );
  const autoSync = autoSyncInput.toLowerCase() === "y";

  const durationInput = await prompt(
    "Default event duration in minutes (default: 60): "
  );
  const defaultDuration = durationInput.trim()
    ? parseInt(durationInput)
    : 60;

  const reminderInput = await prompt(
    "Default reminder before event in minutes (default: 15): "
  );
  const defaultReminder = reminderInput.trim()
    ? parseInt(reminderInput)
    : 15;

  try {
    const res = await axios.post(
      { autoSync, defaultDuration, defaultReminder },
      { headers: { Authorization: "Bearer " + token } }
    );

    console.log("✅", res.data.message);
  } catch (e) {
    console.log("❌ Error:", e.response?.data?.error || e.message);
  }
}

  const confirm = await prompt(
  );
  if (confirm.toLowerCase() !== "y") {
    console.log("Cancelled.");
    return;
  }

  try {
      headers: { Authorization: "Bearer " + token },
    });

    console.log("✅", res.data.message);
  } catch (e) {
    console.log("❌ Error:", e.response?.data?.error || e.message);
  }
}

// ============================================
// ============================================

// ============================================
// THEME CUSTOMIZATION FUNCTIONS
// ============================================

async function handleTheme(args) {
  const subcommand = args[0];

  if (!subcommand || subcommand === "help") {
    console.log("\n=== THEME COMMANDS ===");
    console.log("  /theme list      - List all available themes");
    console.log("  /theme current   - Show current theme");
    console.log("  /theme switch    - Switch to a different theme");
    console.log("  /theme preview   - Preview a theme");
    console.log("  /theme custom    - Customize theme colors");
    console.log("  /theme reset     - Reset to default (no colors)");
    console.log("  /theme info      - Learn about theme customization");
    return;
  }

  switch (subcommand) {
    case "list":
      await listThemes();
      break;
    case "current":
      await showCurrentTheme();
      break;
    case "switch":
      await switchTheme();
      break;
    case "preview":
      await previewTheme(args[1]);
      break;
    case "custom":
      await customizeTheme();
      break;
    case "reset":
      await resetTheme();
      break;
    case "info":
      showThemeInfo();
      break;
    default:
      console.log("Unknown theme command. Use /theme help for options.");
  }
}

async function listThemes() {
  const config = loadTheme();
  if (!config) {
    console.log("Error loading themes.");
    return;
  }

  console.log("\n=== AVAILABLE THEMES ===\n");
  Object.keys(config.themes).forEach((key) => {
    const theme = config.themes[key];
    const current = key === config.currentTheme ? " ← Current" : "";
    console.log(`  ${key.padEnd(10)} - ${theme.name}${current}`);
  });
  console.log("\nUse /theme switch to change themes");
  console.log("Use /theme preview <name> to preview a theme");
}

async function showCurrentTheme() {
  const config = loadTheme();
  if (!config) {
    console.log("Error loading theme.");
    return;
  }

  const themeName = config.currentTheme;
  const theme = config.themes[themeName];

  console.log("\n=== CURRENT THEME ===");
  console.log(`Name: ${theme.name}`);
  console.log(`ID: ${themeName}\n`);

  if (themeName === "default") {
    console.log("This theme has no colors (plain text).");
  } else {
    console.log("Color Preview:");
    console.log(`  Username: ${applyColor("@johndoe", "username")}`);
    console.log(`  Timestamp: ${applyColor("[2 minutes ago]", "timestamp")}`);
    console.log(`  Success: ${applyColor("✓ Operation successful", "success")}`);
    console.log(`  Error: ${applyColor("✗ Operation failed", "error")}`);
    console.log(`  Info: ${applyColor("ℹ Information message", "info")}`);
    console.log(`  Warning: ${applyColor("⚠ Warning message", "warning")}`);
    console.log(`  Border: ${applyColor("━━━━━━━━━━━━━━━", "border")}`);
    console.log(`  Prompt: ${applyColor("> Enter command", "prompt")}`);
    console.log(`  Highlight: ${applyColor("Important text", "highlight")}`);
  }
}

async function switchTheme() {
  const config = loadTheme();
  if (!config) {
    console.log("Error loading themes.");
    return;
  }

  console.log("\nAvailable themes:");
  Object.keys(config.themes).forEach((key, i) => {
    console.log(`  ${i + 1}. ${key} - ${config.themes[key].name}`);
  });

  const choice = await prompt("\nEnter theme name or number: ");
  let themeName;

  // Check if it's a number
  const num = parseInt(choice);
  if (!isNaN(num)) {
    const keys = Object.keys(config.themes);
    if (num >= 1 && num <= keys.length) {
      themeName = keys[num - 1];
    }
  } else {
    themeName = choice.toLowerCase();
  }

  if (!config.themes[themeName]) {
    console.log("Invalid theme. Use /theme list to see available themes.");
    return;
  }

  config.currentTheme = themeName;
  if (saveTheme(config)) {
    loadTheme(); // Reload to apply
    console.log(`✓ Theme switched to: ${config.themes[themeName].name}`);
    console.log("Restart the CLI to see full effects.");
  }
}

async function previewTheme(themeName) {
  if (!themeName) {
    themeName = await prompt("Enter theme name to preview: ");
  }

  const config = loadTheme();
  if (!config || !config.themes[themeName.toLowerCase()]) {
    console.log("Theme not found. Use /theme list to see available themes.");
    return;
  }

  const theme = config.themes[themeName.toLowerCase()];
  console.log(`\n=== PREVIEW: ${theme.name} ===\n`);

  if (themeName.toLowerCase() === "default") {
    console.log("This theme has no colors (plain text).");
    console.log("\nExample output:");
    console.log("  Username: @johndoe");
    console.log("  Timestamp: [2 minutes ago]");
    console.log("  Success: ✓ Operation successful");
  } else {
    // Temporarily apply this theme for preview
    const savedTheme = { ...currentTheme };
    Object.assign(currentTheme, theme);

    console.log("Example output:");
    console.log(`  Username: ${applyColor("@johndoe", "username")}`);
    console.log(`  Timestamp: ${applyColor("[2 minutes ago]", "timestamp")}`);
    console.log(`  Success: ${applyColor("✓ Operation successful", "success")}`);
    console.log(`  Error: ${applyColor("✗ Operation failed", "error")}`);
    console.log(`  Info: ${applyColor("ℹ Information message", "info")}`);
    console.log(`  Warning: ${applyColor("⚠ Warning message", "warning")}`);
    console.log(`  Border: ${applyColor("━━━━━━━━━━━━━━━", "border")}`);

    // Restore original theme
    Object.assign(currentTheme, savedTheme);
  }

  console.log("\nUse /theme switch to apply this theme");
}

async function customizeTheme() {
  console.log("\n=== CUSTOMIZE THEME ===");
  console.log("Create your own color scheme using ANSI color codes.\n");

  console.log("Common ANSI codes:");
  console.log("  \\x1b[30m - Black       \\x1b[90m - Bright Black (Gray)");
  console.log("  \\x1b[31m - Red         \\x1b[91m - Bright Red");
  console.log("  \\x1b[32m - Green       \\x1b[92m - Bright Green");
  console.log("  \\x1b[33m - Yellow      \\x1b[93m - Bright Yellow");
  console.log("  \\x1b[34m - Blue        \\x1b[94m - Bright Blue");
  console.log("  \\x1b[35m - Magenta     \\x1b[95m - Bright Magenta");
  console.log("  \\x1b[36m - Cyan        \\x1b[96m - Bright Cyan");
  console.log("  \\x1b[37m - White       \\x1b[97m - Bright White");
  console.log("  \\x1b[1m  - Bold        \\x1b[0m  - Reset");
  console.log("\nLeave empty to skip (keep current value)\n");

  const config = loadTheme();
  if (!config) {
    console.log("Error loading theme configuration.");
    return;
  }

  const custom = { ...config.themes.custom };

  const fields = [
    "username",
    "timestamp",
    "success",
    "error",
    "info",
    "warning",
    "border",
    "prompt",
    "highlight",
  ];

  for (const field of fields) {
    const value = await prompt(`${field} color (current: "${custom[field] || "none"}"): `);
    if (value.trim()) {
      custom[field] = value.replace(/\\x1b/g, "\x1b");
    }
  }

  custom.reset = "\x1b[0m";
  config.themes.custom = custom;
  config.currentTheme = "custom";

  if (saveTheme(config)) {
    loadTheme();
    console.log("\n✓ Custom theme saved and activated!");
    console.log("Restart the CLI to see full effects.");
  }
}

async function resetTheme() {
  const config = loadTheme();
  if (!config) {
    console.log("Error loading theme configuration.");
    return;
  }

  config.currentTheme = "default";
  if (saveTheme(config)) {
    loadTheme();
    console.log("✓ Theme reset to default (no colors)");
    console.log("Restart the CLI to see full effects.");
  }
}

function showThemeInfo() {
  console.log("\n=== THEME CUSTOMIZATION INFO ===\n");
  console.log("WHERE:");
  console.log("  • Themes are stored in: cli/theme.json");
  console.log("  • Applied throughout: inbox, messages, history, mail, etc.\n");

  console.log("WHAT:");
  console.log("  • username   - Color for usernames (@johndoe)");
  console.log("  • timestamp  - Color for timestamps ([2 min ago])");
  console.log("  • success    - Color for success messages");
  console.log("  • error      - Color for error messages");
  console.log("  • info       - Color for informational messages");
  console.log("  • warning    - Color for warnings");
  console.log("  • border     - Color for borders and separators");
  console.log("  • prompt     - Color for prompts and questions");
  console.log("  • highlight  - Color for highlighted/important text\n");

  console.log("HOW:");
  console.log("  1. Use /theme list to see all themes");
  console.log("  2. Use /theme preview <name> to test a theme");
  console.log("  3. Use /theme switch to activate a theme");
  console.log("  4. Use /theme custom to create your own colors");
  console.log("  5. Restart CLI to see full theme effects\n");

  console.log("PROCESS:");
  console.log("  1. Theme loaded from theme.json on startup");
  console.log("  2. applyColor() function wraps text with ANSI codes");
  console.log("  3. Colors applied to username, timestamps, messages");
  console.log("  4. Changes persist across sessions\n");

  console.log("PRESET THEMES:");
  console.log("  • default - No colors (plain text)");
  console.log("  • dark    - Dark theme with bright colors");
  console.log("  • light   - Light theme with softer colors");
  console.log("  • ocean   - Blue/cyan ocean-inspired");
  console.log("  • forest  - Green nature-inspired");
  console.log("  • sunset  - Purple/magenta sunset colors");
  console.log("  • custom  - Your personalized theme\n");
}

// ============================================
// END THEME CUSTOMIZATION FUNCTIONS
// ============================================

// Note: Chat request/acceptance flow removed - mailbox style messaging

function requireAuth() {
  if (!token) {
    console.log("\u26a0\ufe0f  Please login or signup first!");
    return false;
  }
  return true;
}

function showHelp() {
  console.log("\n=== DEVCHAT MENU ===");
  console.log("\n[Account]");
  console.log("  /signup         - Create a new account");
  console.log("  /login          - Login to your account");
  console.log("  /getid          - View your user ID");
  console.log("  /deleteaccount  - Permanently delete your account");
  console.log("\n[Friends]");
  console.log("  /friendrequest  - Send a friend request");
  console.log("  /requests       - View pending friend requests");
  console.log("  /acceptrequest  - Accept a pending friend request");
  console.log("  /rejectrequest  - Reject a friend request");
  console.log("  /showfriends    - View all your friends");
  console.log("  /removefriend   - Remove a friend from your list");
  console.log("  /online         - See which friends are online");
  console.log("\n[Messages]");
  console.log("  /send           - Send a message to a friend");
  console.log("  /inbox          - View your inbox (first 7 messages)");
  console.log("  /more           - Load 7 more past messages");
  console.log("  /read           - Read a specific message");
  console.log("  /reply          - Reply to a message");
  console.log("  /clear-inbox    - Clear inbox messages (single/range/all)");
  console.log("  /history        - View message history with a friend");
  console.log("\n[Files]");
  console.log("  /share          - Share a file with friends");
  console.log("  /shares         - List files shared with you");
  console.log("  /myshares       - List files you've shared");
  console.log("  /download       - Download a shared file");
  console.log("  /unshare        - Delete a shared file");
  console.log("\n[Reminders]");
  console.log('  /remember       - Store a reminder (e.g., /remember "task")');
  console.log("  /recall         - View and delete reminders");
  console.log("\n[Mail System]");
  console.log(
    "  /mail send      - Send professional email (username@devchat.com)"
  );
  console.log("  /mail inbox     - View mail inbox");
  console.log("  /mail sent      - View sent mail");
  console.log("  /mail read      - Read a specific mail");
  console.log("  /mail reply     - Reply to mail");
  console.log("  /mail forward   - Forward mail to others");
  console.log("  /mail star      - Star/unstar mail");
  console.log("  /mail delete    - Delete mail");
  console.log("\n[Gmail Integration]");
  console.log("  /gmail setup    - Configure Gmail credentials");
  console.log("  /gmail send     - Send email via your Gmail");
  console.log("  /gmail status   - Check Gmail setup status");
  console.log("  /gmail remove   - Remove Gmail credentials");
  console.log("\n[Theme Customization]");
  console.log("  /theme list     - List all available themes");
  console.log("  /theme switch   - Switch to a different theme");
  console.log("  /theme preview  - Preview a theme");
  console.log("  /theme custom   - Create custom theme colors");
  console.log("  /theme reset    - Reset to default (no colors)");
  console.log("  /theme info     - Learn about customization");
  console.log("\n[Other]");
  console.log("  /help           - Show this help menu");
  console.log("  /cls            - Clear the screen");
  console.log("  exit            - Exit DevChat");
}

async function main() {
  console.log("\n╔════════════════════════════════════════════╗");
  console.log("║          Welcome to DevChat! 💬            ║");
  console.log("╚════════════════════════════════════════════╝");
  console.log("\nReal-time developer chat from your terminal.");
  console.log("Connect with friends, send messages, and collaborate!");
  console.log("\nType '/help' to see available commands.\n");

  while (true) {
    const cmd = await prompt("\n> ");
    const [command, ...args] = cmd.split(" ");

    if (command === "/help") {
      showHelp();
    } else if (command === "/signup") await signup();
    else if (command === "/login") await login();
    else if (command === "/getid") {
      if (requireAuth()) await getid();
    } else if (command === "/showfriends") {
      if (requireAuth()) await showfriends();
    } else if (command === "/online") {
      if (requireAuth()) await online();
    } else if (command === "/friendrequest") {
      if (requireAuth()) await friendrequest();
    } else if (command === "/requests") {
      if (requireAuth()) await viewRequests();
    } else if (command === "/acceptrequest") {
      if (requireAuth()) await acceptrequest();
    } else if (command === "/rejectrequest") {
      if (requireAuth()) await rejectrequest();
    } else if (command === "/send") {
      if (requireAuth()) await sendMessage();
    } else if (command === "/inbox") {
      if (requireAuth()) await inbox();
    } else if (command === "/more") {
      if (requireAuth()) await loadMore();
    } else if (command === "/read") {
      if (requireAuth()) await readMessage(args[0]);
    } else if (command === "/reply") {
      if (requireAuth()) await replyMessage(args[0]);
    } else if (command === "/clear-inbox") {
      if (requireAuth()) await clearInbox(args[0]);
    } else if (command === "/removefriend") {
      if (requireAuth()) await removeFriend(args[0]);
    } else if (command === "/history") {
      if (requireAuth()) await history(args[0]);
    } else if (command === "/share") {
      if (requireAuth()) await shareFile(args[0], args[1]);
    } else if (command === "/shares") {
      if (requireAuth()) await listShares();
    } else if (command === "/myshares") {
      if (requireAuth()) await myShares();
    } else if (command === "/download") {
      if (requireAuth()) await downloadFile(args[0]);
    } else if (command === "/unshare") {
      if (requireAuth()) await unshareFile(args[0]);
    } else if (command === "/remember") {
      if (requireAuth()) await remember(args.join(" "));
    } else if (command === "/recall") {
      if (requireAuth()) await recall();
    } else if (command === "/mail") {
      if (requireAuth()) await handleMail(args);
    } else if (command === "/gmail") {
      if (requireAuth()) await handleGmail(args);
    } else if (command === "/theme") {
      await handleTheme(args);
    } else if (command === "/cls") {
      // Clear screen for all platforms
      process.stdout.write("\x1Bc");
      // Also try console.clear as fallback
      console.clear();
    } else if (command === "/deleteaccount") {
      if (requireAuth()) await deleteaccount();
    } else if (command === "exit") {
      disconnectSocket();
      break;
    } else console.log("Unknown command. Type '/help' for available commands.");
  }
  rl.close();
  process.exit(0);
}

main();

async function getid() {
  const res = await axios.get(API + "/me", {
    headers: { Authorization: "Bearer " + token },
  });
  console.log("Your ID is:", res.data.userId);
}

async function showfriends() {
  const res = await axios.get(API + "/friends", {
    headers: { Authorization: "Bearer " + token },
  });
  console.log("Friends:");
  res.data.friends.forEach((f, i) =>
    console.log(`${i + 1}. ${f.username} (ID: ${f.userId})`)
  );
}

async function acceptrequest() {
  const requestId = await prompt("Enter Request ID to accept: ");
  try {
    const res = await axios.post(
      API + "/friend-request/accept",
      { requestId },
      { headers: { Authorization: "Bearer " + token } }
    );
    if (res.data.success) console.log("Friend request accepted.");
    else console.log("Error:", res.data.error);
  } catch (e) {
    console.log(
      "Error accepting request:",
      e.response?.data?.error || e.message
    );
  }
}

async function online() {
  const res = await axios.get(API + "/friends/online", {
    headers: { Authorization: "Bearer " + token },
  });
  console.log("Online Friends:");
  res.data.online.forEach((f, i) =>
    console.log(`${i + 1}. ${f.username} (${f.userId})`)
  );
}

async function friendrequest() {
  const id = await prompt("Enter friend ID: ");
  const res = await axios.post(
    API + "/friend-request",
    { targetUserId: id },
    { headers: { Authorization: "Bearer " + token } }
  );
  if (res.data.success) console.log("Friend Request Sent to", id);
  else console.log("Error:", res.data.error);
}

async function rejectrequest() {
  const requestId = await prompt("Enter Request ID to reject: ");
  try {
    const res = await axios.post(
      API + "/friend-request/reject",
      { requestId },
      { headers: { Authorization: "Bearer " + token } }
    );
    if (res.data.success) console.log("Friend request rejected.");
    else console.log("Error:", res.data.error);
  } catch (e) {
    console.log(
      "Error rejecting request:",
      e.response?.data?.error || e.message
    );
  }
}

async function deleteaccount() {
  console.log("⚠️  WARNING: This will permanently delete your account!");
  console.log("All your friends, messages, and data will be lost.");
  const confirm = await prompt("Type 'DELETE' to confirm account deletion: ");

  if (confirm !== "DELETE") {
    console.log("Account deletion cancelled.");
    return;
  }

  try {
    const res = await axios.delete(API + "/user/delete", {
      headers: { Authorization: "Bearer " + token },
    });
    if (res.data.success) {
      console.log("Account deleted successfully. Goodbye!");
      token = "";
      process.exit(0);
    } else {
      console.log("Error:", res.data.error);
    }
  } catch (e) {
    console.log(
      "Error deleting account:",
      e.response?.data?.error || e.message
    );
  }
}

const axios = require("axios");
const {
  connectSocket,
  onChatMessage,
  onChatRequest,
  sendChatMessage,
  onMessageRead,
} = require("./ws");
const readline = require("readline");
const API = "http://localhost:3000";
let token = "";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(q) {
  return new Promise((res) => rl.question(q, res));
}

async function login() {
  const username = await prompt("Username: ");
  const password = await prompt("Password: ");
  const res = await axios.post(API + "/login", { username, password });
  token = res.data.token;
  console.log("Login successful! Your ID:", res.data.user.userId);
  connectSocket(token);
}

async function signup() {
  const username = await prompt("Username: ");
  const email = await prompt("Email: ");
  const password = await prompt("Password: ");
  const res = await axios.post(API + "/signup", { username, email, password });
  token = res.data.token;
  console.log("Signup successful! Your ID:", res.data.user.userId);
  connectSocket(token);
}

async function notification() {
  try {
    const res = await axios.get(API + "/friend-requests", {
      headers: { Authorization: "Bearer " + token },
    });
    if (res.data.requests.length === 0) {
      console.log("No pending friend requests.");
    } else {
      console.log("Pending Friend Requests:");
      res.data.requests.forEach((r, i) => {
        console.log(
          `${i + 1}. From: ${r.from.username} (ID: ${
            r.from.userId
          }) | Request ID: ${r._id}`
        );
      });
    }
  } catch (e) {
    console.log(
      "Error fetching notifications:",
      e.response?.data?.error || e.message
    );
  }
}

let sentMessages = {};

async function chat() {
  const friendId = await prompt("Enter friend user ID to chat: ");
  // Send chat request
  const tokenHeader = { headers: { Authorization: "Bearer " + token } };
  try {
    const res = await axios.post(
      API + "/chat/request",
      { targetUserId: friendId },
      tokenHeader
    );
    if (res.data.success) {
      console.log("Chat request sent. Waiting for acceptance...");
      // Start chat session
      await chatSession(friendId);
    } else {
      console.log("Error sending chat request:", res.data.error);
    }
  } catch (e) {
    console.log(
      "Error sending chat request:",
      e.response?.data?.error || e.message
    );
  }
}

async function chatSession(friendId) {
  console.log("Type your message and press Enter. Type /end to exit chat.");
  let chatting = true;
  onChatMessage((m) => {
    if (m.from.userId === friendId) {
      const time = new Date(m.createdAt).toLocaleTimeString();
      console.log(`[${time}] ${m.from.username}: ${m.text}`);
    }
  });
  onMessageRead((data) => {
    if (data.by && data.by.userId === friendId) {
      const lastMsg = Object.keys(sentMessages).pop();
      if (lastMsg) sentMessages[lastMsg] = "read";
      console.log("(✓✓) Message read");
    }
  });
  while (chatting) {
    const msg = await prompt("");
    if (msg === "/end") {
      chatting = false;
      console.log("Chat ended.");
      break;
    }
    sendChatMessage(friendId, msg);
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] you: ${msg} (✓)`);
  }
}

// Listen for incoming chat requests
onChatRequest(async (data) => {
  console.log(
    `\n${data.from.username} (ID: ${data.from.userId}) wants to chat with you.`
  );
  const answer = await prompt("Accept? (yes/no): ");
  if (answer.toLowerCase() === "yes") {
    console.log(
      "Chat started. Type your message and press Enter. Type /end to exit chat."
    );
    await chatSession(data.from.userId);
  } else {
    console.log("Chat declined.");
  }
});

async function main() {
  while (true) {
    const cmd = await prompt(
      "\nCommand (/signup, /login, /getid, /showfriends, /online, /friendrequest, /notification, /acceptrequest, /rejectrequest, /chat, /unread, exit): "
    );
    if (cmd === "/signup") await signup();
    else if (cmd === "/login") await login();
    else if (cmd === "/getid") await getid();
    else if (cmd === "/showfriends") await showfriends();
    else if (cmd === "/online") await online();
    else if (cmd === "/friendrequest") await friendrequest();
    else if (cmd === "/notification") await notification();
    else if (cmd === "/acceptrequest") await acceptrequest();
    else if (cmd === "/rejectrequest") await rejectrequest();
    else if (cmd === "/chat") await chat();
    else if (cmd === "/unread") await unread();
    else if (cmd === "exit") break;
    else console.log("Unknown command");
  }
  rl.close();
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
    console.log("Error accepting request:", e.response?.data?.error || e.message);
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

async function unread() {
  try {
    const res = await axios.get(API + "/messages/unread", {
      headers: { Authorization: "Bearer " + token },
    });
    if (!res.data.messages || res.data.messages.length === 0) {
      console.log("No unread messages.");
    } else {
      console.log("Unread Messages:");
      res.data.messages.forEach((m, i) => {
        const time = new Date(m.createdAt).toLocaleTimeString();
        console.log(`${i + 1}. [${time}] From: ${m.from} - ${m.text}`);
      });
    }
  } catch (e) {
    console.log(
      "Error fetching unread messages:",
      e.response?.data?.error || e.message
    );
  }
}

# DevChat CLI

Real-time developer chat from your terminal. Chat with friends while coding!

## Installation

Install globally to use from anywhere:

```bash
npm install -g devchat-cli
```

## Usage

Just type `devchat` from any directory:

```bash
devchat
```

## Features

- 🚀 Real-time messaging
- 👥 Friend system
- 💬 Accept/reject chat requests
- 🔔 Disconnect notifications
- 🔒 Secure authentication
- 🌍 Works from any directory

## Commands

Once you run `devchat`, you'll see:

```
1. signup
2. login
3. chat
4. add-friend
5. view-friends
6. view-requests
7. logout
8. delete-account
9. exit
```

## Quick Start

```bash
# Install globally
npm install -g devchat-cli

# Run from anywhere
devchat

# Sign up or login
> signup

# Add friends
> add-friend

# Start chatting
> chat
```

## Configuration

Server URL defaults to `http://3.7.127.58:3000`.

To use a different server, set environment variable:

```bash
export DEVCHAT_SERVER=https://your-server.com
devchat
```

## Development

```bash
git clone https://github.com/narashimha05/cuddly-goggles
cd cuddly-goggles/cli
npm install
npm link  # Test globally
```

## License

MIT

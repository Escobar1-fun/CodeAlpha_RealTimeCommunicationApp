# Roundtable

Real-time video meetings with screen sharing, a collaborative whiteboard, chat and file sharing.

| Part | Technology |
| --- | --- |
| Media | WebRTC mesh using native `RTCPeerConnection`, `getUserMedia`, `getDisplayMedia` |
| Signaling and sync | Socket.io over WSS |
| Frontend | React, Vite, HTML5 Canvas |
| Backend | Node.js, Express, HTTPS/TLS, JWT, bcrypt, Zod |

## Quick start

Requires **Node.js 20.19 or newer**.

```bash
npm install       # installs the root, server and client workspaces
npm run setup     # creates certs/ and server/.env (safe to re-run)
npm run dev       # starts the backend and the frontend
```

Open **https://localhost:5173**, register, and create a meeting. To try a call on one computer, open the invite link in a second browser profile or a private window, and sign up as a different user.

If `mkcert` isn't installed, `npm run setup` creates a self-signed certificate and your browser shows a warning once. Choose Advanced, then Proceed, or follow the next section to get a trusted certificate.

To run the two halves separately, use one terminal each:

```bash
npm run dev:server   # signaling and API on https://localhost:4000
npm run dev:client   # frontend on https://localhost:5173
```

## Local HTTPS certificates

Browsers only expose the camera, microphone and screen capture in a [secure context](https://developer.mozilla.org/docs/Web/Security/Secure_Contexts). `http://localhost` counts as secure, but `http://192.168.x.x` does not, so joining from a phone or another computer needs HTTPS. This project uses HTTPS everywhere, which also matches production and gives you WSS for sockets.

The server and Vite both read `certs/localhost.pem` and `certs/localhost-key.pem`. There are three ways to create them.

**Option 1: mkcert (recommended, no browser warnings)**

Install [mkcert](https://github.com/FiloSottile/mkcert), then trust its local certificate authority once:

```bash
# Windows:  winget install FiloSottile.mkcert   (or: choco install mkcert)
# macOS:    brew install mkcert
# Linux:    see the mkcert README
mkcert -install
```

Then generate the certificate. If `certs/` already exists, delete it first, because setup keeps existing files.

```bash
npm run setup
```

**Option 2: built-in self-signed certificate**

Run `npm run setup` without mkcert installed. It needs no other tools, and the browser warns once per origin.

**Option 3: OpenSSL**

```bash
mkdir certs
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout certs/localhost-key.pem -out certs/localhost.pem \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

### Joining from another device on your network

1. Run `npm run setup` while connected to that network, so that your LAN IP is included in the certificate. If your IP has changed, delete `certs/` and run it again.
2. Allow Node.js through your firewall on port 5173.
3. On the other device, open `https://<your-LAN-IP>:5173`. Accept the certificate warning, or install the mkcert root certificate on that device.

## Mobile app

`mobile/` is a React Native app built with Expo. It uses the same backend and meeting protocol as the web client, so phones and browsers can share a meeting.

| Where it runs | What works |
| --- | --- |
| Expo Go | Accounts, meetings, chat, whiteboard, files. No audio or video, because Expo Go doesn't include WebRTC's native code |
| Development build (`npx expo run:android`) | The above, plus audio and video calls and screen sharing |

Android phones can start and receive screen shares. On iPhone a build can receive them, but starting one would need a separate broadcast extension, so the button is hidden there.

### Run it over USB

Plug in an Android phone with USB debugging on, then, from the repository root:

```bash
npm run setup                    # if you haven't already
cd mobile && npm install && cp .env.example .env && cd ..
npm run dev:mobile:go            # for Expo Go
```

Open `exp://127.0.0.1:8081` in Expo Go on the phone.

For calls, install the development build once. It needs JDK 17 or newer and the Android SDK, and your computer's clock must be correct or its downloads will fail certificate checks:

```bash
cd mobile
npx expo run:android
cd ..
npm run dev:mobile               # for the development build
```

React Native can't trust a self-signed certificate, so in this setup the backend uses plain HTTP and `adb reverse` keeps that traffic on the USB cable. For anything beyond USB, set `EXPO_PUBLIC_API_URL` in `mobile/.env` to an HTTPS address with a real certificate and rebuild.

## TURN server

Video can't connect directly between many networks, and mobile data is the usual case. A TURN server relays the media when that happens. Without one, those users can join and use chat, the whiteboard and files, but not hear or see anyone.

Either of these works:

- **A hosted TURN service.** Set `TURN_URLS`, `TURN_USERNAME` and `TURN_CREDENTIAL` in `server/.env`.
- **Your own coturn server** on a machine with a public IP address. Start from [deploy/turnserver.conf.example](deploy/turnserver.conf.example), then set `TURN_URLS` and `TURN_SECRET`. With a shared secret, each user only receives a credential that expires after 24 hours.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev:mobile` / `npm run dev:mobile:go` | Backend, web client and Expo, for a phone on USB |
| `npm run setup` | Create the certificate and `server/.env` |
| `npm run dev` | Run backend and frontend with reload |
| `npm test` | Run the backend integration tests |
| `npm run build` | Build the client into `client/dist` |
| `npm start` | Run the server, which also serves `client/dist` |

## Configuration

Settings live in `server/.env`. [server/.env.example](server/.env.example) documents every option, including:

- `JWT_SECRET`: required, at least 32 characters. Setup generates it.
- `MAX_ROOM_PARTICIPANTS`: defaults to 8.
- `MAX_UPLOAD_MB`: defaults to 25.
- `ROOM_RETENTION_MINUTES`: how long chat, whiteboard and files last after the room empties.
- `STUN_URLS`, `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL`: ICE servers.

## Project layout

```text
scripts/setup.mjs        Certificate and .env generation
server/
  src/index.js           HTTPS bootstrap
  src/app.js             Express app: auth, rooms, file routes, security headers
  src/socket.js          Socket auth, validation, rate limits, event handlers
  src/roomManager.js     Live meeting state
  src/validation.js      Zod schemas and text sanitization
  src/fileVault.js       AES-256-GCM storage for attachments
  src/store.js           Users and rooms (JSON file)
  test/                  Integration tests
client/
  src/rtc/MeshCall.js    WebRTC mesh and local media controls
  src/rtc/media.js       Device access helpers
  src/components/        Meeting, Stage, Whiteboard, ChatPanel, FilesPanel, PreJoin
  src/pages/             Auth, home and room routes
mobile/
  app/                   Screens and routes (Expo Router)
  src/rtc/MeshCall.js    Native WebRTC mesh, same protocol as the web client
  src/components/        Meeting, Stage, Whiteboard, ChatPanel, FilesPanel, PreJoin
```

## How it works

### WebRTC mesh

Each participant holds one `RTCPeerConnection` per other participant. The person who joins later sends the offer. Socket.io carries the SDP and ICE messages, and audio and video then flow directly between browsers.

Every connection is created with four fixed transceivers: microphone, camera, screen video and screen audio. Turning the camera on or starting a screen share is then just `replaceTrack()` on the right slot. There is no renegotiation and so no offer collisions, someone joining mid-share simply receives the track, and each incoming track's purpose is known from its position.

If a connection fails, the original offerer performs an ICE restart. If the signaling socket drops, the client rejoins and rebuilds its connections.

### Socket events

| Client to server | Server to client | Purpose |
| --- | --- | --- |
| `room:join` | `peer:joined`, `peer:left` | Presence. The join reply includes peers, chat, board, files and ICE servers |
| `signal` | `signal` | SDP and ICE, relayed to one peer in the same room |
| `media:state` | `media:state` | Mic, camera and screen status |
| `chat:send` | `chat:message` | Text chat |
| `wb:stroke`, `wb:text`, `wb:clear` | the same events, `wb:full` | Whiteboard |
| | `file:shared` | New file notification |

### REST API

Everything except register and login requires `Authorization: Bearer <token>`.

| Route | Purpose |
| --- | --- |
| `POST /api/auth/register`, `POST /api/auth/login` | Returns a JWT and the user |
| `GET /api/auth/me` | Current user |
| `GET /api/rooms`, `POST /api/rooms` | List your meetings, create one |
| `GET /api/rooms/:roomId` | Meeting details |
| `POST /api/rooms/:roomId/files` | Upload (current participants only) |
| `GET /api/rooms/:roomId/files/:fileId` | Download (current participants only) |

### Whiteboard

All clients draw on the same 1920×1080 logical canvas, scaled with CSS. Strokes are sent in batches every 40 ms and appended to a log on the server, which is replayed for anyone who joins later.

## Security

- **Transport:** the server refuses to start without a certificate unless `ALLOW_HTTP=true` is set for use behind a TLS-terminating proxy. Sockets use WSS. WebRTC media is always encrypted with DTLS-SRTP.
- **Authentication:** bcrypt password hashes (cost 12), JWTs pinned to HS256 and verified on every API call and socket connection. A socket is disconnected when its token expires.
- **Input handling:** every socket payload and request body passes a strict Zod schema. Text has HTML tags and invisible control characters removed, so a chat message containing literal `<div>` loses that part.
- **Signaling isolation:** the server sets the sender on relayed messages and only relays within a room.
- **Abuse limits:** per-socket and per-event rate limits, login throttling, payload caps, a socket origin check, and caps on board size and participants.
- **Files:** only people currently in the meeting can upload or download. Files are encrypted at rest with a per-file AES-256-GCM key held only in memory, are always served as downloads, and are deleted when the meeting's retention period ends.
- **Headers:** Helmet with a Content Security Policy, and HSTS in production.

### Known limits

- Anyone logged in who has the meeting link can join. The links are unguessable, but there is no waiting room or host control.
- Chat, whiteboard and file contents reach the server. TLS protects them in transit, but they are not end-to-end encrypted.
- The JWT is kept in `localStorage`, so the CSP is the main protection against token theft by injected script.
- A mesh gets heavy quickly, because each person uploads one stream per peer. Beyond about 4 to 6 people with cameras on, a media server (SFU) is the right tool.
- Without a TURN server, some networks can't connect peers directly. In testing, a phone on mobile data could not reach a PC without one, so configure TURN before using this outside a single network.
- Mobile browsers such as Chrome on Android can receive a screen share but can't start one, so the share button is hidden there.
- Users and rooms live in a JSON file and meeting state in memory, so this runs as a single process.

## Production

```bash
npm ci
npm run build
NODE_ENV=production npm start     # PowerShell: $env:NODE_ENV='production'; npm start
```

The server hosts the built client and the API on one origin. Point `TLS_KEY_PATH` and `TLS_CERT_PATH` at a real certificate, or set `ALLOW_HTTP=true` and `TRUST_PROXY=1` behind a reverse proxy. A proxy must forward WebSocket upgrades and the original `Host` header; otherwise list your site in `ALLOWED_ORIGINS`. Configure a TURN server for users on restrictive networks.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `JWT_SECRET must be set` or `TLS certificate not found` | Run `npm run setup` |
| Camera or microphone blocked | Check the site permission in the address bar, and that the page is `https://` |
| "being used by another application" | Close other apps using the camera. Two browsers on one computer may not be able to share a real webcam on Windows |
| Peers stuck on "connecting…" | The network probably needs TURN. Set `TURN_URLS` and its credentials |
| Port already in use | Stop the other process, or change `PORT` and run Vite with `BACKEND_URL=https://localhost:<port>` |

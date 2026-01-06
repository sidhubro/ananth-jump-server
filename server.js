// server.js
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

// Rooms: passkey -> { players: Map<username,{x,y,score}>, sockets: Set<ws> }
const rooms = new Map();

function makeKey(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let k = '';
  for (let i = 0; i < len; i++) k += chars[Math.floor(Math.random() * chars.length)];
  return k;
}

function broadcastRoom(passkey, payload) {
  const room = rooms.get(passkey);
  if (!room) return;
  const msg = JSON.stringify(payload);
  room.sockets.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

function cleanupSocket(ws) {
  const { passkey, username } = ws._meta || {};
  if (!passkey || !rooms.has(passkey)) return;
  const room = rooms.get(passkey);
  if (username) room.players.delete(username);
  room.sockets.delete(ws);
  if (room.players.size === 0) rooms.delete(passkey);
  else broadcastRoom(passkey, { type: 'state', players: Object.fromEntries(room.players) });
}

wss.on('connection', (ws) => {
  ws._meta = { passkey: null, username: null };

  ws.on('message', (msg) => {
    let data;
    try { data = JSON.parse(msg); } catch (e) { return; }

    if (data.type === 'createRoom') {
      const { passkey, roomName, username } = data;
      if (!passkey || !username) return;
      rooms.set(passkey, {
        name: roomName,
        players: new Map([[username, { x: 0, y: 0, score: 0 }]]),
        sockets: new Set([ws])
      });
      ws._meta = { passkey, username };
      ws.send(JSON.stringify({ type: 'roomCreated', passkey, roomName }));
    }

    if (data.type === 'joinRoom') {
      const { passkey, username } = data;
      if (!rooms.has(passkey)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
        return;
      }
      const room = rooms.get(passkey);
      if (room.players.has(username)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Username already in room' }));
        return;
      }
      ws._meta.passkey = passkey;
      ws._meta.username = username;
      room.sockets.add(ws);
      room.players.set(username, { x: 50, y: 400, score: 0 });
      ws.send(JSON.stringify({ type: 'roomJoined', passkey }));
      broadcastRoom(passkey, { type: 'state', players: Object.fromEntries(room.players) });
      return;
    }

    if (data.type === 'update') {
      const { passkey, username, state } = data;
      if (!rooms.has(passkey)) return;
      const room = rooms.get(passkey);
      if (!room.players.has(username)) return;
      room.players.set(username, state);
      broadcastRoom(passkey, { type: 'state', players: Object.fromEntries(room.players) });
      return;
    }

    if (data.type === 'kick') {
      const { target } = data;
      const { passkey } = ws._meta;
      const room = rooms.get(passkey);
      if (!room) return;
      for (const sock of room.sockets) {
        if (sock._meta.username === target) {
          sock.send(JSON.stringify({ type: 'kicked' }));
          sock.close();
        }
      }
    }
  });

  ws.on('close', () => cleanupSocket(ws));
  ws.on('error', () => cleanupSocket(ws));
});

console.log('WebSocket server running on ws://localhost:8080');

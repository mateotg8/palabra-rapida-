const path = require('path');
const http = require('http');
const fs = require('fs');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const app = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    const file = path.join(__dirname, 'Palabra_Rapida_V3.6.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(file).pipe(res);
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

const io = new Server(app);
const rooms = new Map();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function roomCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function publicPlayers(room) {
  return room.players.map(p => ({ id: p.id, name: p.name, host: p.id === room.hostId }));
}

function broadcastRoom(room) {
  io.to(room.code).emit('roomUpdate', { room: room.code, players: publicPlayers(room) });
}

function removeFromRoom(socket) {
  const code = socket.data.room;
  if (!code || !rooms.has(code)) return;
  const room = rooms.get(code);
  room.players = room.players.filter(p => p.id !== socket.id);
  socket.leave(code);
  socket.data.room = null;

  if (room.players.length === 0) {
    rooms.delete(code);
    return;
  }

  if (room.hostId === socket.id) {
    room.hostId = room.players[0].id;
    io.to(room.code).emit('hostChanged', { hostId: room.hostId, players: publicPlayers(room) });
  }
  broadcastRoom(room);
}

io.on('connection', socket => {
  socket.on('createRoom', ({ name }) => {
    removeFromRoom(socket);
    const code = roomCode();
    const room = { code, hostId: socket.id, players: [{ id: socket.id, name: String(name || 'Jugador').slice(0, 18) }] };
    rooms.set(code, room);
    socket.join(code);
    socket.data.room = code;
    socket.emit('roomCreated', { room: code, players: publicPlayers(room) });
  });

  socket.on('joinRoom', ({ room: rawRoom, name }) => {
    removeFromRoom(socket);
    const code = String(rawRoom || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return socket.emit('roomError', 'No existe una sala con ese código.');
    if (room.players.length >= 8) return socket.emit('roomError', 'La sala ya tiene 8 jugadores.');

    room.players.push({ id: socket.id, name: String(name || 'Jugador').slice(0, 18) });
    socket.join(code);
    socket.data.room = code;
    socket.emit('roomJoined', { room: code, players: publicPlayers(room) });
    broadcastRoom(room);
  });

  socket.on('leaveRoom', () => removeFromRoom(socket));

  socket.on('prepareGame', (settings = {}) => {
    const code = socket.data.room;
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    io.to(code).emit('gamePrepared', { room: code, settings });
  });

  socket.on('syncGame', (state) => {
    const code = socket.data.room;
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    io.to(code).emit('gameState', { state });
  });

  socket.on('playerAction', (payload = {}) => {
    const code = socket.data.room;
    const room = rooms.get(code);
    if (!room) return;
    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex < 0) return;
    const action = String(payload.action || '');
    const value = payload.value;
    const allowed = ['answer','continue','cambio','comodin','letra','duelRival','duelContinue','duelWin','duelNone','tieContinue','tieWin','tieNone'];
    if (!allowed.includes(action)) return;
    // The host receives the action and remains authoritative for game state.
    io.to(room.hostId).emit('onlinePlayerAction', { playerIndex, action, value });
  });

  socket.on('onlineMessage', (payload = {}) => {
    const code = socket.data.room;
    const room = rooms.get(code);
    if (!room) return;
    if (payload.type === 'hostNotice' && room.hostId === socket.id) {
      socket.to(code).emit('hostNotice', { text: String(payload.text || '').slice(0, 200) });
    }
  });

  socket.on('disconnect', () => removeFromRoom(socket));
});

app.listen(PORT, () => console.log(`Palabra Rápida online en http://localhost:${PORT}`));

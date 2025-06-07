const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

const roomStates = {}; // لتخزين حالة كل غرفة

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('join-room', ({ room, videoUrl, username }) => {
    socket.join(room);
    socket.room = room;
    socket.username = username || `User_${socket.id.substring(0, 6)}`;

    // تحديد الأدمن إن لم يكن موجودًا
    if (!roomStates[room]) {
      roomStates[room] = {
        videoUrl,
        currentTime: 0,
        isPlaying: false,
        admin: socket.id,
        users: new Map(), // لتخزين معلومات المستخدمين
        roomName: room
      };
    }

    // إضافة المستخدم إلى قائمة المستخدمين
    roomStates[room].users.set(socket.id, {
      id: socket.id,
      username: socket.username,
      joinedAt: new Date()
    });

    const state = roomStates[room];
    const userCount = state.users.size;
    
    // إرسال حالة الفيديو للمستخدم الجديد
    socket.emit('init-video', {
      ...state,
      isAdmin: state.admin === socket.id,
      userCount: userCount,
      roomName: room
    });

    // إرسال معلومات الغرفة لجميع المستخدمين
    io.to(room).emit('room-info-update', {
      roomName: room,
      userCount: userCount,
      users: Array.from(state.users.values())
    });

    // إشعار باقي المستخدمين بانضمام مستخدم جديد
    socket.to(room).emit('user-joined', {
      userId: socket.id,
      username: socket.username
    });

    console.log(`${socket.username} joined room: ${room}`);
  });

  socket.on('play', (time) => {
    const room = socket.room;
    if (roomStates[room] && roomStates[room].admin === socket.id) {
      roomStates[room].currentTime = time;
      roomStates[room].isPlaying = true;
      socket.to(room).emit('play', time);
    }
  });

  socket.on('pause', (time) => {
    const room = socket.room;
    if (roomStates[room] && roomStates[room].admin === socket.id) {
      roomStates[room].currentTime = time;
      roomStates[room].isPlaying = false;
      socket.to(room).emit('pause', time);
    }
  });

  socket.on('seek', (time) => {
    const room = socket.room;
    if (roomStates[room] && roomStates[room].admin === socket.id) {
      roomStates[room].currentTime = time;
      socket.to(room).emit('seek', time);
    }
  });

  // WebRTC Voice Chat Events
  socket.on('start-voice', (room) => {
    socket.to(room).emit('user-wants-voice', socket.id);
  });

  socket.on('offer', ({ to, offer }) => {
    socket.to(to).emit('offer', { from: socket.id, offer });
  });

  socket.on('answer', ({ to, answer }) => {
    socket.to(to).emit('answer', { from: socket.id, answer });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    socket.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  socket.on('voice-status', ({ room, isActive }) => {
    socket.to(room).emit('user-voice-status', {
      userId: socket.id,
      username: socket.username,
      isActive
    });
  });

  socket.on('disconnect', () => {
    const room = socket.room;
    if (room && roomStates[room]) {
      // إزالة المستخدم من قائمة المستخدمين
      roomStates[room].users.delete(socket.id);
      const userCount = roomStates[room].users.size;

      // إذا كان هو الأدمن، نقل الإدارة لمستخدم آخر
      if (roomStates[room].admin === socket.id) {
        const clients = Array.from(io.sockets.adapter.rooms.get(room) || []);
        const newAdmin = clients.find(clientId => clientId !== socket.id);
        
        if (newAdmin) {
          roomStates[room].admin = newAdmin;
          io.to(newAdmin).emit('you-are-now-admin');
          io.to(room).emit('admin-changed', {
            oldAdmin: socket.id,
            newAdmin: newAdmin
          });
        } else {
          // إذا لم يبق أحد، احذف الغرفة
          delete roomStates[room];
        }
      }

      // إشعار باقي المستخدمين بمغادرة المستخدم
      socket.to(room).emit('user-left', {
        userId: socket.id,
        username: socket.username
      });

      // تحديث معلومات الغرفة
      if (roomStates[room]) {
        io.to(room).emit('room-info-update', {
          roomName: room,
          userCount: userCount,
          users: Array.from(roomStates[room].users.values())
        });
      }
    }

    console.log('User disconnected:', socket.id);
  });
});

http.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mysql = require('mysql2');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const db = mysql.createPool({
    host: '104.247.162.162', 
    user: 'atabekhs_atabek54', 
    password: 'Kaderkeita54', 
    database: 'atabekhs_hsadatabase'
});

// db.connect(err => {
//     if (err) {
//         console.error('MySQL bağlantı hatası:', err);
//         return;
//     }
//     console.log('MySQL bağlantısı başarılı.');
  
// });

let waitingPlayer = null;
let games = {}; 

function loadQuestions(callback) {
    db.query('SELECT * FROM questions', (err, results) => {
        if (err) {
            console.error('Sorular çekilirken hata oluştu:', err);
            callback([]);
        } else {
            callback(results);
        }
    });
}

io.on('connection', (socket) => {
    console.log('A user connected: ' + socket.id);

    socket.on('joinGame', () => {
        if (!waitingPlayer) {
            waitingPlayer = socket;
            console.log(`Player ${socket.id} is waiting for an opponent.`);
            socket.emit('waitingForPlayer');
        } else {
            const roomId = `room-${socket.id}-${waitingPlayer.id}`;
            console.log(`Game started in room ${roomId} with players: ${waitingPlayer.id} and ${socket.id}`);

            socket.join(roomId);
            waitingPlayer.join(roomId);

            games[roomId] = {
                players: [waitingPlayer.id, socket.id],
                scores: { [waitingPlayer.id]: 0, [socket.id]: 0 },
                answeredQuestions: new Set(),
                currentQuestionIndex: 0
            };

            io.to(roomId).emit('gameStarted');

            loadQuestions((questions) => {
                games[roomId].questions = questions;
                io.to(roomId).emit('receiveQuestions', questions);
            });

            // Yeni oyun başladığında waitingPlayer sıfırlanır
            waitingPlayer = null;
        }
    });

    socket.on('correctAnswer', () => {
        const roomId = Object.keys(games).find(room => games[room].players.includes(socket.id));
        if (roomId && games[roomId]) {
            const game = games[roomId];

            if (!game.answeredQuestions || !Array.isArray(game.answeredQuestions)) {
                game.answeredQuestions = [];
            }

            const currentQuestion = game.questions[game.currentQuestionIndex];

            if (!game.answeredQuestions.some(answer => answer.question === currentQuestion)) {
                game.scores[socket.id] += 1;
                game.answeredQuestions.push({
                    question: currentQuestion,
                    playerId: socket.id
                });

                console.log(`Player ${socket.id} scored! Yeni skor: ${game.scores[socket.id]}`);
                io.to(roomId).emit('updateScores', game.scores);
            }

            game.currentQuestionIndex = (game.currentQuestionIndex || 0) + 1;

            if (game.currentQuestionIndex < game.questions.length) {
                const nextQuestion = game.questions[game.currentQuestionIndex];
                io.to(roomId).emit('nextQuestion', nextQuestion);
            } else {
                io.to(roomId).emit('gameEnded');
                delete games[roomId]; 
                console.log(`Game ended in room: ${roomId}`);
            }
        }
    });

    socket.on('cancelGame', () => {
      // Eğer oyuncu bekleme durumundaysa ve oyun başlamamışsa
      if (waitingPlayer && waitingPlayer.id === socket.id) {
          console.log(`Player ${socket.id} cancelled before game started.`);
          waitingPlayer = null;  // Bekleyen oyuncuyu sıfırlıyoruz
          socket.emit('gameCancelled');  // İptal mesajını geri gönderiyoruz
      } else {
          // Eğer oyuncu oyunda ise, oyunun iptali işlemi
          const roomId = Object.keys(games).find(room => games[room].players.includes(socket.id));
          if (roomId && games[roomId]) {
              console.log(`Player ${socket.id} cancelled the game in room ${roomId}`);
              const otherPlayer = games[roomId].players.find(player => player !== socket.id);
              if (otherPlayer) {
                  io.to(otherPlayer).emit('opponentDisconnected');
              }
              // Oyun bilgisini sil
              delete games[roomId];
  
              // İptal edilen oyun sonrası waitingPlayer sıfırlanmalı
              waitingPlayer = null;
          }
      }
  });
  

    socket.on('endGame', () => {
        const roomId = Object.keys(games).find(room => games[room].players.includes(socket.id));
        if (roomId && games[roomId]) {
            console.log(`Player ${socket.id} ended the game in room ${roomId}`);
            const otherPlayer = games[roomId].players.find(player => player !== socket.id);
            if (otherPlayer) {
                io.to(otherPlayer).emit('gameEnded');
            }
            delete games[roomId];
        }
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected: ' + socket.id);
        const roomId = Object.keys(games).find(room => games[room].players.includes(socket.id));
        if (roomId && games[roomId]) {
            const otherPlayer = games[roomId].players.find(player => player !== socket.id);
            if (otherPlayer) {
                io.to(otherPlayer).emit('opponentDisconnected');
                console.log(`Player ${otherPlayer} is notified about opponent disconnection.`);
            }
            delete games[roomId];
        }
        if (waitingPlayer && waitingPlayer.id === socket.id) {
            waitingPlayer = null;
        }
    });
});

server.listen(3000, () => {
    console.log('Server is running on port 3000');
});

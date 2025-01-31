const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mysql = require('mysql2');
const { v4: uuidv4 } = require('uuid'); // UUID oluşturmak için
const bcrypt = require('bcrypt');
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json()); // JSON verileri işleyebilmek için

const server = http.createServer(app);
const io = socketIo(server);
const db = mysql.createPool({
    host: '104.247.162.162', 
    user: 'atabekhs_atabek54', 
    password: 'Kaderkeita54', 
    database: 'atabekhs_hsadatabase'
});
app.post('/register', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    // Kullanıcı adının daha önce kayıtlı olup olmadığını kontrol et
    const checkUserQuery = 'SELECT * FROM users WHERE username = ?';
    db.query(checkUserQuery, [username], (err, result) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (result.length > 0) {
            // Eğer kullanıcı adı daha önce kaydedilmişse, hata döndür
            return res.status(400).json({ error: 'Username already taken' });
        }

        // Kullanıcı adı daha önce alınmamışsa, şifreyi hash'le
        bcrypt.hash(password, 10, (err, hashedPassword) => {
            if (err) {
                console.error('Password hashing error:', err);
                return res.status(500).json({ error: 'Error hashing password' });
            }

            const user_uuid = uuidv4(); // Benzersiz UUID oluştur

            // Yeni kullanıcıyı veritabanına ekle
            const query = 'INSERT INTO users (user_uuid, username, password) VALUES (?, ?, ?)';
            db.query(query, [user_uuid, username, hashedPassword], (err, result) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Database error' });
                }
                res.json({ success: true, user_uuid });
            });
        });
    });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    // Kullanıcıyı veritabanından bulalım
    const query = 'SELECT * FROM users WHERE username = ?';
    db.query(query, [username], (err, result) => {
        if (err || result.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = result[0];
        
        // Şifreyi hash ile karşılaştıralım
        bcrypt.compare(password, user.password, (err, isMatch) => {
            if (err) {
                console.error('Error comparing passwords:', err);
                return res.status(500).json({ error: 'Error comparing passwords' });
            }

            if (isMatch) {
                // Başarılı girişte user_uuid'yi de döndürüyoruz
                res.json({
                    success: true,
                    message: 'Login successful',
                    user_uuid: user.user_uuid, // user_uuid'yi burada döndürüyoruz
                });
            } else {
                res.status(400).json({ error: 'Invalid password' });
            }
        });
    });
});

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
    socket.on('playerAnswered', (selectedOption) => {
        const roomId = Object.keys(games).find(room => games[room].players.includes(socket.id));
    
        if (roomId && games[roomId]) {
            const game = games[roomId];
            const currentQuestion = game.questions[game.currentQuestionIndex];
    
            if (!game.answeredQuestions || !Array.isArray(game.answeredQuestions)) {
                game.answeredQuestions = [];
            }
    
            // Oyuncunun bu soruya zaten cevap verip vermediğini kontrol et
            const playerAnswered = game.answeredQuestions.some(answer => answer.playerId === socket.id && answer.question === currentQuestion);
    
            if (!playerAnswered) {
                game.answeredQuestions.push({
                    question: currentQuestion,
                    playerId: socket.id,
                    selectedAnswer: selectedOption
                });
    
                // Eğer doğru cevap verdiyse skor arttır
                if (selectedOption === currentQuestion.correct_answer) {
                    game.scores[socket.id] += 1;
                    console.log(`Player ${socket.id} scored! Yeni skor: ${game.scores[socket.id]}`);
                }
            }
    
            // Tüm oyuncuların cevap verip vermediğini kontrol et
            const allPlayersAnswered = game.players.every(playerId =>
                game.answeredQuestions.some(answer => answer.playerId === playerId && answer.question === currentQuestion)
            );
    
            if (allPlayersAnswered) {
                // İlk doğru cevabı veren oyuncuyu bul
                const firstCorrectAnswer = game.answeredQuestions.find(answer => answer.selectedAnswer === currentQuestion.correct_answer);
                
                if (firstCorrectAnswer) {
                    // İlk doğru cevabı veren oyuncu ile yeni soruya geç
                    game.currentQuestionIndex = (game.currentQuestionIndex || 0) + 1;
    
                    if (game.currentQuestionIndex < game.questions.length) {
                        const nextQuestion = game.questions[game.currentQuestionIndex];
                        game.answeredQuestions = []; // Yeni soru için önceki cevapları sıfırla
                        io.to(roomId).emit('nextQuestion', nextQuestion);
                    } else {
                        io.to(roomId).emit('gameEnded');
                        
                        delete games[roomId];
                        console.log(`Game ended in room: ${roomId}`);
                    }
                } else {
                    console.log("İKİ OYUNCUDA Doğru cevap VEREMEDI, bekleniyor...");
                    game.currentQuestionIndex = (game.currentQuestionIndex || 0) + 1;
    
                    if (game.currentQuestionIndex < game.questions.length) {
                        const nextQuestion = game.questions[game.currentQuestionIndex];
                        game.answeredQuestions = []; // Yeni soru için önceki cevapları sıfırla
                        io.to(roomId).emit('nextQuestion', nextQuestion);
                    } else {
                        io.to(roomId).emit('gameEnded');
                        delete games[roomId];
                        console.log(`Game ended in room: ${roomId}`);
                    }
                }
    
                // Skorları güncelle ve tüm oyunculara ilet
                io.to(roomId).emit('updateScores', game.scores);
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

server.listen(PORT, () => {
    console.log('Server is running on port 3000');
});

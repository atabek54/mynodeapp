const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mysql = require('mysql2');
const { v4: uuidv4 } = require('uuid'); // UUID oluşturmak için
const bcrypt = require('bcryptjs');
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json()); // JSON verileri işleyebilmek için

const server = http.createServer(app);
const io = socketIo(server);
const db = mysql.createPool({
    host: '104.247.162.163', 
    user: 'atabekhs_atabek54', 
    password: 'Kaderkeita54', 
    database: 'atabekhs_hsadatabase',
});
db.getConnection((err, connection) => {
    if (err) {
        console.error('Veritabanı bağlantı hatası:', err);
        return;
    }
    console.log('Veritabanına başarıyla bağlanıldı!');
    connection.release(); // Bağlantıyı serbest bırak
});

app.post('/get-questions', (req, res) => {
    const questionCount = req.body.questionCount || 10; // Varsayılan 10 soru
    const categoryId = req.body.categoryId; // Gönderilen kategori ID
  
    let query = `SELECT * FROM questions`;
    const queryParams = [];
  
    // Kategoriye göre filtreleme
    if (categoryId) {
      query += ` WHERE category_id = ?`;
      queryParams.push(categoryId);
    }
  
 
    query += ` ORDER BY RAND() LIMIT ?`;

    queryParams.push(questionCount);
  
    db.query(query, queryParams, (err, results) => {
      if (err) {
        console.error('Sorgu hatası:', err);
        return res.status(500).json({ success: false, message: 'Veri alınamadı.' });
      }
      res.json({ success: true, data: results });
    });
  });
  app.post('/save_answered_questions', (req, res) => {
    const { user_uuid, answered_questions } = req.body;
  
    // Gelen veriyi kontrol et
    if (!user_uuid || !Array.isArray(answered_questions)) {
      return res.status(400).json({ message: 'Geçersiz veri formatı' });
    }
  
    const promises = answered_questions.map((question) => {
      return new Promise((resolve, reject) => {
        const { question: questionText, selected_answer, is_correct, category_id, question_id } = question;
  
        // Önce question_id'yi kontrol et
        const checkSql = 'SELECT COUNT(*) AS count FROM wrong_answered_questions WHERE question_id = ? AND user_uuid = ?';
        db.query(checkSql, [question_id, user_uuid], (checkErr, checkResult) => {
          if (checkErr) {
            console.error('Veritabanı kontrol hatası:', checkErr);
            return reject(checkErr);
          }
  
          const count = checkResult[0].count;
          if (count > 0) {
            // Zaten varsa ekleme yapma
            console.log(`Soru ID: ${question_id} zaten mevcut, atlanıyor.`);
            return resolve(`Soru ID: ${question_id} zaten mevcut.`);
          }
  
          // Yoksa yeni kayıt ekle
          const insertSql = 'INSERT INTO wrong_answered_questions (user_uuid, question, selected_answer, is_correct, category_id, question_id) VALUES (?, ?, ?, ?, ?, ?)';
          const values = [user_uuid, questionText, selected_answer, is_correct, category_id, question_id];
  
          db.query(insertSql, values, (insertErr, result) => {
            if (insertErr) {
              console.error('Veritabanı ekleme hatası:', insertErr);
              reject(insertErr);
            } else {
              resolve(result);
            }
          });
        });
      });
    });
  
    Promise.all(promises)
      .then(() => {
        res.status(200).json({ message: 'Yanıtlar başarıyla kaydedildi' });
      })
      .catch((error) => {
        console.error(error);
        res.status(500).json({ message: 'Veritabanı hatası', error });
      });
  });
app.post('/get_wrong_questions', (req, res) => {
  const { user_uuid, category_id, limit } = req.body;  // limit parametresini alıyoruz

  if (!user_uuid || !category_id) {
    return res.status(400).json({ message: 'user_uuid ve category_id parametreleri gerekli' });
  }

  // Eğer limit değeri belirtilmemişse, default olarak 10 alalım
  const questionLimit = limit ? parseInt(limit) : 10;

  const sql = `
    SELECT 
      q.*, 
      waq.id AS waq_id, waq.selected_answer, waq.is_correct, waq.category_id AS waq_category_id, waq.question_id AS waq_question_id
    FROM wrong_answered_questions waq
    INNER JOIN questions q ON waq.question_id = q.id 
    WHERE waq.user_uuid = ? AND waq.category_id = ?
    LIMIT ?
  `;

  db.query(sql, [user_uuid, category_id, questionLimit], (err, results) => {
    if (err) {
      console.error('Veritabanı hatası:', err);
      return res.status(500).json({ message: 'Veritabanı hatası', error: err });
    }

    // results.map ile questions ve waq_id'yi birleştiriyoruz
    const questions = results.map(row => {
      const { waq_id, selected_answer, is_correct, waq_category_id, waq_question_id, ...questionData } = row;
      // questionData'ya waq_id'yi dahil ediyoruz
      return { ...questionData, waq_id };
    });

    const wrong_answered_q = results.map(row => ({
      id: row.waq_id,
      selected_answer: row.selected_answer,
      is_correct: row.is_correct,
      category_id: row.waq_category_id,
      question_id: row.waq_question_id
    }));

    res.status(200).json({ questions, wrong_answered_q });
  });
});

  
  app.post('/delete_wrong_answer', (req, res) => {
    const { id } = req.body;  // waq_id parametresini alıyoruz
  
    if (!id) {
      return res.status(400).json({ message: 'waq_id parametresi gerekli' });
    }
  
    const sql = `
      DELETE FROM wrong_answered_questions 
      WHERE id = ?
    `;
  
    db.query(sql, [id], (err, result) => {
      if (err) {
        console.error('Veritabanı hatası:', err);
        return res.status(500).json({ message: 'Veritabanı hatası', error: err });
      }
  
      if (result.affectedRows > 0) {
        return res.status(200).json({ message: 'Yanıt başarıyla silindi' });
      } else {
        return res.status(404).json({ message: 'Bu id ile eşleşen bir kayıt bulunamadı' });
      }
    });
  });
  
    
app.post('/checkuser', (req, res) => {
    const { user_uuid } = req.body;

    if (!user_uuid) {
        return res.status(400).json({ error: 'User UUID is required' });
    }

    // Kullanıcıyı veritabanında ara
    const query = 'SELECT user_uuid, username, point,isPremium FROM users WHERE user_uuid = ?';
    db.query(query, [user_uuid], (err, result) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (result.length > 0) {
            // Kullanıcı bulundu, bilgileri döndür
            return res.json({ success: true, user: result[0] });
        } else {
            // Kullanıcı bulunamadı
            return res.status(404).json({ error: 'User not found' });
        }
    });
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
            const insertQuery = 'INSERT INTO users (user_uuid, username, password, point,isPremium) VALUES (?, ?, ?, 0,0)';
            db.query(insertQuery, [user_uuid, username, hashedPassword], (err, result) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Database error' });
                }

                // Kayıt başarılı olduysa, yeni kullanıcının tüm bilgilerini getir
                const selectQuery = 'SELECT user_uuid, username, point,isPremium FROM users WHERE user_uuid = ?';
                db.query(selectQuery, [user_uuid], (err, userResult) => {
                    if (err) {
                        console.error('Database error:', err);
                        return res.status(500).json({ error: 'Database error' });
                    }

                    if (userResult.length > 0) {
                        return res.json({ success: true, user: userResult[0] });
                    } else {
                        return res.status(500).json({ error: 'User retrieval failed' });
                    }
                });
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
    const query = 'SELECT user_uuid, username, password, point,isPremium FROM users WHERE username = ?';
    db.query(query, [username], (err, result) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (result.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = result[0];

        // Şifreyi hash ile karşılaştır
        bcrypt.compare(password, user.password, (err, isMatch) => {
            if (err) {
                console.error('Error comparing passwords:', err);
                return res.status(500).json({ error: 'Error comparing passwords' });
            }

            if (isMatch) {
                // Başarılı girişte tüm kullanıcı bilgilerini döndür
                res.json({
                    success: true,
                    message: 'Login successful',
                    user: {
                        user_uuid: user.user_uuid,
                        username: user.username,
                        point: user.point,
                        isPremium : user.isPremium
                    }
                });
            } else {
                res.status(400).json({ error: 'Invalid password' });
            }
        });
    });
});
app.post('/updateUserPoint', (req, res) => {
    const { user_uuid, point } = req.body;

    if (!user_uuid || point === undefined) {
        return res.status(400).json({ error: 'user_uuid and point are required' });
    }

    // Önce mevcut puanı al
    const getUserQuery = 'SELECT * FROM users WHERE user_uuid = ?';
    db.query(getUserQuery, [user_uuid], (err, result) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (result.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        let user = result[0];
        let newPoint = user.point + point; // Yeni puanı hesapla

        // Puanı güncelle
        const updateQuery = 'UPDATE users SET point = ? WHERE user_uuid = ?';
        db.query(updateQuery, [newPoint, user_uuid], (err, updateResult) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            // Kullanıcı bilgilerini tekrar çek (güncellenmiş haliyle)
            db.query(getUserQuery, [user_uuid], (err, updatedResult) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Database error' });
                }

                res.json({
                    success: true,
                    message: 'User point updated successfully',
                    user: updatedResult[0] // Güncellenmiş kullanıcı bilgileri
                });
            });
        });
    });
});
app.post('/update-premium', (req, res) => {
    const { user_uuid } = req.body;
  
    if (!user_uuid) {
      return res.status(400).json({ message: 'user_uuid gerekli.' });
    }
  
    const updateSql = 'UPDATE users SET isPremium = 1 WHERE user_uuid = ?';
    
    db.query(updateSql, [user_uuid], (err, result) => {
      if (err) {
        console.error('Güncelleme hatası:', err);
        return res.status(500).json({ message: 'Bir hata oluştu.' });
      }
  
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'Kullanıcı bulunamadı.' });
      }
  
      // Güncellenen kullanıcıyı getir
      const selectSql = 'SELECT * FROM users WHERE user_uuid = ?';
      db.query(selectSql, [user_uuid], (err, userResult) => {
        if (err) {
          console.error('Kullanıcı verisi getirme hatası:', err);
          return res.status(500).json({ message: 'Kullanıcı verisi alınamadı.' });
        }
  
        res.status(200).json({
          message: 'Premium başarıyla güncellendi.',
          user: userResult[0] // Tüm kullanıcı bilgileri
        });
      });
    });
  });
app.post('/rankings', (req, res) => {
    const { user_uuid } = req.body;

    if (!user_uuid) {
        return res.status(400).json({ error: 'User UUID is required' });
    }

    // Tüm kullanıcıları puana göre sıralı olarak getir
    const query = `
        SELECT id, username, point
        FROM users
        ORDER BY point DESC;
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        // Kullanıcının kendi sıralamasını bul
        const userIndex = results.findIndex(user => user.id === user_uuid) + 1; // 1'den başlat

        res.json({
            rankings: results.slice(0, 5), // İlk 5 kişiyi gönder
            userRank: userIndex > 0 ? userIndex : "Not found" // Kullanıcı sıralaması varsa gönder
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
            // Veriyi JSON olarak alırken, karakter setini kontrol et
            try {
                const utf8Results = results.map((row) => {
                    return {
                        ...row,
                        question: row.question ? Buffer.from(row.question, 'latin1').toString('utf8') : row.question,
                    };
                });

                callback(utf8Results);
            } catch (error) {
                console.error('Veri işleme hatası:', error);
                callback([]);
            }
        }
    });
}


io.on('connection', (socket) => {
    console.log('A user connected: ' + socket.id);

   
    socket.on('joinGame', (username) => {
        if (!waitingPlayer) {
            waitingPlayer = { id: socket.id, socket, username }; // Kullanıcı ID'sini de sakla
            console.log(`Player ${socket.id} (${username}) is waiting for an opponent.`);
            socket.emit('waitingForPlayer');
        } else {
            const roomId = `room-${socket.id}-${waitingPlayer.id}`;
            console.log(`Game started in room ${roomId} with players: ${waitingPlayer.id} (${waitingPlayer.username}) and ${socket.id} (${username})`);
    
            socket.join(roomId);
            waitingPlayer.socket.join(roomId);
    
            games[roomId] = {
                players: [
                    { id: waitingPlayer.id, username: waitingPlayer.username },
                    { id: socket.id, username }
                ],
                scores: { [waitingPlayer.id]: 0, [socket.id]: 0 },
                answeredQuestions: new Set(),
                currentQuestionIndex: 0
            };
    
            io.to(roomId).emit('gameStarted', games[roomId].players);
    
            loadQuestions((questions) => {
                games[roomId].questions = questions;
                io.to(roomId).emit('receiveQuestions', questions);
            });
    
            // Yeni oyun başladığında waitingPlayer sıfırlanır
            waitingPlayer = null;
        }
    });
    
    
    socket.on('playerAnswered', (selectedOption) => {
        const roomId = Object.keys(games).find(room => 
            games[room].players.some(player => player.id === socket.id) // Değiştirildi!
        );
    
        console.log("Found Room ID:", roomId);
    
        if (roomId && games[roomId]) {
            const game = games[roomId];
            const currentQuestion = game.questions[game.currentQuestionIndex];
    
            if (!game.answeredQuestions || !Array.isArray(game.answeredQuestions)) {
                game.answeredQuestions = [];
            }
    
            const playerAnswered = game.answeredQuestions.some(answer => answer.playerId === socket.id && answer.question === currentQuestion);
    
            if (!playerAnswered) {
                game.answeredQuestions.push({
                    question: currentQuestion,
                    playerId: socket.id,
                    selectedAnswer: selectedOption
                });
    
                if (selectedOption === currentQuestion.correct_answer) {
                    game.scores[socket.id] += 1;
                    console.log(`Player ${socket.id} scored! Yeni skor: ${game.scores[socket.id]}`);
                }
            }
    
            // Tüm oyuncuların cevap verip vermediğini kontrol et
            const allPlayersAnswered = game.players.every(playerId =>
                game.answeredQuestions.some(answer => answer.playerId === playerId.id && answer.question === currentQuestion)
            );
    
            if (allPlayersAnswered) {
                game.currentQuestionIndex++;
    
                if (game.currentQuestionIndex < game.questions.length) {
                    const nextQuestion = game.questions[game.currentQuestionIndex];
                    game.answeredQuestions = [];
                    io.to(roomId).emit('nextQuestion', nextQuestion);
                } else {
                    io.to(roomId).emit('gameEnded');
                    delete games[roomId];
                    console.log(`Game ended in room: ${roomId}`);
                }
    
                io.to(roomId).emit('updateScores', game.scores);
            }
        } else {
            console.log("HATA: Oyuncu herhangi bir odaya ait değil!");
        }
    });
    
    
    
    

    socket.on('cancelGame', () => {
        // Eğer oyuncu bekleme durumundaysa ve oyun başlamamışsa
        if (waitingPlayer && waitingPlayer.id === socket.id) {  // Artık 'id' doğru şekilde kontrol ediliyor
            console.log(`Player ${socket.id} cancelled before game started.`);
            waitingPlayer = null;  // Bekleyen oyuncuyu sıfırla
            socket.emit('gameCancelled');  // İptal mesajını geri gönder
        } else {
            // Eğer oyuncu oyunda ise, oyunun iptali işlemi
            const roomId = Object.keys(games).find(room => 
                games[room].players.some(player => player.id === socket.id)
            );
    
            if (roomId && games[roomId]) {
                console.log(`Player ${socket.id} cancelled the game in room ${roomId}`);
                const otherPlayer = games[roomId].players.find(player => player.id !== socket.id);
                if (otherPlayer) {
                    io.to(otherPlayer.id).emit('opponentDisconnected');
                }
                // Oyun bilgisini sil
                delete games[roomId];
    
                // Oyun iptal edildiğinde waitingPlayer sıfırlanmalı
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
    console.log(`Server is running on port ${PORT}`);
});


const express = require('express');
const app = express();
const port = 3000;

// JSON verilerini işlemek için
app.use(express.json());

// Basit bir GET isteği
app.get('/', (req, res) => {
  res.send('Merhaba, Node.js API!');
});

// Basit bir POST isteği
app.post('/veri', (req, res) => {
  const gelenVeri = req.body;
  res.json({ mesaj: 'Veri alındı', veri: gelenVeri });
});

// Sunucuyu başlat
app.listen(port, () => {
  console.log(`Sunucu http://localhost:${port} adresinde çalışıyor.`);
});

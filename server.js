// Entry point untuk menjalankan aplikasi secara lokal (bukan di Vercel).
// Di Vercel, yang dipakai adalah api/index.js langsung sebagai serverless function,
// dan folder /public otomatis di-serve sebagai static files.
const path = require('path');
const express = require('express');
const app = require('./api/index');

const staticApp = express();
staticApp.use(express.static(path.join(__dirname, 'public')));
staticApp.use(app);

const port = process.env.PORT || 3000;
staticApp.listen(port, () => {
  console.log(`Job Platform jalan di http://localhost:${port}`);
});

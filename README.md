# Job Platform — Freelancer Recruitment Tool

Platform web internal untuk tim Sherly: upload Job Profile Form (xlsx/PDF),
data langsung ke-extract otomatis (job title, department, direct report to,
placement, dll), industry ke-detect otomatis (gratis, tanpa API berbayar),
lalu bisa di-assign ke freelancer dan dipantau status-nya (Open/Closed).

## Fitur

- **Login dengan role**: 1 admin (kamu) + freelancer (masing-masing punya akun sendiri).
- **Upload & auto-extract**: upload file `.xlsx` atau `.pdf` sesuai template Job
  Profile Form kamu → semua field ke-extract otomatis, admin tinggal review/edit
  sebelum disimpan.
- **Auto-detect industry**: berbasis keyword matching (100% gratis, jalan di
  server sendiri, tanpa API AI berbayar). Lihat bagian "Cara kerja auto-detect
  industry" di bawah kalau mau nambah/ubah kategori.
- **Assign ke freelancer**: setiap job bisa di-assign ke satu freelancer.
  Freelancer cuma bisa lihat job yang di-assign ke dia.
- **Status Open/Closed**: admin bisa ubah status & assignment kapan saja;
  freelancer bisa update status job yang jadi tanggung jawabnya.
- **Catatan per job**: admin & freelancer bisa saling tinggalkan catatan/update
  progress di tiap job.

## Struktur project

```
api/index.js        -> semua route backend (Express), jalan sebagai satu
                        serverless function di Vercel
db.js                -> koneksi database & schema
parser.js            -> logic baca file xlsx/pdf & extract field
industry.js          -> daftar kategori industri + logic keyword matching
public/              -> semua halaman frontend (HTML/CSS/JS polos, tanpa
                        build step)
server.js            -> entry point untuk run di komputer sendiri (lokal)
vercel.json          -> config routing untuk deploy ke Vercel
```

## Menjalankan di komputer sendiri (opsional, untuk coba-coba dulu)

1. Install Node.js versi 18 ke atas.
2. Siapkan database Postgres (paling gampang: install Postgres.app / pakai
   Docker, atau langsung skip ke bagian deploy di bawah dan pakai database
   Neon gratis dari awal).
3. `npm install`
4. Copy `.env.example` jadi `.env`, isi `DATABASE_URL` dengan connection
   string Postgres kamu, dan isi `ADMIN_USERNAME` / `ADMIN_PASSWORD` sesuai
   keinginan.
5. `npm start` lalu buka `http://localhost:3000`.

Akun admin pertama otomatis dibuat saat pertama kali server jalan, sesuai
`ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_NAME` di `.env`.

## Deploy gratis pakai GitHub + Vercel (yang kamu udah familiar)

Kamu ga perlu belajar platform baru — semua dilakukan dari GitHub & Vercel
yang biasa kamu pakai. Databasenya numpang di Vercel juga (lewat Neon, yang
sekarang terintegrasi langsung di tab "Storage" punya Vercel).

### 1. Push project ini ke GitHub

- Buat repo baru di GitHub (bisa private), lalu push semua isi folder ini ke
  situ (`git init`, `git add .`, `git commit`, `git remote add origin ...`,
  `git push`).

### 2. Import project ke Vercel

- Di dashboard Vercel, klik **Add New → Project**, pilih repo GitHub yang
  baru kamu push. Framework preset biarkan default/"Other" — Vercel otomatis
  kenali folder `api/` sebagai serverless function dan folder `public/`
  sebagai static files. Jangan klik Deploy dulu, isi environment variables
  dulu di step berikutnya (atau isi setelah deploy pertama lalu redeploy).

### 3. Tambah database gratis (Neon, lewat tab Storage Vercel)

- Di project Vercel kamu, buka tab **Storage** → **Create Database** → pilih
  **Neon (Postgres)**. Ikuti langkah setup-nya (gratis, ga perlu kartu
  kredit). Setelah dibuat, Vercel otomatis nambahin environment variable
  koneksi database ke project kamu — biasanya bernama `DATABASE_URL` (kalau
  namanya beda, cek di tab **Settings → Environment Variables** dan sesuaikan
  nama variabelnya, atau samakan dengan yang dipakai `db.js`, yaitu
  `DATABASE_URL`).

### 4. Isi environment variables lain

Di **Settings → Environment Variables**, tambahkan:

| Key | Value |
|---|---|
| `SESSION_SECRET` | teks acak panjang, bebas (contoh: hasil dari `openssl rand -hex 32`) |
| `ADMIN_USERNAME` | username admin pertama (misal `sherly`) |
| `ADMIN_PASSWORD` | password admin pertama — **ganti setelah pertama kali login lewat fitur di aplikasinya sendiri kalau mau lebih aman, atau cukup pakai password yang kuat dari awal** |
| `ADMIN_NAME` | nama kamu, misal `Sherly` |
| `NODE_ENV` | `production` |

### 5. Deploy

- Klik **Deploy**. Setelah selesai, Vercel kasih kamu URL (misal
  `https://job-platform-xxx.vercel.app`). Buka URL itu, login pakai
  `ADMIN_USERNAME` / `ADMIN_PASSWORD` yang tadi kamu isi.

Selesai — platform-nya sudah live dan bisa diakses siapa saja yang kamu
kasih link + akun freelancer-nya, tanpa perlu mereka install/daftar apa-apa.

### Catatan soal free tier

- **Vercel Hobby (gratis)**: cukup untuk skala tim kecil (<10 freelancer).
  Batas upload file per request sekitar 4.5 MB — cukup untuk file xlsx/PDF
  job profile biasa.
- **Neon free tier**: 10 GB storage, lebih dari cukup untuk data teks job
  profile. Database akan "tidur" kalau tidak dipakai beberapa saat, tapi
  otomatis bangun lagi begitu ada yang buka platform-nya (cuma delay
  beberapa detik di request pertama, ga hilang datanya).
- Login pakai session yang disimpan di database (bukan di memory), jadi
  aman dari "logout sendiri" walau server sempat idle/restart.

## Cara upload job profile

1. Login sebagai admin → tab **Upload Job Baru**.
2. Upload file `.xlsx` atau `.pdf` sesuai template Job Profile Form yang
   biasa kamu pakai (Job Title, Department, Direct Report to, Position Type,
   Placement, Office Hours, Travel Required, Job Descriptions, Job
   Requirements, Preferred Skills, Special Requirements, Salary Range).
3. Klik **Parse File** → semua field muncul otomatis di form, termasuk
   industry yang ke-detect otomatis.
4. Cek & edit kalau ada yang kurang pas, pilih freelancer yang mau di-assign,
   set status, lalu **Simpan Job**.

Selama format file masih mengikuti pola "Label : Isi" seperti template kamu,
parsernya akan otomatis mengenali field-nya walau urutan barisnya sedikit
beda. Kalau ada field yang gagal ke-extract (misal karena template berubah
banyak), tinggal isi manual di form sebelum disimpan — tidak akan menghambat
proses.

## Cara kerja auto-detect industry (gratis, bukan AI berbayar)

Deteksi industri di `industry.js` berbasis pencarian kata kunci: setiap
kategori (misal "Beauty, Cosmetics & Wellness", "Retail & FMCG", "Banking &
Financial Services", dll) punya daftar kata kunci Indonesia & Inggris. Waktu
job di-upload, teks dari job title + description + requirements dicek, dan
kategori dengan kecocokan kata kunci terbanyak yang dipilih. Kalau
confidence-nya rendah (kata kunci yang cocok dikit/ga ada), platform akan
kasih tanda supaya kamu cek manual — dan hasil deteksi selalu bisa diedit
manual sebelum job disimpan.

Kalau mau nambah kategori industri baru atau nambah kata kunci ke kategori
yang sudah ada (misal supaya lebih presisi sesuai jenis klien kamu),
tinggal edit array `CATEGORIES` di file `industry.js`, lalu deploy ulang
(push ke GitHub, Vercel otomatis redeploy).

## Kelola freelancer

- Tab **Kelola Freelancer** (admin) untuk tambah akun freelancer baru
  (nama, username, password — kasih tau manual ke freelancer-nya).
- Admin bisa nonaktifkan akun freelancer (tanpa hapus datanya) atau reset
  password kapan saja.
- Freelancer login pakai username/password yang kamu buatkan, dan cuma bisa
  lihat + update status job yang di-assign ke mereka (tidak bisa lihat job
  freelancer lain, tidak bisa upload job baru, tidak bisa reassign).

## Catatan teknis (kalau suatu saat perlu developer lain lanjutin)

- Backend: Node.js + Express, jalan sebagai satu serverless function di
  Vercel (`api/index.js`), routing di-atur lewat `vercel.json`.
- Database: PostgreSQL (lewat Neon), tabel `users`, `jobs`, `job_notes`,
  plus tabel `session` otomatis dibuat oleh `connect-pg-simple` untuk
  nyimpen session login.
- Parsing xlsx pakai library **SheetJS (xlsx)** — sengaja diarahkan ke build
  resmi dari `cdn.sheetjs.com` di `package.json` (bukan versi di npm
  registry), karena versi npm-nya ada advisory keamanan lama yang belum
  di-patch di registry. Ini aman dipakai karena yang upload file cuma admin
  (bukan publik), tapi tetap dipilih versi yang sudah di-patch untuk jaga-jaga.
- Parsing PDF pakai **pdfjs-dist** (library resmi dari Mozilla, dipakai juga
  di Firefox), murni JavaScript jadi jalan lancar di Vercel tanpa perlu
  install program tambahan.
- Tidak ada API AI berbayar yang dipakai sama sekali di aplikasi ini — semua
  gratis dan jalan sendiri di server.

# Fanpage Automator — Netlify

Panel web untuk mengelola postingan Fanpage Facebook secara terjadwal, yang
**jalan 24/7 di Netlify Functions + Blobs** (free tier, **tanpa beli domain**)
— tidak perlu komputer menyala.

Cara kerjanya sama seperti versi Cloudflare-nya, tapi semua pindah ke Netlify:

- **Multi-akun Page Facebook** — tambah banyak Page, pilih yang aktif.
  Hubungkan lewat tombol **"Hubungkan Page Facebook"** (Facebook Login /
  OAuth, token tersimpan otomatis) atau isi Page Access Token manual.
- **Maks. 10 link tujuan yang digilir** (1, 2, 3, lalu ulang). Tiap link punya
  Nama (dipakai sebagai judul kartu), URL tujuan (link Shopee Affiliate), dan
  galeri gambar sendiri atau ikut galeri umum.
- **Jadwal otomatis (WIB) + toggle AUTO**, mode Manual atau API Graph,
  mode gambar **1 gambar** atau **Album** (semua gambar galeri).
- **Caption AI** — tombol "Tulis Ulang Caption dengan AI" memakai Gemini
  (butuh env var `GEMINI_API_KEY`); bila belum diset, memakai template biasa.
- **Halaman jembatan** — `https://<alamat-situs>/go/<nomor>` mengalihkan
  (HTTP 302) ke link tujuan dan mencatat klik ke log. Gambar produk bisa
  dibuka publik lewat `https://<alamat-situs>/img/...`.
- **Bulk Post Manual** — siapkan + terbitkan N postingan berikutnya
  sekaligus (1–10) dari antrian giliran. Gagal di satu postingan tidak
  menghentikan sisanya. Satu pemanggilan function dibatasi 30 detik: bila
  waktu habis, hasilnya dilaporkan parsial dan sisanya bisa dilanjutkan.
- **Cron 24/7** — Scheduled Function memeriksa jadwal tiap 5 menit. Satu
  jadwal hanya dieksekusi 1x. Bila mode Manual, muncul banner
  "Saatnya posting!".
- **Log** — semua event tercatat di Blobs (maks 200 entri terakhir).

> **Data contoh:** link 1 dan 2 sudah terisi placeholder
> `https://shopee.co.id/CONTOH-PRODUK-1` dengan label "CONTOH" — **ganti
> dengan link affiliate kamu** dari dashboard Shopee Affiliate sebelum
> dipakai posting.

---

## A. Deploy dari nol (langkah demi langkah)

### 1. Akun Netlify gratis

1. Buka [app.netlify.com](https://app.netlify.com) → **Sign up** (gratis,
   hanya butuh email).
2. Tidak perlu beli domain — situs bisa jalan di alamat
   `https://<nama-situs>.netlify.app` bawaan, dan domain sendiri dipasang
   belakangan bila mau (langkah 6).

### 2. Install Netlify CLI di komputermu

Butuh Node.js 18+ terinstal. Di terminal:

```bash
npm install -g netlify-cli
netlify --version
```

### 3. Login Netlify CLI ke akunmu

```bash
netlify login
```

Browser akan terbuka — izinkan aksesnya.

### 4. Deploy (cara CLI)

```bash
cd fanpage-automator-netlify
npm install
netlify deploy --prod
```

- Saat pertama kali, CLI bertanya: **Create & configure a new site?** →
  pilih **Yes**. **Team** → pilih tim kamu. **Site name** → isi nama situs
  (mis. `fanpage-automator`) — ini menjadi alamat
  `https://fanpage-automator.netlify.app` (ganti bila sudah dipakai orang).
  **Publish directory** → ketik `public`.
- Perintah di atas men-deploy situs + kedua function (`app` dan
  `scheduled-post`) sekaligus. Blobs store `fanpage-automator` dibuat
  otomatis saat pertama kali dipakai — tidak ada yang perlu dibuat manual.

### 4b. Deploy (cara hubungkan repo Git — alternatif tanpa CLI)

1. Upload folder ini ke repo Git (GitHub/GitLab/Bitbucket).
2. Di dashboard Netlify → **Add new site** → **Import an existing project**
   → pilih repo itu.
3. **Build command** → kosongkan (tidak ada build step). **Publish
   directory** → `public`. **Functions directory** → `netlify/functions`.
4. Klik **Deploy**. Setiap push ke repo akan deploy ulang otomatis.

### 5. Isi env vars di dashboard (kata sandi & kunci API — JANGAN ditulis di file)

Di dashboard Netlify → pilih situs → **Site settings** → **Environment
variables** → **Add a variable** (scope: **All**):

| Variable | Wajib? | Isi |
|---|---|---|
| `ADMIN_PASSWORD` | Sangat dianjurkan | Kata sandi admin panel (bebas, mis. 12+ karakter acak) |
| `GEMINI_API_KEY` | Opsional (caption AI) | API key Gemini dari Google AI Studio (gratis) |
| `FB_APP_ID` | Opsional (Facebook Login) | App ID dari Facebook App kamu |
| `FB_APP_SECRET` | Opsional (Facebook Login) | App Secret dari Facebook App kamu |

Setelah menambah/mengubah env var, deploy ulang supaya berlaku:

```bash
netlify deploy --prod
```

Bila sebuah env var belum diset, fitur terkait tetap jalan dengan mode
cadangan: tanpa `ADMIN_PASSWORD` panel terbuka tanpa kunci (ada peringatan
di panel); tanpa `GEMINI_API_KEY` tombol AI memakai template; tanpa
`FB_APP_ID`/`FB_APP_SECRET` tombol "Hubungkan Page Facebook" menampilkan
instruksi isi token manual.

### 6. Buka panel — selesai, sudah 100% gratis

Buka alamat situsmu, mis. `https://fanpage-automator.netlify.app` — panel
harus tampil. **Sampai di sini semuanya sudah gratis dan lengkap,
termasuk auto-posting:** begitu kamu membuka panel sekali, alamat
`netlify.app` itu tercatat otomatis dan dipakai untuk link jembatan
(`/go/...`) dan gambar (`/img/...`). Tidak perlu beli domain.

Domain sendiri hanya opsional (supaya alamat lebih pendek/bermerek). Bila
mau memasangnya belakangan:

1. Di dashboard Netlify → situsmu → **Domain management** → **Add a
   domain** → ketik domainmu, mis. `fanpage.domainmu.com` → **Add**.
2. Netlify menampilkan DNS yang harus dipasang di registrar domainmu
   (atau, bila nameserver domain sudah diarahkan ke Netlify, DNS dibuat
   otomatis).
3. Setelah domain aktif, buka panel lewat `https://fanpage.domainmu.com`,
   lalu isi kolom **"Domain publik situs ini"** di tab **Akun** dengan
   `fanpage.domainmu.com` (tanpa `https://`). Domain ini dipakai untuk
   link jembatan (`/go/...`) dan gambar (`/img/...`) di postingan —
   menggantikan alamat `netlify.app`.

### 7. Memeriksa cron (Scheduled Function)

Cron tertulis inline di `netlify/functions/scheduled-post.mjs`
(`schedule: "*/5 * * * *"` — tiap 5 menit). Deploy di langkah 4 sudah
mengaktifkannya. Memeriksa:

- Dashboard → situsmu → **Functions** → klik `scheduled-post` → bagian
  **Schedule** harus menampilkan `*/5 * * * *`.
- Mengubah jadwal cron: ubah baris `schedule` di
  `netlify/functions/scheduled-post.mjs` lalu deploy ulang. Catatan:
  kode tetap memeriksa jadwal posting dengan toleransi 10 menit, jadi
  jadwal tidak terlewat bila trigger datang beberapa menit terlambat.
- **Penting:** cron hanya jalan di **production deploy** (bukan Deploy
  Preview). Log function di dashboard hanya tersimpan 24 jam.

### 8. (Opsional) Uji lokal sebelum deploy

```bash
npm install
node test-harness.mjs   # 40+ pemeriksaan otomatis (mock Blobs/Graph API/Gemini)
netlify dev              # panel jalan di http://localhost:8888 (Blobs lokal/emulasi)
```

---

## B. Hubungkan Page Facebook

Ada 2 cara. **Cara 1 (paling mudah)** bila kamu sudah membuat Facebook App
dan mengisi env var `FB_APP_ID` / `FB_APP_SECRET`:

### Cara 1 — Facebook Login (OAuth, sekali klik)

1. Buka panel → tab **Akun** → klik **"Hubungkan Page Facebook"**.
2. Login Facebook, pilih Page yang mau dihubungkan, izinkan aksesnya.
3. Selesai — Page + Page Access Token tersimpan otomatis dan menjadi akun
   aktif. Token berlaku **~60 hari**; bila kedaluwarsa, klik tombol yang
   sama untuk menghubungkan ulang.

#### Membuat Facebook App (sekali saja, ~10 menit)

1. Buka [developers.facebook.com](https://developers.facebook.com) →
   **My Apps** → **Create App** → pilih tipe **Other** → **Business**.
2. Isi nama aplikasi (bebas, mis. "Fanpage Automator Saya") → **Create**.
3. Di dashboard aplikasi, cari **Facebook Login** → **Set Up** (atau
   **Add Product** → Facebook Login).
4. Di menu **Facebook Login → Settings**, isi **Valid OAuth Redirect URIs**
   dengan alamat callback situs kamu:
   `https://fanpage-automator.<namamu>.netlify.app/auth/callback`
   (pakai alamat `netlify.app` kamu bila belum memasang domain sendiri;
   bila sudah, ganti dengan `https://fanpage.domainmu.com/auth/callback`.
   Harus sama persis dengan alamat panel.)
5. Di **Settings → Basic**, salin **App ID** dan **App Secret** → set
   sebagai env var (langkah A.5) → deploy ulang.
6. **Penting:** aplikasi boleh tetap berstatus **Development** — untuk
   Page yang kamu kelola sendiri sebagai admin, itu sudah cukup untuk
   posting. **App Review** (peninjauan Facebook) hanya dibutuhkan bila
   aplikasi dipakai oleh orang lain.

### Cara 2 — Isi token manual (tanpa Facebook App)

1. Buka [Graph API Explorer](https://developers.facebook.com/tools/explorer/)
   (butuh aplikasi Facebook apa pun — bisa pakai aplikasi yang sama
   seperti di atas, atau aplikasi contoh).
2. Pilih aplikasi → **User Token** → tambahkan izin
   `pages_manage_posts`, `pages_read_engagement`, `pages_show_list` →
   **Generate Access Token** → pilih Page kamu.
3. Token yang didapat berlaku singkat — tukar ke token panjang (~60 hari)
   dengan membuka URL ini di browser (ganti `APP_ID`, `APP_SECRET`,
   `TOKEN_PENDEK`):
   `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=TOKEN_PENDEK`
4. Ambil Page Access Token: buka
   `https://graph.facebook.com/v21.0/me/accounts?access_token=TOKEN_PANJANG`
   → cari Page kamu → salin `access_token` dan `id`-nya.
5. Di panel → tab **Akun** → **Tambah akun (token manual)** → isi nama,
   Page ID, dan token → **Simpan Akun**.

---

## C. Cara pakai sehari-hari

### 1. Tab Akun
- Pilih akun aktif (bila punya banyak Page).
- **Domain publik (opsional):** kosongkan bila memakai alamat `netlify.app` gratis — panel otomatis memakai alamat itu untuk link jembatan & gambar. Isi hanya bila kamu memasang domain sendiri.
- Pilih **Mode Posting**: **Manual** (bawaan — hanya menyiapkan) atau
  **API Graph** (otomatis, butuh token akun aktif).
- Pilih **Mode Gambar**: **1 gambar** atau **Album** (semua gambar galeri).

### 2. Tab Konten
- 10 slot link: isi **Nama** (judul kartu), **URL tujuan** (link Shopee
  Affiliate dari dashboard kamu), dan **Galeri** ("Ikut galeri umum" atau
  "Galeri sendiri").
- **Upload gambar** per link atau ke **Galeri umum** (JPG/PNG/GIF/WebP,
  maks 10 MB per file). Gambar bisa dihapus. Giliran berikutnya tampil di
  atas halaman.
- Klik **Simpan Konten**.

### 3. Tab Posting
- **Jadwal posting** — tambah/hapus jam (HH:MM, WIB; bawaan 19:00).
- **Tombol AUTO** — aktifkan supaya jadwal berjalan otomatis 24/7.
- **Template caption** — bisa diedit; placeholder `{nama}` dan `{link}`.
- **Siapkan Postingan Berikutnya** — menghitung link berikutnya sesuai
  giliran, caption jadi, dan link jembatan. Ada pratinjau gambar +
  tombol **Salin Caption**, **Tulis Ulang Caption dengan AI**,
  **Salin Link Jembatan**, **Buka Facebook**, dan **Ekspor HTML Redirect**.
- **Bulk Post** — isi jumlah (1–10) lalu **Jalankan Bulk Post**: N
  postingan berikutnya disiapkan sekaligus; bila mode API Graph, langsung
  diterbitkan satu per satu (gagal di satu postingan tidak menghentikan
  sisanya; hasilnya tampil di bawah + di tab Log). Bila waktu 25 detik
  habis di tengah jalan, hasilnya dilaporkan parsial dan sisanya bisa
  dilanjutkan dengan menjalankan Bulk Post lagi.

### 4. Tab Log
Tabel semua event (simpan, siapkan, klik jembatan, jadwal jatuh tempo,
hasil auto-posting/bulk, error). Token tidak pernah dicatat ke log.

### Alur posting ke Facebook
- **Mode Manual:** saat jam jadwal tiba, panel menampilkan banner
  **"Saatnya posting!"**. Buka tab Posting → salin caption → buka
  Facebook → buat postingan di Page → upload foto → tempel caption →
  terbitkan. Link tujuan: tempel link jembatan
  (`https://<alamat-situs>/go/<n>`) di caption atau komentar pertama.
- **Mode API Graph:** saat jam jadwal tiba, Scheduled Function menerbitkan
  sendiri: mode **1 gambar** = link post (caption + link jembatan yang
  bisa diklik + gambar pertama sebagai pratinjau); mode **Album** =
  postingan multi-foto + link jembatan. Hasilnya tercatat di tab Log; bila
  gagal, banner menampilkan errornya dan tidak ada retry.

---

## D. Batasan jujur — baca sebelum berharap lebih

- **100% gratis, tanpa beli domain.** Akun Netlify gratis + alamat
  `*.netlify.app` bawaan sudah cukup untuk semua fitur, termasuk
  auto-posting (panel otomatis memakai alamat `netlify.app` itu untuk link
  jembatan dan gambar). Domain sendiri hanya perlu bila kamu mau alamat
  yang lebih pendek/bermerek: `.com` umumnya sekitar Rp 150–250 ribu/tahun,
  `.my.id` sekitar Rp 10–25 ribu/tahun (harga registrar, bisa berubah).
- **Cron hanya jalan di production deploy** (bukan Deploy Preview). Bila
  kamu menguji lewat Deploy Preview, jadwal tidak akan dieksekusi.
- **Tiap invokasi function dibatasi 30 detik.** Satu jadwal hanya
  menerbitkan 1 postingan (cepat, aman). Bulk Post memakai anggaran waktu
  lunak ~25 detik: bila habis, hasilnya dilaporkan parsial (sukses/gagal/
  sisa belum dicoba) dan sisanya bisa dilanjutkan dengan menjalankan Bulk
  Post lagi — function tidak akan timeout tanpa respons.
- **Paket gratis Netlify = 300 credits/bulan (dipakai bersama semua
  project di akun).** Perkiraan pemakaian tool ini: cron tiap 5 menit =
  ~8.640 invokasi/bulan (sangat ringan, sebagian besar hanya memeriksa
  jadwal lalu selesai), ditambah beberapa ratus request panel + posting
  per bulan. Untuk pemakaian fanpage biasa (beberapa posting per hari)
  ini jauh di bawah batas. Bila credits habis, semua project di akun
  dijeda sampai reset bulanan — periksa pemakaian di dashboard
  (Site settings → Usage).
- **Log function di dashboard Netlify hanya tersimpan 24 jam.** Log
  panel (tab Log) tersimpan di Blobs (maks 200 entri) dan tidak terhapus
  oleh batas itu.
- **Blobs bersifat eventual consistency** — tulisan langsung bisa dibaca,
  tapi update/delete bisa butuh sampai ~60 detik untuk menyebar ke semua
  lokasi baca. Blobs BUKAN database: jangan pakai untuk counter
  transaksional. Untuk tool ini (pengaturan, link, galeri, log) perilaku
  itu sudah cukup.
- **Butuh Facebook App + izin `pages_manage_posts`.** Untuk Page yang
  kamu kelola sendiri sebagai admin, aplikasi berstatus Development sudah
  cukup (tanpa App Review). App Review hanya bila aplikasi dipakai orang
  lain. **Token Page berlaku ~60 hari** dan harus dihubungkan ulang bila
  kedaluwarsa (klik tombol "Hubungkan Page Facebook" lagi).
- **Gambar produk di Blobs bersifat publik lewat `/img/`.** Siapa pun yang
  tahu URL gambarnya bisa membukanya (Blobs tidak punya access control
  bawaan). Jangan upload gambar yang bersifat rahasia. Foto produk yang
  dipakai harus yang kamu punya hak pakainya.
- **Deploy sungguhan + Facebook Login sungguhan + auto-posting ke Page
  sungguhan BELUM diuji end-to-end.** Yang sudah diuji: `node --check`
  semua file `.mjs` dan `node test-harness.mjs` (40+ pemeriksaan otomatis
  dengan mock Blobs, Graph API, dan Gemini — semua lolos). Deploy ke
  Netlify sungguhan, Facebook Login sungguhan, dan posting ke Page
  sungguhan belum dicoba — laporkan error dari tab Log bila ada yang
  gagal.
- **Panel ini tidak membuat link komisi Shopee.** Link affiliate HARUS
  dari dashboard Shopee Affiliate-mu. Aplikasi hanya memakai link itu
  sebagai tujuan.
- **Kunci panel dengan `ADMIN_PASSWORD`.** Tanpa env var itu, siapa pun
  yang menemukan alamat situs bisa membuka panel dan melihat token
  Page kamu. Env var itu gratis dan hanya perlu diset sekali.
- **Caption AI memakai Gemini (env var `GEMINI_API_KEY`).** Kunci API
  didapat gratis dari Google AI Studio. Bila env var belum diset atau
  API gagal, tombol AI otomatis memakai template biasa dan memberi tahu
  alasannya — tidak ada caption kosong.
- Bila auto-posting gagal (token salah/kedaluwarsa, izin kurang, alamat
  publik belum tercatat, jaringan putus), function hanya mencoba **1x
  per jadwal**, mencatat error ke log, dan menampilkan banner. Tidak ada
  retry berulang — supaya tidak membanjiri Facebook dengan percobaan gagal.

---

## Struktur folder

```
netlify.toml                  # build (functions + publish) + redirect /* -> function app
package.json                  # type module + dependencies @netlify/blobs, @netlify/functions
public/
  index.html                  # placeholder (semua halaman dilayani function app)
netlify/functions/
  app.mjs                     # function utama: SEMUA rute panel
  scheduled-post.mjs          # Scheduled Function: cron */5 * * * *
  lib/
    store.mjs                 # lapisan Blobs (makeEnv: LINKS_KV + IMAGES)
    logic.mjs                 # rotasi, caption, jembatan, Graph API, Gemini, OAuth, scheduler
    panel.mjs                 # tampilan HTML panel (tab Akun/Konten/Posting/Log)
    router.mjs                # aksi form + routing HTTP (handleRequest)
seed.json                     # data contoh (link + pengaturan bawaan) — dokumentasi/cadangan
test-harness.mjs              # 40+ pemeriksaan otomatis lokal (mock Blobs/Graph/Gemini)
README.md                     # file ini
```

## Perintah yang sering dipakai

```bash
npm install                    # install dependencies (@netlify/blobs, @netlify/functions)
node test-harness.mjs          # jalankan 40+ pemeriksaan lokal
netlify dev                    # jalankan lokal (http://localhost:8888)
netlify deploy --prod          # deploy / deploy ulang ke production
netlify env:set ADMIN_PASSWORD # set/ubah env var dari CLI (lalu deploy ulang)
netlify env:list               # lihat daftar env var (bukan nilainya)
netlify functions:invoke app --payload '{}'   # panggil function app secara manual
```

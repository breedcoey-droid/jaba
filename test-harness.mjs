/**
 * Test harness lokal untuk Fanpage Automator — Netlify.
 *
 * Menjalankan handler app (lib/router.mjs) + scheduler (lib/logic.mjs)
 * dengan mock Blobs store + mock fetch (Graph API / Gemini), TANPA deploy.
 * Cara pakai:  node test-harness.mjs
 *
 * Yang diuji (meniru 40 pemeriksaan versi Cloudflare):
 *  1. GET / -> 200, panel tampil, auto_host tercatat
 *  2. GET /go/1 -> 302 ke URL contoh + klik tercatat di log
 *  3. Upload gambar mock -> GET /img/<key> -> 200, byte sama
 *  4. Rotasi: siapkan 3x -> link 1, 2, 1
 *  5. runScheduled() saat jadwal jatuh tempo -> log + banner, TIDAK double-fire
 *  5b. runScheduled() mode API tanpa domain & tanpa auto_host -> dilewati
 *  5c. runScheduled() mode API dengan auto_host netlify.app -> auto-posting jalan
 *  6. Caption AI tanpa GEMINI_API_KEY -> fallback template + pesan jelas
 *  7. Caption AI dengan key (fetch Gemini di-mock) -> ai:true
 *  8. Bulk Post mode API, fetch Graph di-mock (2 sukses + 1 gagal) -> 2 sukses tercatat, 1 error, sisanya tetap jalan
 *  8b. Bulk Post dengan anggaran waktu habis -> parsial, sisa belum dicoba
 *  9. Bulk Post mode Album (upload foto di-mock) -> attached_media berisi 2 photo id
 * 10. GET /auth/login tanpa FB_APP_ID -> redirect dengan pesan "belum disiapkan"
 * 11. config Scheduled Function -> schedule cron tiap 5 menit
 * 12. GET /health -> 200 + GET /img/tidak-ada -> 404
 *
 * Catatan: harness mengimpor handler yang SAMA dengan yang dipakai kedua
 * function Netlify (handleRequest dari lib/router.mjs = isi app.mjs, dan
 * runScheduled dari lib/logic.mjs = isi scheduled-post.mjs). Yang tidak
 * diuji di sini: makeEnv(null) dengan Blobs asli (butuh runtime Netlify)
 * dan deploy sungguhan.
 */
import { handleRequest } from "./netlify/functions/lib/router.mjs";
import { runScheduled, bulkPost, loadLinks, loadSettings } from "./netlify/functions/lib/logic.mjs";
import { makeEnv } from "./netlify/functions/lib/store.mjs";
import schedFn, { config as schedConfig } from "./netlify/functions/scheduled-post.mjs";

/* ---------- mock Blobs store (antarmuka @netlify/blobs) ---------- */
class MockBlobsStore {
  constructor() { this.map = new Map(); }
  async set(key, value, opts = {}) {
    let data;
    if (typeof value === "string") data = value;
    else if (value instanceof ArrayBuffer) data = new Uint8Array(value);
    else if (value instanceof Uint8Array) data = value;
    else if (value instanceof Blob) data = new Uint8Array(await value.arrayBuffer());
    else data = new Uint8Array(await new Response(value).arrayBuffer());
    this.map.set(key, { data, metadata: opts.metadata || {} });
  }
  async setJSON(key, value) { await this.set(key, JSON.stringify(value)); }
  async get(key, opts = {}) {
    const e = this.map.get(key);
    if (!e) return null;
    const type = opts.type || "text";
    if (type === "json") {
      const s = typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data);
      return JSON.parse(s);
    }
    if (type === "arrayBuffer") {
      const b = typeof e.data === "string" ? new TextEncoder().encode(e.data) : e.data;
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    }
    if (type === "blob") return new Blob([e.data]);
    if (type === "stream") return new Response(e.data).body;
    return typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data);
  }
  async getWithMetadata(key, opts = {}) {
    const e = this.map.get(key);
    if (!e) return null;
    return { data: await this.get(key, opts), metadata: e.metadata || {} };
  }
  async delete(key) { this.map.delete(key); }
  async list({ prefix } = {}) {
    const keys = [...this.map.keys()].filter((k) => !prefix || k.startsWith(prefix));
    return { blobs: keys.map((k) => ({ key: k })) };
  }
}

/* ---------- util ---------- */
const BASE = "http://fanpage.test";
function jsonResp(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
const PNG_1X1 = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
), (c) => c.charCodeAt(0));

let passed = 0, failed = 0;
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
}

async function postAction(env, fields, files = []) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const f of files) fd.append("files", f.blob, f.name);
  const req = new Request(`${BASE}/action`, { method: "POST", body: fd });
  return handleRequest(req, env);
}

async function getJson(env, key) { return env.LINKS_KV.get(key, "json"); }
async function setSettings(env, patch) {
  const s = (await getJson(env, "settings")) || {};
  await env.LINKS_KV.put("settings", JSON.stringify({ ...s, ...patch }));
  return { ...s, ...patch };
}

/* ---------- mock fetch (Graph API + Gemini), bisa dikonfigurasi per tes ---------- */
const graphCalls = [];
let feedQueue = [];   // antrean hasil /feed: {ok:{id}} atau {error:'pesan'}
let photoSeq = 0;
let geminiMode = "ok"; // "ok" | "error"
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith("https://graph.facebook.com")) {
    graphCalls.push({ url: u, method: opts.method || "GET", body: opts.body ? String(opts.body) : "" });
    if (u.includes("/photos")) { photoSeq++; return jsonResp({ id: `photo_${photoSeq}` }); }
    if (u.includes("/feed")) {
      const next = feedQueue.shift() || { ok: { id: "post_default" } };
      if (next.ok) return jsonResp(next.ok);
      return jsonResp({ error: { message: next.error } }, 400);
    }
    if (u.includes("/oauth/access_token") || u.includes("/me/accounts")) return jsonResp({ data: [] });
    return jsonResp({});
  }
  if (u.includes("generativelanguage.googleapis.com")) {
    if (geminiMode === "error") return jsonResp({ error: { message: "API key tidak valid (simulasi)" } }, 400);
    return jsonResp({ candidates: [{ content: { parts: [{ text: "Jas hujan gamis ini bahannya tebal dan nyaman dipakai.\nKlik gambar untuk melihat detailnya ✨\n#affiliate" }] } }] });
  }
  throw new Error("fetch tak terduga: " + u);
};

/* ---------- kontrol waktu (Date.now) ---------- */
const realNow = Date.now;
let nowOverride = null;
Date.now = () => (nowOverride === null ? realNow() : nowOverride);

/* ---------- env mock ---------- */
async function makeMockEnv() {
  return makeEnv(new MockBlobsStore(), {
    FB_APP_ID: "", FB_APP_SECRET: "", GEMINI_API_KEY: "", ADMIN_PASSWORD: "",
  });
}

async function run() {
  const env = await makeMockEnv();

  console.log("1. GET / (panel)");
  let r = await handleRequest(new Request(`${BASE}/`), env);
  let txt = await r.text();
  check("status 200", r.status === 200, `(dapat ${r.status})`);
  check("judul panel tampil", txt.includes("Fanpage Automator"));
  check("branding Netlify tampil", txt.includes("Netlify"));
  const s0 = await getJson(env, "settings");
  check("auto_host tercatat otomatis (fanpage.test)", s0.auto_host === "fanpage.test", `(dapat ${s0.auto_host})`);

  console.log("2. GET /go/1 (jembatan)");
  r = await handleRequest(new Request(`${BASE}/go/1`, { headers: { "User-Agent": "harness/1.0" } }), env);
  check("status 302", r.status === 302, `(dapat ${r.status})`);
  check("Location ke URL contoh", (r.headers.get("Location") || "") === "https://shopee.co.id/CONTOH-PRODUK-1", `(dapat ${r.headers.get("Location")})`);
  const log1 = await getJson(env, "log");
  check("klik tercatat di log", (log1.entries || []).some((e) => e.jenis === "jembatan" && e.pesan.includes("link 1")), `(log: ${JSON.stringify((log1.entries || []).slice(-1))})`);

  console.log("3. Upload gambar mock -> GET /img/<key>");
  const fd = new FormData();
  fd.append("aksi", "upload");
  fd.append("slot", "1");
  fd.append("files", new Blob([PNG_1X1], { type: "image/png" }), "test.png");
  r = await handleRequest(new Request(`${BASE}/action`, { method: "POST", body: fd }), env);
  check("upload redirect 303", r.status === 303, `(dapat ${r.status})`);
  r = await handleRequest(new Request(`${BASE}/img/link/1/test.png`), env);
  check("GET /img 200", r.status === 200, `(dapat ${r.status})`);
  const imgBytes = new Uint8Array(await r.arrayBuffer());
  check("byte gambar identik", imgBytes.length === PNG_1X1.length && imgBytes.every((b, i) => b === PNG_1X1[i]), `(dapat ${imgBytes.length} byte)`);
  check("Content-Type image/png", (r.headers.get("Content-Type") || "").includes("image/png"), `(dapat ${r.headers.get("Content-Type")})`);

  console.log("4. Rotasi: siapkan 3x -> link 1, 2, 1");
  const prepared = [];
  for (let i = 0; i < 3; i++) {
    await postAction(env, { aksi: "siapkan" });
    const s = await getJson(env, "settings");
    prepared.push(s.preview.link_n);
  }
  check("urutan 1,2,1", JSON.stringify(prepared) === "[1,2,1]", `(dapat ${JSON.stringify(prepared)})`);
  const sRot = await getJson(env, "settings");
  check("giliran berikutnya kembali ke 2", sRot.next_link === 2, `(dapat ${sRot.next_link})`);

  console.log("5. runScheduled() saat jadwal jatuh tempo (WIB 19:00)");
  // WIB 19:00 = UTC 12:00 pada 2026-11-20
  nowOverride = Date.UTC(2026, 10, 20, 12, 0, 0);
  await setSettings(env, { schedule: ["19:00"], auto: true, mode: "manual", last_fired: "" });
  const logBefore = (await getJson(env, "log")).entries.filter((e) => e.jenis === "jadwal").length;
  await runScheduled(env);
  const logAfter1 = await getJson(env, "log");
  const jadwalCount1 = logAfter1.entries.filter((e) => e.jenis === "jadwal").length;
  const sSched = await getJson(env, "settings");
  check("log mencatat jadwal jatuh tempo", jadwalCount1 === logBefore + 1, `(sebelum ${logBefore}, sesudah ${jadwalCount1})`);
  check("banner 'Saatnya posting!' tampil", (sSched.banner || "").includes("Saatnya posting!"), `(banner: ${sSched.banner})`);
  check("last_fired tercatat", sSched.last_fired === "2026-11-20 19:00", `(dapat ${sSched.last_fired})`);
  await runScheduled(env);
  const jadwalCount2 = (await getJson(env, "log")).entries.filter((e) => e.jenis === "jadwal").length;
  check("tidak double-fire (panggilan ke-2 tidak menambah log jadwal)", jadwalCount2 === jadwalCount1, `(dapat ${jadwalCount2})`);
  nowOverride = null;

  console.log("5b. runScheduled() mode API tanpa domain DAN tanpa auto_host -> dilewati, tanpa panggilan Graph");
  nowOverride = Date.UTC(2026, 10, 20, 12, 0, 0);
  await setSettings(env, {
    schedule: ["19:00"], auto: true, mode: "api", domain: "", auto_host: "", last_fired: "",
    accounts: [{ id: "acc1", name: "Toko Tes", page_id: "123456", token: "TOKEN-PALSU" }],
    active_account: "acc1",
  });
  graphCalls.length = 0;
  await runScheduled(env);
  const sNoDom = await getJson(env, "settings");
  check("banner menjelaskan alamat publik belum tersedia", (sNoDom.banner || "").includes("belum ada alamat publik"), `(banner: ${sNoDom.banner})`);
  check("0 panggilan Graph (tidak ada link rusak terkirim)", graphCalls.length === 0, `(dapat ${graphCalls.length})`);
  check("last_fired tetap tercatat (tidak diulang)", sNoDom.last_fired === "2026-11-20 19:00", `(dapat ${sNoDom.last_fired})`);
  nowOverride = null;

  console.log("5c. runScheduled() mode API dengan auto_host netlify.app (gratis) -> auto-posting jalan");
  nowOverride = Date.UTC(2026, 10, 20, 12, 0, 0);
  await setSettings(env, {
    schedule: ["19:00"], auto: true, mode: "api", domain: "", auto_host: "fanpage-automator.tes.netlify.app", last_fired: "",
    accounts: [{ id: "acc1", name: "Toko Tes", page_id: "123456", token: "TOKEN-PALSU" }],
    active_account: "acc1",
  });
  graphCalls.length = 0;
  await runScheduled(env);
  const sFree = await getJson(env, "settings");
  const feedFree = graphCalls.filter((c) => c.url.includes("/feed"));
  check("1 panggilan /feed ke Graph", feedFree.length === 1, `(dapat ${feedFree.length})`);
  check("link jembatan memakai netlify.app", (sFree.preview?.bridge || "").startsWith("https://fanpage-automator.tes.netlify.app/go/"), `(bridge: ${sFree.preview?.bridge})`);
  check("banner sukses auto-posting", (sFree.banner || "").includes("Auto-posting berhasil"), `(banner: ${sFree.banner})`);
  nowOverride = null;

  console.log("6. Caption AI tanpa GEMINI_API_KEY (fallback)");
  r = await handleRequest(new Request(`${BASE}/api/caption-ai`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nama: "CONTOH — Jas Hujan Gamis Wanita", url: "https://fanpage.test/go/1" }),
  }), env);
  let j = await r.json();
  check("ai:false", j.ai === false);
  check("caption = template (berisi nama + #affiliate)", j.caption.includes("CONTOH") && j.caption.includes("#affiliate"), `(dapat ${JSON.stringify(j.caption)})`);
  check("pesan jelas 'AI tidak tersedia'", (j.note || "").includes("AI tidak tersedia"), `(dapat ${j.note})`);

  console.log("7. Caption AI dengan key (Gemini di-mock)");
  env.GEMINI_API_KEY = "TEST-KEY-DARI-HARNESS";
  r = await handleRequest(new Request(`${BASE}/api/caption-ai`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nama: "CONTOH — Jas Hujan Gamis Wanita", url: "https://fanpage.test/go/1", gaya: "ceria" }),
  }), env);
  j = await r.json();
  check("ai:true", j.ai === true, `(dapat ${JSON.stringify(j)})`);
  check("caption hasil AI berisi #affiliate", (j.caption || "").includes("#affiliate"), `(dapat ${JSON.stringify(j.caption)})`);
  env.GEMINI_API_KEY = "";

  console.log("8. Bulk Post mode API (2 sukses + 1 gagal)");
  await setSettings(env, {
    mode: "api", image_mode: "single", auto: false,
    accounts: [{ id: "acc1", name: "Toko Tes", page_id: "123456", token: "TOKEN-PALSU" }],
    active_account: "acc1",
  });
  feedQueue = [{ ok: { id: "post_1" } }, { error: "Token kedaluwarsa (simulasi)" }, { ok: { id: "post_3" } }];
  graphCalls.length = 0;
  r = await postAction(env, { aksi: "bulk", jumlah: "3" });
  check("bulk redirect 303", r.status === 303, `(dapat ${r.status})`);
  const sBulk = await getJson(env, "settings");
  const bulk = sBulk.bulk_result;
  check("3 panggilan /feed ke Graph", graphCalls.filter((c) => c.url.includes("/feed")).length === 3, `(dapat ${graphCalls.length})`);
  check("2 sukses tercatat", bulk.sukses === 2, `(dapat ${bulk.sukses})`);
  check("1 gagal tercatat", bulk.gagal === 1, `(dapat ${bulk.gagal})`);
  check("total 3 postingan", bulk.total === 3, `(dapat ${bulk.total})`);
  check("tidak parsial (anggaran waktu cukup)", bulk.parsial === false, `(parsial: ${bulk.parsial})`);

  console.log("8b. Bulk Post dengan anggaran waktu habis -> parsial");
  const linksObj = await loadLinks(env);
  const settingsB = await loadSettings(env);
  const resParsial = await bulkPost(env, settingsB, linksObj, "fanpage.test", 3, Date.now() - 1);
  check("0 postingan dicoba", resParsial.total === 0, `(dapat ${resParsial.total})`);
  check("parsial:true, sisa 3", resParsial.parsial === true && resParsial.sisa === 3, `(parsial: ${resParsial.parsial}, sisa: ${resParsial.sisa})`);

  console.log("9. Bulk Post mode Album (upload foto di-mock)");
  await setSettings(env, { mode: "api", image_mode: "album", next_link: 1 });
  // Pastikan galeri link 1 punya 2 gambar (test.png sudah ada dari tes 3; tambah satu lagi)
  const fd2 = new FormData();
  fd2.append("aksi", "upload");
  fd2.append("slot", "1");
  fd2.append("files", new Blob([PNG_1X1], { type: "image/png" }), "test2.png");
  await handleRequest(new Request(`${BASE}/action`, { method: "POST", body: fd2 }), env);
  feedQueue = [];
  graphCalls.length = 0;
  photoSeq = 0;
  r = await postAction(env, { aksi: "bulk", jumlah: "1" });
  const sAlbum = await getJson(env, "settings");
  const photoCalls = graphCalls.filter((c) => c.url.includes("/photos"));
  const feedCalls = graphCalls.filter((c) => c.url.includes("/feed"));
  check("2 upload foto ke /photos", photoCalls.length === 2, `(dapat ${photoCalls.length})`);
  check("1 panggilan /feed", feedCalls.length === 1, `(dapat ${feedCalls.length})`);
  const feedBody = feedCalls[0]?.body || "";
  check("attached_media berisi 2 photo id", feedBody.includes("photo_1") && feedBody.includes("photo_2"), `(body: ${feedBody.slice(0, 160)})`);
  check("bulk album 1 sukses", sAlbum.bulk_result?.sukses === 1, `(dapat ${JSON.stringify(sAlbum.bulk_result)})`);

  console.log("10. GET /auth/login tanpa FB_APP_ID");
  r = await handleRequest(new Request(`${BASE}/auth/login`), env);
  check("redirect 302/303", r.status === 302 || r.status === 303, `(dapat ${r.status})`);
  check("pesan 'belum disiapkan' di redirect", (r.headers.get("Location") || "").includes("belum%20disiapkan"), `(Location: ${r.headers.get("Location")})`);

  console.log("11. Config Scheduled Function");
  check("schedule '*/5 * * * *'", schedConfig && schedConfig.schedule === "*/5 * * * *", `(dapat ${JSON.stringify(schedConfig)})`);
  check("default export handler tersedia", typeof schedFn === "function");

  console.log("12. Endpoint lain");
  r = await handleRequest(new Request(`${BASE}/health`), env);
  check("GET /health 200 + ok:true", r.status === 200 && (await r.json()).ok === true, `(dapat ${r.status})`);
  r = await handleRequest(new Request(`${BASE}/img/tidak-ada.png`), env);
  check("GET /img/ yang tidak ada -> 404", r.status === 404, `(dapat ${r.status})`);

  console.log(`\nHASIL: ${passed} lolos, ${failed} gagal`);
  Date.now = realNow;
  globalThis.fetch = realFetch;
  process.exit(failed ? 1 : 0);
}

run().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });

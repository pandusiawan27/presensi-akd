// Penghubung antara aplikasi presensi dan database Upstash Redis (Vercel Storage).
// Kode akses dibaca dari Environment Variable AKD_KODE.
const U = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const T = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const OK = ["atlet", "pelatih", "sesi", "foto"];

async function redis(cmds) {
  const r = await fetch(U + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + T, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error("redis " + r.status);
  return r.json();
}

function pairs(flat) {
  const out = [];
  for (let i = 0; i < (flat || []).length; i += 2) {
    try {
      const d = JSON.parse(flat[i + 1]);
      d.id = flat[i];
      out.push(d);
    } catch (e) {}
  }
  return out;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const kode = process.env.AKD_KODE;
  if (!kode || !U || !T) return res.status(500).json({ error: "Konfigurasi server belum lengkap" });
  if (req.headers["x-akd-kode"] !== kode) return res.status(401).json({ error: "Kode akses salah" });
  try {
    if (req.method === "GET") {
      const q = req.query || {};
      if (q.ping) return res.status(200).json({ ok: true });
      if (q.foto) {
        const r = await redis([["HGET", "akd:foto", String(q.foto)]]);
        const v = r[0].result;
        return res.status(200).json({ data: v ? JSON.parse(v).data : null });
      }
      if (q.all) {
        const r = await redis([["HGETALL", "akd:atlet"], ["HGETALL", "akd:pelatih"], ["HGETALL", "akd:sesi"]]);
        return res.status(200).json({ atlet: pairs(r[0].result), pelatih: pairs(r[1].result), sesi: pairs(r[2].result) });
      }
      return res.status(400).json({ error: "Permintaan tidak dikenal" });
    }
    if (req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      if (!OK.includes(b.coll) || typeof b.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(b.id))
        return res.status(400).json({ error: "Data tidak valid" });
      if (b.op === "set") {
        if (!b.data || typeof b.data !== "object") return res.status(400).json({ error: "Data tidak valid" });
        await redis([["HSET", "akd:" + b.coll, b.id, JSON.stringify(b.data)]]);
        return res.status(200).json({ ok: true });
      }
      if (b.op === "del") {
        const c = [["HDEL", "akd:" + b.coll, b.id]];
        if (b.coll === "sesi") c.push(["HDEL", "akd:foto", b.id]);
        await redis(c);
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: "Operasi tidak dikenal" });
    }
    return res.status(405).json({ error: "Metode tidak didukung" });
  } catch (e) {
    return res.status(500).json({ error: "Kesalahan server" });
  }
};

"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const express = require("express");
const QRCode = require("qrcode");
const pino = require("pino");

const {
  Browsers,
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  areJidsSameUser,
  extractMessageContent,
  jidNormalizedUser,
  normalizeMessageContent,
  initAuthCreds,
  BufferJSON,
  proto,
} = require("@whiskeysockets/baileys");

const PORT = Number(process.env.MONKEY_WA_PORT || 3472);
const AUTH_DIR = process.env.MONKEY_WA_AUTH_DIR || path.join(os.homedir(), ".monkey", "wa-auth");
const RUNTIME_VERSION = "wa-sidecar-v5";
fs.mkdirSync(AUTH_DIR, { recursive: true });

// Drop-in replacement for Baileys' useMultiFileAuthState with ATOMIC writes
// (tmp + rename). The stock helper uses a bare writeFileSync: a crash or power
// loss mid-write truncates creds.json to 0 bytes → session lost → QR re-pair.
// That exact failure happened on 2026-06-04 (creds.json found empty).
async function useAtomicAuthState(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const fixFileName = (file) => String(file || "").replace(/\//g, "__").replace(/:/g, "-");
  const filePath = (file) => path.join(dir, fixFileName(file));
  const writeData = (data, file) => {
    const p = filePath(file);
    const tmp = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, BufferJSON.replacer));
    fs.renameSync(tmp, p); // atomic on POSIX
  };
  const readData = (file) => {
    try {
      const raw = fs.readFileSync(filePath(file), { encoding: "utf-8" });
      return JSON.parse(raw, BufferJSON.reviver);
    } catch {
      return null;
    }
  };
  const removeData = (file) => {
    try { fs.unlinkSync(filePath(file)); } catch {}
  };
  const creds = readData("creds.json") || initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            let value = readData(`${type}-${id}.json`);
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              const file = `${category}-${id}.json`;
              if (value) writeData(value, file);
              else removeData(file);
            }
          }
        },
      },
    },
    saveCreds: async () => { writeData(creds, "creds.json"); },
  };
}

const state = {
  status: "disconnected", // 'disconnected' | 'qr' | 'pairing' | 'ready' | 'failed'
  qrDataUrl: null,
  user: null,
  error: null,
  startedAt: null,
  connectedAt: null,
  lastInboxAt: null,
  lastInboxType: null,
  lastReplyAt: null,
  lastSendError: null,
  lastUpsertAt: null,
  lastUpsertType: null,
  lastUpsertRemoteJid: null,
  lastEventAt: null,
  lastEventSource: null,
  lastEventType: null,
  lastEventRemoteJid: null,
  lastEventCount: null,
  lastRejectedReason: null,
  ownerLidLearned: null,
};

let sock = null;
const logger = pino({ level: "error" });

const inbox = [];
const seenIds = new Set();
const sentByBot = new Set();

// Keep the newest half instead of clearing: a full clear() lets messages.update
// replays (30min grace) re-enter, and in self-chat the bot would re-process its
// OWN messages as user input (reply-to-self loop).
function trimSet(set, max) {
  if (set.size <= max) return;
  const keep = Array.from(set).slice(-Math.floor(max / 2));
  set.clear();
  for (const v of keep) set.add(v);
}
const HISTORY_PER_JID = 60;
const historyByJid = new Map(); // jid -> [{ id, fromBot, text, ts }]
const chatsByJid = new Map();   // jid -> { name, conversationTimestamp, unreadCount }

function registerChat(rawJid, info = {}) {
  const jid = normalizeBareJid(rawJid);
  if (!jid) return;
  if (!isDirectChat(jid)) return;
  const prev = chatsByJid.get(jid) || {};
  const name = (info.name || info.subject || prev.name || "").toString().trim() || null;
  const tsRaw = info.conversationTimestamp ?? info.t ?? prev.conversationTimestamp;
  const ts = tsRaw != null ? Number(tsRaw) : null;
  const conversationTimestamp = (ts && !Number.isNaN(ts))
    ? (ts < 1e12 ? ts * 1000 : ts)
    : (prev.conversationTimestamp || null);
  chatsByJid.set(jid, {
    name,
    conversationTimestamp,
    unreadCount: typeof info.unreadCount === "number" ? info.unreadCount : (prev.unreadCount || 0),
  });
}
// fromBot=true only for messages the agent itself sent via /wa/send.
// In self-chat, the user's own messages also have key.fromMe=true, so we
// rely on sentByBot (ids the bot generated) instead of fromMe to tell them apart.

function appendHistory(jid, entry) {
  if (!jid || !entry?.text) return;
  let arr = historyByJid.get(jid);
  if (!arr) { arr = []; historyByJid.set(jid, arr); }
  if (entry.id && arr.some(e => e.id === entry.id)) return;
  arr.push(entry);
  arr.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  if (arr.length > HISTORY_PER_JID) arr.splice(0, arr.length - HISTORY_PER_JID);
}

function recordHistoryFromMessage(msg) {
  const rawRemoteJid = String(msg?.key?.remoteJid || "");
  const remoteJid = normalizeBareJid(rawRemoteJid);
  if (!isDirectChat(remoteJid)) return;
  registerChat(remoteJid, { conversationTimestamp: messageTimestampMs(msg) });
  const text = extractMessageText(msg);
  if (!text.trim()) return;
  const id = msg.key?.id || `${Date.now()}-${Math.random()}`;
  appendHistory(remoteJid, {
    id,
    fromBot: sentByBot.has(id),
    text,
    ts: messageTimestampMs(msg) || Date.now(),
  });
}

function normalizeBareJid(jid) {
  return jidNormalizedUser(String(jid || ""));
}

const ownerBareJid = () => {
  const id = sock?.user?.id || sock?.authState?.creds?.me?.id;
  return id ? normalizeBareJid(id) : null;
};
const ownerLidJid = () => {
  const lid = sock?.user?.lid
    || sock?.authState?.creds?.me?.lid
    || state.ownerLidLearned
    || null;
  return lid ? normalizeBareJid(lid) : null;
};
function isOwnerJid(jid) {
  if (!jid) return false;
  const norm = normalizeBareJid(jid);
  const owner = ownerBareJid();
  if (owner && (norm === owner || areJidsSameUser(jid, owner))) return true;
  const lid = ownerLidJid();
  if (lid && (norm === lid || areJidsSameUser(jid, lid))) return true;
  return false;
}
function learnOwnerLid(jid) {
  if (!jid || !jid.endsWith("@lid")) return;
  const norm = normalizeBareJid(jid);
  if (!state.ownerLidLearned) state.ownerLidLearned = norm;
}

function rememberSentId(id) {
  if (!id) return;
  sentByBot.add(id);
  trimSet(sentByBot, 500);
}

function extractMessageText(msg) {
  const normalized = normalizeMessageContent(msg?.message);
  const extracted = extractMessageContent(normalized) || normalized;
  return extracted?.conversation
    || extracted?.extendedTextMessage?.text
    || extracted?.imageMessage?.caption
    || extracted?.videoMessage?.caption
    || extracted?.documentWithCaptionMessage?.message?.documentMessage?.caption
    || "";
}

function isDirectChat(jid) {
  return !!jid
    && !jid.endsWith("@g.us")
    && jid !== "status@broadcast"
    && !jid.endsWith("@broadcast");
}

function messageTimestampMs(msg) {
  const raw = msg?.messageTimestamp;
  const num = typeof raw === "number"
    ? raw
    : typeof raw?.low === "number"
      ? raw.low
      : Number(raw || 0);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return num < 1e12 ? num * 1000 : num;
}

function isRecentMessage(msg, connectedAtMs, graceMs = 120000) {
  if (!connectedAtMs) return true;
  const ts = messageTimestampMs(msg);
  if (!ts) return true;
  return ts >= connectedAtMs - graceMs;
}

function recordEvent(source, { eventType = null, remoteJid = null, count = null } = {}) {
  state.lastEventAt = new Date().toISOString();
  state.lastEventSource = source;
  state.lastEventType = eventType;
  state.lastEventRemoteJid = remoteJid;
  state.lastEventCount = Number.isFinite(count) ? count : null;
}

function coerceMessageUpdate(entry) {
  if (!entry?.update?.message) return null;
  return {
    key: entry.key,
    message: entry.update.message,
    messageTimestamp: entry.update.messageTimestamp || Math.floor(Date.now() / 1000),
  };
}

function shouldQueueMessage(msg, owner) {
  const rawRemoteJid = String(msg?.key?.remoteJid || "");
  const remoteJid = normalizeBareJid(rawRemoteJid);
  if (!owner) return { reason: "owner_missing" };
  if (!isDirectChat(remoteJid)) return { reason: `not_direct:${remoteJid || "(empty)"}` };
  const text = extractMessageText(msg);
  if (!text.trim()) return { reason: "no_text" };

  const fromMe = !!msg?.key?.fromMe;
  // Self-chat: remoteJid matches the authenticated user's own JID/LID.
  // → kind='owner', full agent capabilities downstream.
  if (isOwnerJid(rawRemoteJid)) {
    return { accepted: { from: remoteJid, text, kind: "owner" } };
  }
  // Outgoing messages we sent to a third party: never re-process.
  if (fromMe) {
    return { reason: `outgoing_skip:${remoteJid}` };
  }
  // Incoming from a third-party contact → kind='contact'. Desktop bridge
  // decides whether the persona agent is enabled for this jid.
  return { accepted: { from: remoteJid, text, kind: "contact" } };
}

function queueCandidateMessage(msg, source, graceMs = 120000) {
  if (!msg?.message) return;
  const owner = ownerBareJid();
  if (!owner) {
    state.lastRejectedReason = `${source}:owner_missing`;
    return;
  }
  const decision = shouldQueueMessage(msg, owner);
  if (!decision.accepted) {
    state.lastRejectedReason = `${source}:${decision.reason || "unknown"}`;
    return;
  }
  if (!isRecentMessage(msg, Date.parse(state.connectedAt || state.startedAt || "") || 0, graceMs)) {
    state.lastRejectedReason = `${source}:too_old`;
    return;
  }
  const id = msg.key?.id || `${Date.now()}-${Math.random()}`;
  if (sentByBot.has(id)) return;
  if (seenIds.has(id)) return;
  seenIds.add(id);
  trimSet(seenIds, 500);
  state.lastRejectedReason = null;
  state.lastInboxAt = new Date().toISOString();
  state.lastInboxType = source;
  inbox.push({
    id,
    from: decision.accepted.from,
    text: decision.accepted.text,
    kind: decision.accepted.kind || "owner",
    ts: Date.now(),
  });
}

// Single-flight restart: concurrent close events (or boot failures) must never
// spawn two parallel start() calls → two live Baileys sockets with duplicated
// event handlers (double inbox entries, double replies).
let restartTimer = null;
function scheduleRestart(delayMs) {
  if (restartTimer) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    start().catch((e) => {
      state.status = "failed";
      state.error = String(e?.message || e);
      // Boot can fail while offline (fetchLatestBaileysVersion hits the network):
      // keep retrying instead of staying dead until app restart.
      scheduleRestart(5000);
    });
  }, delayMs);
}

async function start() {
  // Tear down any previous socket before creating a new one — otherwise its
  // handlers keep firing alongside the new ones.
  if (sock) {
    try { sock.ev.removeAllListeners?.(); } catch {}
    try { sock.end?.(); } catch {}
    sock = null;
  }

  const { state: authState, saveCreds } = await useAtomicAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const mySock = makeWASocket({
    version,
    auth: authState,
    logger,
    printQRInTerminal: false,
    browser: Browsers.appropriate("Desktop"),
    syncFullHistory: true,
  });
  sock = mySock;

  state.startedAt = new Date().toISOString();
  state.status = "pairing";

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", (m) => {
    try {
      const messages = Array.isArray(m.messages) ? m.messages : [];
      recordEvent("messages.upsert", {
        eventType: m.type || null,
        remoteJid: String(messages[0]?.key?.remoteJid || ""),
        count: messages.length,
      });
      if (!["notify", "append"].includes(m.type)) return;
      for (const msg of messages) {
        if (!msg?.message) continue;
        state.lastUpsertAt = new Date().toISOString();
        state.lastUpsertType = m.type;
        state.lastUpsertRemoteJid = String(msg.key?.remoteJid || "");
        recordHistoryFromMessage(msg);
        queueCandidateMessage(msg, `upsert:${m.type}`);
      }
    } catch (err) {
      console.error("[wa-sidecar] inbox err:", err?.message || err);
    }
  });

  const handleChatList = (chats, source) => {
    const list = Array.isArray(chats) ? chats : [];
    for (const c of list) {
      if (!c) continue;
      const jid = c.id || c.jid;
      if (!jid) continue;
      registerChat(jid, c);
    }
    if (list.length) {
      recordEvent(source, { eventType: "chats", count: list.length, remoteJid: String(list[0]?.id || "") });
    }
  };
  sock.ev.on("chats.set", (ev) => { try { handleChatList(ev?.chats || ev, "chats.set"); } catch (e) { console.error("[wa-sidecar] chats.set err:", e?.message || e); } });
  sock.ev.on("chats.upsert", (ev) => { try { handleChatList(ev, "chats.upsert"); } catch (e) { console.error("[wa-sidecar] chats.upsert err:", e?.message || e); } });
  sock.ev.on("chats.update", (ev) => { try { handleChatList(ev, "chats.update"); } catch (e) { console.error("[wa-sidecar] chats.update err:", e?.message || e); } });

  sock.ev.on("messaging-history.set", (event) => {
    try {
      const histChats = Array.isArray(event?.chats) ? event.chats : [];
      if (histChats.length) handleChatList(histChats, "history.chats");
      const messages = Array.isArray(event?.messages) ? event.messages : [];
      recordEvent("messaging-history.set", {
        eventType: event?.syncType != null ? String(event.syncType) : (event?.isLatest ? "latest" : null),
        remoteJid: String(messages[0]?.key?.remoteJid || ""),
        count: messages.length,
      });
      for (const msg of messages) {
        recordHistoryFromMessage(msg);
      }
      for (const msg of messages.slice(0, 100)) {
        queueCandidateMessage(msg, "history", 1800000);
      }
    } catch (err) {
      console.error("[wa-sidecar] history err:", err?.message || err);
    }
  });

  sock.ev.on("messages.update", (updates) => {
    try {
      const messages = (updates || []).map(coerceMessageUpdate).filter(Boolean);
      if (!messages.length) return;
      recordEvent("messages.update", {
        eventType: "message",
        remoteJid: String(messages[0]?.key?.remoteJid || ""),
        count: messages.length,
      });
      for (const msg of messages) {
        queueCandidateMessage(msg, "update", 1800000);
      }
    } catch (err) {
      console.error("[wa-sidecar] update err:", err?.message || err);
    }
  });

  sock.ev.on("connection.update", async (update) => {
    // Stale socket guard: if a newer start() already replaced us, ignore this
    // event — acting on it would trigger a second reconnect loop.
    if (sock !== mySock) return;
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      try {
        state.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
        state.status = "qr";
      } catch (err) {
        state.error = `qr_encode_failed: ${err?.message || err}`;
      }
    }
    if (connection === "open") {
      state.status = "ready";
      state.qrDataUrl = null;
      state.error = null;
      state.user = sock.user || null;
      state.connectedAt = new Date().toISOString();
      await maybeGreet();
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      state.user = null;
      state.qrDataUrl = null;
      state.connectedAt = null;
      if (shouldReconnect) {
        state.status = "pairing";
        scheduleRestart(1500);
      } else {
        state.status = "disconnected";
      }
    }
  });
}

const GREETED_FLAG = path.join(AUTH_DIR, "greeted.json");
const GREETING = [
  "Salut ! Moi c'est Monkey 🐵",
  "",
  "Je suis ton agent local : tu me parles depuis l'app desktop, et je peux t'aider à organiser, rechercher, écrire, coder, automatiser des tâches.",
  "Tout reste sur ta machine — rien ne transite par mes serveurs (auth + tokens seulement).",
  "",
  "Cette conversation WhatsApp est connectée à ton compte : je l'utilise pour t'envoyer des rappels et tu peux me solliciter d'ici aussi.",
  "",
  "À tout' 👋",
].join("\n");

async function maybeGreet() {
  try {
    if (fs.existsSync(GREETED_FLAG)) return;
    const me = sock?.user?.id;
    if (!me) return;
    const targetJid = normalizeBareJid(me);
    const result = await sock.sendMessage(targetJid, { text: GREETING });
    rememberSentId(result?.key?.id);
    fs.writeFileSync(GREETED_FLAG, JSON.stringify({ at: new Date().toISOString(), to: targetJid }));
  } catch (err) {
    console.error("[wa-sidecar] greet failed:", err?.message || err);
  }
}

const app = express();
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "1mb" }));

app.get("/wa/status", (_req, res) => {
  res.json({
    status: state.status,
    runtimeVersion: RUNTIME_VERSION,
    pid: process.pid,
    qr: state.qrDataUrl,
    user: state.user ? { id: state.user.id, name: state.user.name, lid: state.user.lid || sock?.user?.lid || null } : null,
    error: state.error,
    startedAt: state.startedAt,
    connectedAt: state.connectedAt,
    lastInboxAt: state.lastInboxAt,
    lastInboxType: state.lastInboxType,
    lastReplyAt: state.lastReplyAt,
    lastSendError: state.lastSendError,
    lastUpsertAt: state.lastUpsertAt,
    lastUpsertType: state.lastUpsertType,
    lastUpsertRemoteJid: state.lastUpsertRemoteJid,
    lastEventAt: state.lastEventAt,
    lastEventSource: state.lastEventSource,
    lastEventType: state.lastEventType,
    lastEventRemoteJid: state.lastEventRemoteJid,
    lastEventCount: state.lastEventCount,
    lastRejectedReason: state.lastRejectedReason,
  });
});

app.get("/wa/inbox", (_req, res) => {
  const drained = inbox.splice(0, inbox.length);
  res.json({ messages: drained });
});

app.get("/wa/chats", (_req, res) => {
  const owner = ownerBareJid();
  const lid = ownerLidJid();
  const allJids = new Set([...historyByJid.keys(), ...chatsByJid.keys()]);
  const chats = [];
  for (const jid of allJids) {
    if (!isDirectChat(jid)) continue;
    const arr = historyByJid.get(jid) || [];
    const meta = chatsByJid.get(jid) || {};
    const last = arr.length ? arr[arr.length - 1] : null;
    const isOwner = !!owner && (jid === owner || jid === lid);
    const contact = sock?.contacts?.[jid] || sock?.contacts?.[jid.split("@")[0] + "@s.whatsapp.net"] || null;
    const displayName = (contact?.name || contact?.notify || contact?.verifiedName || meta.name || "").toString().trim();
    const lastMessageAt = last?.ts || meta.conversationTimestamp || null;
    chats.push({
      jid,
      kind: isOwner ? "owner" : "contact",
      displayName: displayName || null,
      lastMessageAt,
      lastPreview: last ? (last.text || "").slice(0, 140) : "",
      lastFromBot: !!last?.fromBot,
      messageCount: arr.length,
    });
  }
  chats.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
  res.json({ chats, owner: owner || null });
});

const contactPictureCache = new Map(); // jid -> { url, at }
const CONTACT_PIC_TTL_MS = 5 * 60 * 1000;

app.get("/wa/contact/:jid", async (req, res) => {
  const jid = normalizeBareJid(String(req.params.jid || ""));
  if (!jid) return res.status(400).json({ error: "missing_jid" });
  const contact = sock?.contacts?.[jid] || null;
  const name = (contact?.name || contact?.notify || contact?.verifiedName || "").toString().trim() || null;
  let pictureUrl = null;
  const cached = contactPictureCache.get(jid);
  if (cached && Date.now() - cached.at < CONTACT_PIC_TTL_MS) {
    pictureUrl = cached.url;
  } else if (sock && state.status === "ready") {
    try {
      pictureUrl = await sock.profilePictureUrl(jid, "image");
    } catch { pictureUrl = null; }
    contactPictureCache.set(jid, { url: pictureUrl, at: Date.now() });
  }
  res.json({ jid, name, pictureUrl });
});

app.get("/wa/history/:jid", (req, res) => {
  const jid = normalizeBareJid(String(req.params.jid || ""));
  const limit = Math.max(1, Math.min(HISTORY_PER_JID, Number(req.query.limit) || HISTORY_PER_JID));
  const arr = historyByJid.get(jid) || [];
  const slice = arr.slice(-limit);
  res.json({ jid, messages: slice });
});

function resolveSendTargets(to) {
  const raw = String(to || "").trim();
  if (!raw) return [];
  const out = [];
  const push = (jid) => {
    const v = String(jid || "").trim();
    if (!v) return;
    if (!out.includes(v)) out.push(v);
  };
  if (raw.includes("@")) {
    const norm = normalizeBareJid(raw) || raw;
    push(norm);
    push(raw);
    if (norm.endsWith("@lid")) {
      const local = norm.slice(0, -4);
      if (/^\d+$/.test(local)) push(`${local}@s.whatsapp.net`);
    }
  } else {
    const digits = raw.replace(/\D/g, "");
    if (digits) push(`${digits}@s.whatsapp.net`);
  }
  return out;
}

async function sendWithFallback(targets, payload) {
  let lastErr = null;
  for (const jid of targets) {
    try {
      const result = await sock.sendMessage(jid, payload);
      return { jid, result };
    } catch (err) {
      lastErr = err;
    }
  }
  throw (lastErr || new Error("send_failed"));
}

app.post("/wa/send", async (req, res) => {
  if (!sock || state.status !== "ready") {
    return res.status(409).json({ error: "not_ready", status: state.status });
  }
  const { to, message } = req.body || {};
  if (!to || !message) return res.status(400).json({ error: "missing_to_or_message" });
  const targets = resolveSendTargets(to);
  if (!targets.length) return res.status(400).json({ error: "invalid_to" });
  try {
    const { jid, result } = await sendWithFallback(targets, { text: String(message) });
    const sentId = result?.key?.id;
    rememberSentId(sentId);
    state.lastReplyAt = new Date().toISOString();
    state.lastSendError = null;
    appendHistory(normalizeBareJid(jid), {
      id: sentId || `${Date.now()}-${Math.random()}`,
      fromBot: true,
      text: String(message),
      ts: Date.now(),
    });
    res.json({ ok: true, id: sentId, to: jid });
  } catch (err) {
    state.lastSendError = String(err?.message || err);
    res.status(500).json({ error: String(err?.message || err), targets });
  }
});

const MEDIA_KINDS = new Set(["image", "video", "audio", "document"]);
const MAX_MEDIA_BYTES = Number(process.env.MONKEY_WA_MAX_MEDIA_BYTES || 64 * 1024 * 1024); // 64 MiB

async function downloadToBuffer(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching media`);
  const ct = res.headers.get("content-type") || "";
  const len = Number(res.headers.get("content-length") || 0);
  if (len && len > MAX_MEDIA_BYTES) throw new Error(`media too large: ${len} > ${MAX_MEDIA_BYTES}`);
  const ab = await res.arrayBuffer();
  if (ab.byteLength > MAX_MEDIA_BYTES) throw new Error(`media too large: ${ab.byteLength} > ${MAX_MEDIA_BYTES}`);
  return { buffer: Buffer.from(ab), mimetype: ct.split(";")[0].trim() || undefined };
}

app.post("/wa/send-media", async (req, res) => {
  if (!sock || state.status !== "ready") {
    return res.status(409).json({ error: "not_ready", status: state.status });
  }
  const { to, url, kind, caption, mimetype, filename } = req.body || {};
  if (!to || !url) return res.status(400).json({ error: "missing_to_or_url" });
  const k = String(kind || "image").toLowerCase();
  if (!MEDIA_KINDS.has(k)) return res.status(400).json({ error: `invalid_kind:${k}` });
  const targets = resolveSendTargets(to);
  if (!targets.length) return res.status(400).json({ error: "invalid_to" });
  try {
    const { buffer, mimetype: ctMime } = await downloadToBuffer(String(url));
    const payload = { [k]: buffer };
    if (caption && k !== "audio") payload.caption = String(caption);
    const finalMime = mimetype || ctMime;
    if (finalMime) payload.mimetype = String(finalMime);
    if (k === "document" && filename) payload.fileName = String(filename);
    const { jid, result } = await sendWithFallback(targets, payload);
    rememberSentId(result?.key?.id);
    state.lastReplyAt = new Date().toISOString();
    state.lastSendError = null;
    res.json({ ok: true, id: result?.key?.id, bytes: buffer.length, kind: k, to: jid });
  } catch (err) {
    const msg = String(err?.message || err);
    state.lastSendError = msg;
    res.status(500).json({ error: msg, targets });
  }
});

function getAgentWorkspace() {
  const configFile = path.join(os.homedir(), ".monkey", "config.json");
  const fallback = path.join(os.homedir(), "Documents", "Agent");
  try {
    const cfg = JSON.parse(fs.readFileSync(configFile, "utf8"));
    return path.resolve(cfg.workspace || fallback);
  } catch {
    return fallback;
  }
}

app.post("/wa/send-file", async (req, res) => {
  if (!sock || state.status !== "ready") {
    return res.status(409).json({ error: "not_ready", status: state.status });
  }
  const { to, path: filePath, kind, caption, mimetype, filename } = req.body || {};
  if (!to || !filePath) return res.status(400).json({ error: "missing_to_or_path" });
  const k = String(kind || "image").toLowerCase();
  if (!MEDIA_KINDS.has(k)) return res.status(400).json({ error: `invalid_kind:${k}` });
  const workspace = getAgentWorkspace();
  const abs = path.resolve(filePath);
  if (abs !== workspace && !abs.startsWith(workspace + path.sep)) {
    return res.status(400).json({ error: "path_outside_workspace", workspace });
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return res.status(404).json({ error: "file_not_found", path: abs });
  }
  const size = fs.statSync(abs).size;
  if (size > MAX_MEDIA_BYTES) return res.status(413).json({ error: `file_too_large: ${size} > ${MAX_MEDIA_BYTES}` });
  const targets = resolveSendTargets(to);
  if (!targets.length) return res.status(400).json({ error: "invalid_to" });
  try {
    const buffer = fs.readFileSync(abs);
    const payload = { [k]: buffer };
    if (caption && k !== "audio") payload.caption = String(caption);
    if (mimetype) payload.mimetype = String(mimetype);
    if (k === "document") payload.fileName = String(filename || path.basename(abs));
    const { jid, result } = await sendWithFallback(targets, payload);
    rememberSentId(result?.key?.id);
    state.lastReplyAt = new Date().toISOString();
    state.lastSendError = null;
    res.json({ ok: true, id: result?.key?.id, bytes: buffer.length, kind: k, path: abs, to: jid });
  } catch (err) {
    const msg = String(err?.message || err);
    state.lastSendError = msg;
    res.status(500).json({ error: msg, targets });
  }
});

app.post("/wa/logout", async (_req, res) => {
  try {
    if (sock) {
      try { await sock.logout(); } catch {}
      sock = null;
    }
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    state.status = "disconnected";
    state.qrDataUrl = null;
    state.user = null;
    state.error = null;
    state.connectedAt = null;
    scheduleRestart(500);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

if (require.main === module) {
  start().catch(err => {
    state.status = "failed";
    state.error = String(err?.message || err);
    scheduleRestart(5000);
  });

  app.listen(PORT, "127.0.0.1", () => {
    console.log(`[wa-sidecar] listening on 127.0.0.1:${PORT}, auth=${AUTH_DIR}`);
  });
}

module.exports = {
  _private: {
    normalizeBareJid,
    extractMessageText,
    isDirectChat,
    shouldQueueMessage,
    coerceMessageUpdate,
    messageTimestampMs,
    isRecentMessage,
  },
};

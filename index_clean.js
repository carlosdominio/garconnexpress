const qrcodeTerminal = require('qrcode-terminal');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

// Banco de dados local
const low = require('lowdb');
const FileAsync = require('lowdb/adapters/FileAsync');
const adapter = new FileAsync('db.json');
let db;
let chats = {}; // Global

// Mapeamento pedidoId -> JID real do cliente
let pedidoIdToJid = {};

async function initDB() {
    db = await low(adapter);
    await db.defaults({ chats: {}, pedidoIdToJid: {} }).write();
    pedidoIdToJid = db.get('pedidoIdToJid').value() || {};
    chats = db.get('chats').value() || {};
    console.log('Banco de dados pronto');
}

async function fetchDeliveryStatus(pedidoId) {
    const api = process.env.DELIVERY_API_URL || 'http://localhost:3001/api/pedidos';
    try {
        const response = await fetch(`${api}/${pedidoId}`);
        if (response.ok) return await response.json();
    } catch (e) { console.log('Erro status:', e.message); }
    return null;
}

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" }, maxHttpBufferSize: 1e8 });

const port = 3002;

app.get('/health', (req, res) => res.send('OK'));

app.post('/api/notify-delivery', async (req, res) => {
    const { status, pedidoId, tempo } = req.body;
    const savedJid = pedidoIdToJid[pedidoId];

    if (!savedJid || !sock) return res.status(404).json({ error: 'N/A' });

    try {
        const tempoEst = tempo || '30-50 min';
        let msg = `✅ Pedido #${pedidoId} atualizado!`;
        if (status === 'recebido') msg = `✅ *PEDIDO RECEBIDO!*\n\nOlá! Já recebemos seu pedido *#${pedidoId}*.\n\n1️⃣ - Ver Status 🛵\n2️⃣ - Falar com Atendente 👨‍💻`;
        else if (status === 'saiu_entrega') msg = `🛵 *SAIU PARA ENTREGA!*\n\nSeu pedido #${pedidoId} está a caminho!\n\n🕒 *Prazo:* ${tempoEst}`;

        await sock.sendMessage(savedJid, { text: msg });
        
        if (db) {
            chats[savedJid] = chats[savedJid] || { messages: [], unreadCount: 0 };
            chats[savedJid].atendimentoManual = false;
            await db.set('chats', { ...chats }).write();
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

let lastQr = null;
let statusConexao = "DESCONECTADO";
let sock = null;

async function sendHumanizedMessage(jid, content, options = {}) {
    if (!sock || statusConexao !== "CONECTADO") return;
    try {
        await sock.sendPresenceUpdate('composing', jid);
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
        const result = await sock.sendMessage(jid, content, options);
        await sock.sendPresenceUpdate('paused', jid);
        return result;
    } catch (e) { console.error(e); }
}

io.on('connection', (socket) => {
    socket.emit('status', { status: statusConexao });
    if (lastQr) socket.emit('qr', lastQr);
    if (db) socket.emit('history', db.get('chats').value());

    socket.on('send_msg', async (data) => {
        let jid = data.number;
        if (!jid.includes('@')) jid = jid.replace(/\D/g, '') + '@s.whatsapp.net';
        await sendHumanizedMessage(jid, { text: data.text });
    });

    socket.on('toggle_atendimento', async (data) => {
        const { jid, status } = data;
        if (db) {
            chats[jid] = chats[jid] || { messages: [], unreadCount: 0 };
            chats[jid].atendimentoManual = status;
            await db.set('chats', { ...chats }).write();
            io.emit('status_atendimento', { jid, atendimentoManual: status });
        }
    });
});

async function saveMessage(jid, msg, name) {
    if (!jid || jid.includes('@newsletter')) return;
    if (!chats[jid]) chats[jid] = { name: jid.split('@')[0], messages: [], atendimentoManual: false, unreadCount: 0 };
    chats[jid].messages.push(msg);
    if (chats[jid].messages.length > 100) chats[jid].messages.shift();
    if (db) await db.set('chats', { ...chats }).write();
}

async function connectToWhatsApp() {
    const { default: makeWASocket, useMultiFileAuthState, Browsers, fetchLatestBaileysVersion } = await import('@whiskeysockets/baileys');
    try {
        const { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        sock = makeWASocket({ version, auth: state, logger: pino({ level: 'error' }), browser: Browsers.appropriate('Painel Zap') });
        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, qr } = update;
            if (qr) {
                QRCode.toDataURL(qr).then(url => { lastQr = url; io.emit('qr', url); });
                statusConexao = "AGUARDANDO QR";
                io.emit('status', {status: statusConexao});
            }
            if (connection === 'open') {
                statusConexao = "CONECTADO"; lastQr = null;
                io.emit('status', {status: statusConexao});
                console.log('✅ Bot CONECTADO!');
            }
            if (connection === 'close') setTimeout(connectToWhatsApp, 5000);
        });

        sock.ev.on('messages.upsert', async (m) => {
            try {
                const msg = m.messages[0];
                if (!msg.message || msg.key.fromMe) return;

                const jid = msg.key.remoteJid.replace(/:[0-9]+/, '').replace('@lid', '@s.whatsapp.net');
                const pushName = msg.pushName || jid.split('@')[0];
                let text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

                if (text.toUpperCase().includes('PEDIDO') || text.toUpperCase().includes('DELIVERY')) {
                    const matchId = text.match(/#(\d+)/);
                    if (matchId) {
                        const pedidoId = matchId[1];
                        pedidoIdToJid[pedidoId] = jid;
                        if (db) await db.set('pedidoIdToJid', pedidoIdToJid).write();
                        
                        chats[jid] = chats[jid] || { name: pushName, messages: [], unreadCount: 0 };
                        chats[jid].atendimentoManual = false;
                        
                        const menuMsg = `✅ *PEDIDO RECEBIDO!*\n\nOlá ${pushName}! Já vinculamos seu pedido *#${pedidoId}*.\n\n1️⃣ - Ver Status 🛵\n2️⃣ - Falar com Humano 👨‍💻`;
                        await sock.sendMessage(jid, { text: menuMsg });
                        return;
                    }
                }

                const msgObj = { id: msg.key.id, from: jid, text, fromMe: false, time: new Date().toLocaleTimeString('pt-BR'), sender: jid, pushName };
                await saveMessage(jid, msgObj, pushName);
                io.emit('new_msg', msgObj);

                if (chats[jid] && !chats[jid].atendimentoManual) {
                    if (text === '1') {
                        const sData = await fetchDeliveryStatus(pedidoIdToJid[jid] || '');
                        await sock.sendMessage(jid, { text: `📊 Status: ${sData ? sData.status : 'Processando...'}` });
                    } else if (text === '2') {
                        chats[jid].atendimentoManual = true;
                        if (db) await db.set('chats', { ...chats }).write();
                        await sock.sendMessage(jid, { text: '🙋‍♂️ Aguarde, um atendente falará com você!' });
                        io.emit('status_atendimento', { jid, atendimentoManual: true });
                    }
                }
            } catch (e) { console.error(e); }
        });
    } catch (err) { setTimeout(connectToWhatsApp, 5000); }
}

initDB().then(() => {
    server.listen(port, () => connectToWhatsApp());
});

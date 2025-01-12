// Importing necessary modules
const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const multer = require('multer');
const qrcode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 5000;

const sessions = {};
const activeProcesses = {}; // To track ongoing SMS processes

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Main Page
app.get('/', (req, res) => {
  const sessionId = uuidv4();
  res.redirect(`/session/${sessionId}`);
});

// Session Setup
app.get('/session/:sessionId', async (req, res) => {
  const sessionId = req.params.sessionId;

  if (!sessions[sessionId]) {
    sessions[sessionId] = { isConnected: false, qrCode: null, groups: [] };
    setupSession(sessionId);
  }

  const session = sessions[sessionId];

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>WhatsApp Message Sender</title>
      <style>
        body { font-family: Arial, sans-serif; background: #f0f0f0; color: #333; }
        h1 { text-align: center; color: #4CAF50; }
        #qrCodeBox { width: 200px; height: 200px; margin: 20px auto; display: flex; justify-content: center; align-items: center; border: 2px solid #4CAF50; }
        #qrCodeBox img { width: 100%; height: 100%; }
        form { margin: 20px auto; max-width: 500px; padding: 20px; background: white; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
        input, select, button, textarea { width: 100%; margin: 10px 0; padding: 10px; border-radius: 5px; border: 1px solid #ccc; }
        button { background-color: #4CAF50; color: white; border: none; cursor: pointer; }
        button:hover { background-color: #45a049; }
      </style>
    </head>
    <body>
      <h1>WhatsApp Message Sender</h1>
      ${session.isConnected ? `
        <form action="/send-message/${sessionId}" method="POST" enctype="multipart/form-data">
          <label for="hater">Enter Hater's Name:</label>
          <input type="text" id="hater" name="hater" placeholder="Enter hater's name" required />

          <label for="targetNumbers">Enter Target Numbers (comma-separated):</label>
          <input type="text" id="targetNumbers" name="targetNumbers" placeholder="e.g., +919876543210, +1234567890" />

          <label for="target">Select Groups:</label>
          <select id="target" name="target" multiple>
            ${session.groups.map(group => `<option value="${group.id}">${group.name}</option>`).join('')}
          </select>

          <label for="delay">Enter Delay (seconds):</label>
          <input type="number" id="delay" name="delay" placeholder="Delay in seconds" min="1" required />

          <label for="messageFile">Upload Message File:</label>
          <input type="file" id="messageFile" name="messageFile" accept=".txt" required />

          <button type="submit">Send Message</button>
        </form>
        <form action="/stop-message/${sessionId}" method="POST">
          <button type="submit" style="background-color: red;">Stop Messages</button>
        </form>
      ` : `
        <h2>Scan QR Code to Connect WhatsApp</h2>
        <div id="qrCodeBox">
          ${session.qrCode ? `<img src="${session.qrCode}" alt="Scan QR Code"/>` : 'QR Code will appear here...'}
        </div>
        <script>
          setInterval(() => {
            fetch('/session/${sessionId}/qr').then(res => res.json()).then(data => {
              if (data.qrCode) {
                document.getElementById('qrCodeBox').innerHTML = \`<img src="\${data.qrCode}" alt="Scan QR Code"/>\`;
              }
            });
          }, 5000);
        </script>
      `}
    </body>
    </html>
  `);
});

// Send Messages
app.post('/send-message/:sessionId', upload.single('messageFile'), async (req, res) => {
  const sessionId = req.params.sessionId;
  const { hater, target, targetNumbers, delay } = req.body;
  const messageFile = req.file.buffer.toString('utf-8');
  const messages = messageFile.split('\n').filter(msg => msg.trim() !== '');
  const socket = sessions[sessionId]?.socket;

  if (!socket) return res.status(400).send('WhatsApp session not connected.');

  const targets = [
    ...new Set([
      ...(targetNumbers ? targetNumbers.split(',').map(num => `${num.replace('+', '')}@s.whatsapp.net`) : []),
      ...(target ? target.split(',') : []),
    ]),
  ];

  if (activeProcesses[sessionId]) {
    return res.status(400).send('Message sending is already in progress.');
  }

  activeProcesses[sessionId] = true;

  try {
    while (activeProcesses[sessionId]) {
      for (const msg of messages) {
        for (const targetId of targets) {
          try {
            const text = `Hey ${hater}, ${msg}`;
            await socket.sendMessage(targetId, { text });
            console.log(`Message sent to ${targetId}: ${text}`);
            await new Promise(resolve => setTimeout(resolve, delay * 1000));
          } catch (err) {
            console.error(`Failed to send message to ${targetId}:`, err.message);
          }
        }
      }
    }
  } catch (err) {
    console.error('Error during message sending:', err.message);
  }

  res.send('Messages sending started!');
});

// Stop Messages
app.post('/stop-message/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  activeProcesses[sessionId] = false;
  res.send('Message sending stopped.');
});

// Start Server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

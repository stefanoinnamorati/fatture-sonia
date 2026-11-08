#!/bin/bash
cd "$(dirname "$0")"
PORT=8787
HOST=$(scutil --get LocalHostName 2>/dev/null || echo "questo-mac")
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
echo ""
echo "Fatture Sonia"
echo "Sul Mac:  http://localhost:${PORT}"
echo "Su iPhone o iPad, stessa rete Wi-Fi:"
echo "  http://${HOST}.local:${PORT}"
if [ -n "$IP" ]; then echo "  http://${IP}:${PORT}"; fi
echo ""
echo "In Safari: tasto Condividi, poi Aggiungi a Home."
echo "Dopo la prima apertura l'app resta sul telefono anche senza questo Mac."
echo "Lascia questa finestra aperta per installarla o aggiornarla."
echo ""
open "http://localhost:${PORT}"
exec python3 -m http.server "$PORT"

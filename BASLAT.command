#!/bin/bash
# Mutlu Akaryakıt - Sistemi Başlat
cd "$(dirname "$0")/backend"

if [ ! -d node_modules ]; then
  osascript -e 'display dialog "İlk kurulum yapılıyor, lütfen bekleyin..." buttons {"Tamam"} default button 1' 2>/dev/null || echo "İlk kurulum yapılıyor..."
  bash "../KURULUM.command"
fi

# Yerel IP adresini bul
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")

echo "======================================"
echo "  Mutlu Akaryakıt Çalışıyor"
echo "======================================"
echo ""
echo "  Bilgisayardan:  http://localhost:3001"
echo "  Telefondan:     http://${LOCAL_IP}:3001"
echo ""
echo "  Kapatmak için bu pencerede Ctrl+C"
echo "======================================"
echo ""

# Tarayıcıyı aç
sleep 2 && open "http://localhost:3001" &

npm run dev

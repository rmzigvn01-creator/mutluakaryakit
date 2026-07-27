#!/bin/bash
# Mutlu Akaryakıt - Otomatik Kurulum
set -e
cd "$(dirname "$0")/backend"

echo "======================================"
echo "  Mutlu Akaryakıt - Kurulum"
echo "======================================"

if ! command -v node &>/dev/null; then
  echo "HATA: Node.js bulunamadı."
  echo "Lütfen https://nodejs.org adresinden Node.js indirip kurun."
  exit 1
fi

echo "→ Bağımlılıklar yükleniyor..."
npm install --silent

if [ ! -f .env ]; then
  cp .env.example .env
  echo "→ .env dosyası oluşturuldu"
fi

echo "→ Veritabanı hazırlanıyor..."
npx prisma migrate deploy 2>/dev/null || npx prisma migrate dev --name init
npx prisma generate

echo "→ Demo kullanıcılar oluşturuluyor..."
npm run seed

echo ""
echo "✓ Kurulum tamamlandı!"
echo ""
echo "Başlatmak için 'BASLAT.command' dosyasına çift tıklayın."
echo ""

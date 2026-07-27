# Kalıcı yayın (20 yıl hedefi)

## Mimari
- **Veri:** Neon Postgres (EU) — tablolar + fiş görselleri (`receiptData`)
- **Uygulama:** Render Starter (Frankfurt, uyumaz) + 10GB disk yedek
- **Hız:** Neon pooler, gzip, menü paralel yükleme, liste sorgularında binary yok

## Veri kaybı
- Fişler Neon’da Bytes olarak saklanır (disk silinse bile kalır)
- Render disk ek yedek
- Neon Console’dan Point-in-Time Recovery (ücretli planda) açın

## Yayın adımları
1. GitHub’a push
2. Render Blueprint → bu repo
3. `DATABASE_URL` = Neon **pooled** connection string  
   `DIRECT_URL` = Neon **direct** (pooler olmayan) string
4. Deploy → `https://mutluakaryakit.onrender.com` (veya verilen URL)

### Giriş
- admin@mutluakaryakit.local / admin123
- ahmet@mutluakaryakit.local / staff123

## Not
Ücretsiz Render “sleep” eder; 20 yıl sürekli açık için **Starter+** ve Neon’un ücretli/compute planı gerekir.

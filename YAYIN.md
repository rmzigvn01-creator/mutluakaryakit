# Kalıcı yayın

## GitHub
https://github.com/rmzigvn01-creator/mutluakaryakit

## Canlı adres
- Geçici: https://mutluakaryakit.onrender.com
- Hedef domain: **https://mutlupo.com** (Hostinger DNS → Render) — ayrıntı: `DOMAIN.md`

## Render (7/24)
1. https://dashboard.render.com → `mutluakaryakit` servisi
2. Environment’a **Supabase** string’lerini yapıştırın:

### Supabase (eski atlihukuk projesi → Mutlu)
https://supabase.com/dashboard/project/xbysvefefpuiqjxwvwqn  
Frankfurt · DB sıfırlandı · Prisma şeması + Neon verisi taşındı

- `DATABASE_URL` → **Transaction pooler** (port **6543**, `pgbouncer=true`)
- `DIRECT_URL` → **Session pooler** (port **5432**, IPv4)

3. Plan: **Starter** (Free uyur; Starter 7/24 açık kalır — kart gerekir)
4. Custom Domain: `mutlupo.com` + `www` ekle → Hostinger DNS (`DOMAIN.md`)

### Giriş
- admin@mutluakaryakit.local / admin123
- ahmet@mutluakaryakit.local / staff123

## Veri güvenliği
- Neon: tüm kayıtlar + fiş görselleri (`receiptData`)
- Render disk: ek yedek (`/var/data/uploads`)

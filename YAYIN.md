# Kalıcı yayın

## GitHub
https://github.com/rmzigvn01-creator/mutluakaryakit

## Render (7/24)
1. https://dashboard.render.com/blueprints/new?repoUrl=https://github.com/rmzigvn01-creator/mutluakaryakit
2. Repo’yu bağlayın → Blueprint Apply
3. Environment’a Neon string’lerini yapıştırın:

### Neon Console
https://console.neon.tech/app/projects/purple-resonance-43544081

- `DATABASE_URL` → **Pooled** connection string (`-pooler` içeren)
- `DIRECT_URL` → **Direct** connection string (pooler olmayan)

4. Plan: **Starter** (Free uyur; Starter 7/24 açık kalır — kart gerekir)
5. Deploy bitince verilen `*.onrender.com` URL’sini kullanın

### Giriş
- admin@mutluakaryakit.local / admin123
- ahmet@mutluakaryakit.local / staff123

## Veri güvenliği
- Neon: tüm kayıtlar + fiş görselleri (`receiptData`)
- Render disk: ek yedek (`/var/data/uploads`)

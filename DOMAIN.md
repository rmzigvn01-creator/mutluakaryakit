# mutlupo.com — Hostinger + Render

## 1) Hostinger’dan domain al
1. https://www.hostinger.com.tr/domainler → `mutlupo.com` ara / satın al
2. Domain paneline gir → **DNS / DNS Zone**

## 2) Render’a domain ekle
1. https://dashboard.render.com → `mutluakaryakit` servisi
2. **Settings → Custom Domains → Add**
3. `mutlupo.com` ve `www.mutlupo.com` ekle
4. Render’ın verdiği hedefi kopyala (genelde `mutluakaryakit.onrender.com` CNAME)

## 3) Hostinger DNS kayıtları
Render’a `mutlupo.com` ve `www.mutlupo.com` eklendi (doğrulama DNS sonrası).

Hostinger → Domains → mutlupo.com → **DNS / DNS Zone Editor**:

| Tip   | İsim (Host) | Değer                         | TTL  |
|-------|-------------|-------------------------------|------|
| CNAME | www         | `mutluakaryakit.onrender.com` | 300  |
| CNAME veya ALIAS | @   | `mutluakaryakit.onrender.com` | 300  |

Hostinger kök `@` CNAME kabul etmezse Render dashboard’daki **A** kayıtlarını kullan  
(Settings → Custom Domains → mutlupo.com → DNS targets).

- Eski park / Hostinger varsayılan A kayıtlarını sil.
- SSL Render’da otomatik (DNS yayılınca birkaç dakika–saat).

## 4) Kontrol
- https://mutlupo.com/health → `{"status":"ok"...}`
- https://www.mutlupo.com → uygulamaya yönlenmeli

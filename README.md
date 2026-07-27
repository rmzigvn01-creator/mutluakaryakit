# Mutlu Akaryakıt

Petrol Ofisi bayi istasyonu satış/ödeme kanıt sistemi.

---

## Nasıl Kullanılır? (Teknik bilgi gerekmez)

### Mac:
1. **`BASLAT.command`** dosyasına çift tıklayın
2. Tarayıcı açılır → giriş yapın

### Windows:
1. [Node.js](https://nodejs.org) kurun (bir kez)
2. **`BASLAT.bat`** dosyasına çift tıklayın

Detaylı kılavuz: **[KULLANIM.md](KULLANIM.md)**

---

## Giriş Bilgileri

| Rol | E-posta | Şifre |
|-----|---------|-------|
| Yönetici | admin@mutluakaryakit.local | admin123 |
| Pompacı | ahmet@mutluakaryakit.local | staff123 |
| Muhasebeci | muhasebe@mutluakaryakit.local | staff123 |

---

## Özellikler

- İşlem kaydı + zorunlu fiş fotoğrafı
- Tutarsız tutar → şüpheli işlem uyarısı
- Yönetici onaylı düzeltme/silme
- Pompacı performans analizi
- Offline kayıt (internet gelince otomatik gönderim)
- iPhone Safari'den kullanım (Ana Ekrana Ekle)

---

## Proje Yapısı

```
mutluakaryakit/
├── BASLAT.command   ← Mac'te çift tıkla
├── BASLAT.bat       ← Windows'ta çift tıkla
├── KULLANIM.md      ← Detaylı kılavuz
├── backend/         ← Sunucu + web arayüzü
└── app/             ← Flutter (ileride App Store)
```

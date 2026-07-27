# Mutlu Akaryakıt — MVP Spesifikasyonu

## Amaç

Petrol Ofisi bayi istasyonunda satış ve ödeme kayıtlarının anlık dijitalleştirilmesi, fiş kanıtı zorunluluğu, muhasebe manipülasyonunun önlenmesi ve pompacı bazlı performans takibi.

## Kapsam

| Dahil | Hariç (sonra) |
|-------|----------------|
| İşlem kaydı + zorunlu fiş fotoğrafı | Tank/stok takibi |
| Offline kayıt + senkron | Petrol Ofisi API |
| Düzeltme/silme → yönetici onayı | e-Fatura |
| OCR tutarsızlık → şüpheli işlem | Çok şube |
| Pompacı analizi (ay sonu) | |

## Roller

- **STAFF (Pompacı):** Kayıt girer, fiş çeker. Düzenleyemez.
- **ACCOUNTANT (Muhasebeci):** Görüntüler, rapor, düzeltme talebi açar.
- **ADMIN (Yönetici):** Tüm veri, onay/red, şüpheli işlemler, pompacı analizi.

## İşlem Tipleri

`FUEL_BENZIN`, `FUEL_MOTORIN`, `CARD_POS`, `CASH`, `OTHER`

## Şüpheli İşlem Durumları

| Durum | Açıklama |
|-------|----------|
| `NORMAL` | Girilen tutar ≈ fiş tutarı (±2 TL tolerans) |
| `SUSPICIOUS_MISMATCH` | Girilen ≠ fiş tutarı |
| `SUSPICIOUS_UNREADABLE` | OCR tutar okuyamadı |
| `REVIEWED` | Yönetici inceledi |

## Onay Akışı

1. Kayıt oluşturulur → immutable.
2. Düzeltme/silme talebi açılır (gerekçe zorunlu).
3. Yönetici onaylar veya reddeder.
4. Audit log'a yazılır.

## Offline Senkron

- İstemci yerel SQLite + fiş dosyaları.
- `client_id` (UUID) ile idempotent upload.
- Senkron sırası: işlem metadata → fiş fotoğrafı → OCR sonucu.

## Platform

- Windows: Flutter desktop
- iOS: Flutter
- Backend: Node.js + Express + Prisma

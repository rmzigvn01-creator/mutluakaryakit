# iOS Push Bildirim Kurulumu

Şüpheli işlem oluştuğunda yöneticinin iPhone'una anında bildirim gider.

---

## Adım 1: Firebase hesabı (ücretsiz)

1. https://console.firebase.google.com adresine gidin
2. **Proje ekle** → Ad: `Mutlu Akaryakıt`
3. **iOS uygulaması ekle**
   - Bundle ID: `com.mutluakaryakit.mutluakaryakit` (Flutter projesi ile aynı olmalı)
4. **GoogleService-Info.plist** dosyasını indirin
5. Dosyayı `app/ios/Runner/` klasörüne kopyalayın

---

## Adım 2: Apple Push (APNs)

1. https://developer.apple.com → **Certificates, Identifiers & Profiles**
2. App ID'nizde **Push Notifications** açık olsun
3. Firebase Console → Proje Ayarları → **Cloud Messaging**
4. **APNs Authentication Key** (.p8) yükleyin
   - Apple'dan Key oluşturun → Push Notifications işaretli
   - Key ID ve Team ID'yi Firebase'e girin

---

## Adım 3: Firebase Server Key (backend)

1. Firebase Console → Proje Ayarları → **Cloud Messaging**
2. **Server key** (Legacy) kopyalayın
3. Bilgisayardaki `backend/.env` dosyasına ekleyin:

```
FCM_SERVER_KEY=AAAAxxxx...server_key_buraya
```

4. Sunucuyu yeniden başlatın (`BASLAT.command`)

---

## Adım 4: iOS uygulamasını kur

```bash
cd app
flutter pub get
cd ios && pod install && cd ..
flutter run -d ios
```

**Yönetici** hesabıyla giriş yapın → uygulama bildirim izni isteyecek → **İzin Ver**

---

## Adım 5: Test

1. Yönetici iPhone'da uygulamaya giriş yapın
2. Pompacı hesabıyla (başka cihaz veya web) tutarsız işlem girin
3. Yöneticinin telefonuna bildirim gelmeli:

> ⚠️ Şüpheli İşlem  
> Ahmet: 120,00 TL girildi, fiş 80,00 TL

---

## Sorun giderme

| Sorun | Çözüm |
|-------|--------|
| Bildirim gelmiyor | `.env` dosyasında FCM_SERVER_KEY doğru mu? |
| İzin istemedi | Uygulamayı sil-yeniden kur, yönetici ile giriş yap |
| Sadece uygulama açıkken geliyor | APNs key Firebase'e yüklendi mi? |
| Kayıtlı cihaz yok | iOS uygulamasından yönetici girişi yapın |

---

## Maliyet

Firebase Cloud Messaging **ücretsiz** (makul kullanımda).

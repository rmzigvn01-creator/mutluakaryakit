# Mutlu Akaryakıt — Flutter Uygulaması

Windows ve iOS için tek kod tabanı.

## İlk Kurulum

1. [Flutter SDK](https://docs.flutter.dev/get-started/install) kurun
2. Platform dosyalarını oluşturun (sadece ilk seferde):

```bash
cd app
flutter create . --org com.mutluakaryakit --project-name mutluakaryakit --platforms=windows,ios
flutter pub get
```

3. Backend'in çalıştığından emin olun (`backend/` klasöründe `npm run dev`)

## Çalıştırma

```bash
# Windows
flutter run -d windows

# iOS (macOS + Xcode gerekir)
flutter run -d ios
```

## API Adresi

Gerçek cihazda `localhost` çalışmaz. Bilgisayarınızın yerel IP'sini kullanın:

```bash
flutter run -d windows --dart-define=API_URL=http://192.168.1.10:3001
```

Varsayılan: `http://localhost:3001` (`lib/core/config.dart`)

## Offline Mod

- İnternet yokken işlem yerel SQLite'a kaydedilir
- Fiş fotoğrafı cihazda saklanır
- İnternet gelince ana ekrandaki senkron butonu veya otomatik senkron devreye girer

## Demo Hesaplar

| Rol | E-posta | Şifre |
|-----|---------|-------|
| Yönetici | admin@mutluakaryakit.local | admin123 |
| Pompacı | ahmet@mutluakaryakit.local | staff123 |
| Muhasebeci | muhasebe@mutluakaryakit.local | staff123 |

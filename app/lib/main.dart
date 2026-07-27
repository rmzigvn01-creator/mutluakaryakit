import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'core/config.dart';
import 'core/api_client.dart';
import 'services/services.dart';
import 'services/push_service.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';
import 'core/navigator.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AppConfig.initDatabaseFactory();

  final api = ApiClient();
  final push = PushService(api);
  await push.init();
  runApp(MutluAkaryakitApp(api: api, push: push));
}

class MutluAkaryakitApp extends StatelessWidget {
  final ApiClient api;
  final PushService push;

  const MutluAkaryakitApp({super.key, required this.api, required this.push});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider.value(value: push),
        ChangeNotifierProvider(
          create: (_) {
            final auth = AuthService(api);
            auth.push = push;
            return auth;
          },
        ),
        ChangeNotifierProxyProvider<AuthService, TransactionService>(
          create: (_) => TransactionService(api),
          update: (_, auth, tx) => tx ?? TransactionService(api),
        ),
        ChangeNotifierProvider(create: (_) => AdminService(api)),
        ChangeNotifierProxyProvider<TransactionService, SyncService>(
          create: (ctx) => SyncService(ctx.read<TransactionService>()),
          update: (_, tx, sync) => sync ?? SyncService(tx),
        ),
      ],
      child: MaterialApp(
        title: 'Mutlu Akaryakıt',
        navigatorKey: navigatorKey,
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF1B5E20),
            brightness: Brightness.light,
          ),
          useMaterial3: true,
          appBarTheme: const AppBarTheme(centerTitle: true),
        ),
        home: const _RootScreen(),
      ),
    );
  }
}

class _RootScreen extends StatefulWidget {
  const _RootScreen();

  @override
  State<_RootScreen> createState() => _RootScreenState();
}

class _RootScreenState extends State<_RootScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => context.read<AuthService>().tryRestoreSession());
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthService>();
    if (auth.user == null && !auth.loading) {
      return const LoginScreen();
    }
    if (auth.user == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return const HomeScreen();
  }
}

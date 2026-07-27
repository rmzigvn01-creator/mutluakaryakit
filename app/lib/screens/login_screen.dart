import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/services.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController(text: 'admin@mutluakaryakit.local');
  final _password = TextEditingController(text: 'admin123');
  final _formKey = GlobalKey<FormState>();

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    final ok = await context.read<AuthService>().login(
          _email.text,
          _password.text,
        );
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.read<AuthService>().error ?? 'Giriş başarısız')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthService>();

    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 400),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.local_gas_station, size: 64, color: Theme.of(context).colorScheme.primary),
                  const SizedBox(height: 8),
                  Text('Mutlu Akaryakıt', style: Theme.of(context).textTheme.headlineSmall),
                  const SizedBox(height: 32),
                  TextFormField(
                    controller: _email,
                    decoration: const InputDecoration(
                      labelText: 'E-posta',
                      border: OutlineInputBorder(),
                    ),
                    keyboardType: TextInputType.emailAddress,
                    validator: (v) => v == null || v.isEmpty ? 'E-posta gerekli' : null,
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _password,
                    decoration: const InputDecoration(
                      labelText: 'Şifre',
                      border: OutlineInputBorder(),
                    ),
                    obscureText: true,
                    validator: (v) => v == null || v.isEmpty ? 'Şifre gerekli' : null,
                  ),
                  const SizedBox(height: 24),
                  SizedBox(
                    width: double.infinity,
                    height: 48,
                    child: FilledButton(
                      onPressed: auth.loading ? null : _submit,
                      child: auth.loading
                          ? const SizedBox(
                              width: 24,
                              height: 24,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('Giriş Yap'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

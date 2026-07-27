import 'dart:io';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import '../services/services.dart';

class NewTransactionScreen extends StatefulWidget {
  const NewTransactionScreen({super.key});

  @override
  State<NewTransactionScreen> createState() => _NewTransactionScreenState();
}

class _NewTransactionScreenState extends State<NewTransactionScreen> {
  final _amountController = TextEditingController();
  final _descriptionController = TextEditingController();
  String _type = 'CARD_POS';
  XFile? _receipt;
  bool _saving = false;

  static const types = {
    'FUEL_BENZIN': 'Benzin',
    'FUEL_MOTORIN': 'Motorin',
    'CARD_POS': 'Kart (POS)',
    'CASH': 'Nakit',
    'OTHER': 'Diğer',
  };

  @override
  void dispose() {
    _amountController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _pickReceipt(ImageSource source) async {
    final picker = ImagePicker();
    final file = await picker.pickImage(source: source, imageQuality: 85);
    if (file != null) setState(() => _receipt = file);
  }

  Future<void> _save() async {
    final amount = double.tryParse(_amountController.text.replaceAll(',', '.'));
    if (amount == null || amount <= 0) {
      _showError('Geçerli bir tutar girin');
      return;
    }
    if (_receipt == null) {
      _showError('Fiş fotoğrafı zorunludur');
      return;
    }
    if (_type == 'OTHER' && _descriptionController.text.trim().isEmpty) {
      _showError('Diğer işlemler için açıklama zorunludur');
      return;
    }

    setState(() => _saving = true);

    final connectivity = await Connectivity().checkConnectivity();
    final offline = connectivity.contains(ConnectivityResult.none);

    final ok = await context.read<TransactionService>().createTransaction(
          type: _type,
          enteredAmount: amount,
          description: _descriptionController.text.trim().isEmpty
              ? null
              : _descriptionController.text.trim(),
          receiptPath: _receipt!.path,
          offline: offline,
        );

    setState(() => _saving = false);

    if (!mounted) return;

    if (ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(offline
              ? 'Offline kaydedildi — internet gelince senkronize edilecek'
              : 'İşlem kaydedildi'),
        ),
      );
      Navigator.pop(context);
    } else {
      _showError(context.read<TransactionService>().error ?? 'Kayıt başarısız');
    }
  }

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Yeni İşlem')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          DropdownButtonFormField<String>(
            value: _type,
            decoration: const InputDecoration(
              labelText: 'İşlem Tipi',
              border: OutlineInputBorder(),
            ),
            items: types.entries
                .map((e) => DropdownMenuItem(value: e.key, child: Text(e.value)))
                .toList(),
            onChanged: (v) => setState(() => _type = v!),
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _amountController,
            decoration: const InputDecoration(
              labelText: 'Tutar (TL)',
              border: OutlineInputBorder(),
              prefixText: '₺ ',
            ),
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _descriptionController,
            decoration: const InputDecoration(
              labelText: 'Açıklama (isteğe bağlı)',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 24),
          Text('Fiş Fotoğrafı *', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if (_receipt != null) ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.file(File(_receipt!.path), height: 200, fit: BoxFit.cover),
            ),
            const SizedBox(height: 8),
          ],
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => _pickReceipt(ImageSource.camera),
                  icon: const Icon(Icons.camera_alt),
                  label: const Text('Kamera'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => _pickReceipt(ImageSource.gallery),
                  icon: const Icon(Icons.photo),
                  label: const Text('Galeri'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 32),
          FilledButton(
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Kaydet'),
          ),
        ],
      ),
    );
  }
}

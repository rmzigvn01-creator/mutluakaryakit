import 'dart:convert';
import 'package:http/http.dart' as http;
import '../core/config.dart';

class ApiClient {
  String? _token;

  void setToken(String? token) => _token = token;
  String? get token => _token;

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (_token != null) 'Authorization': 'Bearer $_token',
      };

  Future<Map<String, dynamic>> get(String path, {Map<String, String>? query}) async {
    final uri = Uri.parse('${AppConfig.apiUrl}$path').replace(queryParameters: query);
    final res = await http.get(uri, headers: _headers);
    return _handle(res);
  }

  Future<Map<String, dynamic>> post(String path, Map<String, dynamic> body) async {
    final uri = Uri.parse('${AppConfig.apiUrl}$path');
    final res = await http.post(uri, headers: _headers, body: jsonEncode(body));
    return _handle(res);
  }

  Future<Map<String, dynamic>> delete(String path, [Map<String, dynamic>? body]) async {
    final uri = Uri.parse('${AppConfig.apiUrl}$path');
    final res = await http.delete(
      uri,
      headers: _headers,
      body: body != null ? jsonEncode(body) : null,
    );
    return _handle(res);
  }

  Future<Map<String, dynamic>> postMultipart(
    String path,
    Map<String, String> fields,
    String fileField,
    String filePath,
  ) async {
    final uri = Uri.parse('${AppConfig.apiUrl}$path');
    final request = http.MultipartRequest('POST', uri);
    if (_token != null) {
      request.headers['Authorization'] = 'Bearer $_token';
    }
    request.fields.addAll(fields);
    request.files.add(await http.MultipartFile.fromPath(fileField, filePath));
    final streamed = await request.send();
    final res = await http.Response.fromStream(streamed);
    return _handle(res);
  }

  Map<String, dynamic> _handle(http.Response res) {
    final body = res.body.isNotEmpty ? jsonDecode(res.body) : <String, dynamic>{};
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return body as Map<String, dynamic>;
    }
    throw ApiException(
      res.statusCode,
      body is Map ? (body['error'] as String? ?? 'Bir hata oluştu') : 'Bir hata oluştu',
    );
  }
}

class ApiException implements Exception {
  final int statusCode;
  final String message;
  ApiException(this.statusCode, this.message);

  @override
  String toString() => message;
}

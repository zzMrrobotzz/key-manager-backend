# Backend API - Tool Viết Truyện

Backend API để quản lý AI key tập trung và proxy các request AI cho frontend.

## 🚀 Cài đặt

```bash
cd backend
npm install
```

## ⚙️ Cấu hình

1. Tạo file `.env` từ `.env.example`:
```bash
cp .env.example .env
```

2. Cập nhật các biến môi trường trong `.env`:
```env
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
ADMIN_JWT_SECRET=your_super_secret_admin_jwt_key_here
USER_JWT_SECRET=your_super_secret_user_jwt_key_here
```

## 🏃‍♂️ Chạy server

```bash
# Development mode
npm run dev

# Production mode
npm start
```

Server sẽ chạy tại: `http://localhost:3001`

## 📋 API Endpoints

### 🔑 Key Management
- `GET /api/keys/validate` - Validate user key
- `POST /api/keys/use-credit` - Trừ credit

### 🤖 AI Proxy (cho user)
- `GET /api/ai/providers` - Lấy danh sách provider đang bật
- `POST /api/ai/generate` - Generate text
- `POST /api/ai/generate-image` - Generate image

### ⚙️ Admin Routes (quản lý AI key)
- `GET /api/admin/ai-keys` - Lấy danh sách AI keys
- `POST /api/admin/ai-keys` - Thêm/cập nhật AI key
- `DELETE /api/admin/ai-keys/:provider` - Xóa AI key
- `GET /api/admin/ai-keys/:provider` - Lấy thông tin AI key
- `POST /api/admin/ai-keys/test/:provider` - Test AI key

## 🔐 Bảo mật

- **API Key AI**: Chỉ lưu ở backend, không bao giờ gửi ra frontend
- **JWT Authentication**: Sử dụng JWT cho admin và user authentication
- **Rate Limiting**: Giới hạn số request để tránh spam
- **CORS**: Chỉ cho phép frontend domain được cấu hình
- **Helmet**: Bảo mật headers

## 📁 Cấu trúc thư mục

```
backend/
├── server.js              # Server chính
├── package.json           # Dependencies
├── ai-keys.json          # File lưu AI keys
├── middleware/
│   └── adminAuth.js      # Middleware xác thực
├── routes/
│   ├── keys.js           # Key management routes
│   ├── adminAIKeys.js    # Admin AI key routes
│   └── aiProxy.js        # AI proxy routes
├── services/
│   └── aiKeyManager.js   # Service quản lý AI keys
└── README.md
```

## 🔧 Cấu hình AI Providers

### 1. Cấu hình API keys
Admin có thể cấu hình API keys qua các endpoint:
- `POST /api/admin/ai-keys` với body: `{ "provider": "gemini", "apiKey": "your_key" }`

### 2. Test API keys
- `POST /api/admin/ai-keys/test/gemini` - Test Gemini API key
- `POST /api/admin/ai-keys/test/openai` - Test OpenAI API key

### 3. Hỗ trợ Providers
- **Gemini** (Google)
- **OpenAI** (GPT models)
- **DeepSeek**
- **Stability AI** (Image generation)
- **ElevenLabs** (TTS)

## 📊 Monitoring

- Health check: `GET /api/health`
- Logs được ghi ra console
- Rate limiting statistics
- AI request logs với user ID và provider

## 🚨 Troubleshooting

### Lỗi thường gặp:
1. **CORS Error**: Kiểm tra `FRONTEND_URL` trong `.env`
2. **JWT Error**: Kiểm tra `ADMIN_JWT_SECRET` và `USER_JWT_SECRET`
3. **AI API Error**: Kiểm tra API key trong `ai-keys.json`
4. **Rate Limit**: Giảm số request hoặc tăng limit

### Debug mode:
```bash
NODE_ENV=development npm run dev
``` 
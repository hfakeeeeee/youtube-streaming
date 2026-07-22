# Syncbox

Phòng nghe YouTube cộng tác theo thời gian thực, kết hợp room/queue đồng bộ với trải nghiệm xem tối giản và SponsorBlock.

## Tính năng MVP

- Tạo và tham gia phòng bằng mã 6 ký tự, không cần tài khoản.
- Host, DJ và Listener với quyền riêng biệt.
- Dán video, Shorts, playlist hoặc link `youtu.be` để thêm vào queue.
- Chỉ tìm kiếm YouTube sau khi người dùng nhấn Enter.
- Đồng bộ play, pause, seek, skip và video hiện tại qua Firebase.
- Chat, presence và quản lý vai trò trong phòng.
- SponsorBlock là thiết lập chung của room để mọi thiết bị cùng bỏ qua một đoạn.
- Giao diện responsive và hash routing tương thích GitHub Pages.

## Kiến trúc

- Frontend: React 19, TypeScript, Vite.
- Hosting: GitHub Pages.
- Realtime/Auth: Firebase Anonymous Auth + Realtime Database.
- API proxy: Cloudflare Worker.
- Player: YouTube IFrame API với `youtube-nocookie.com`.
- Sponsor data: SponsorBlock API.

## 1. Chạy frontend

```bash
npm install
Copy-Item .env.example .env.local
npm run dev
```

Điền các biến trong `.env.local` từ Firebase Console > Project settings > Your apps > Web app.

## 2. Cấu hình Firebase

1. Tạo Firebase project và Web app.
2. Authentication > Sign-in method > bật **Anonymous**.
3. Authentication > Settings > Authorized domains, thêm `YOUR_GITHUB_USERNAME.github.io`.
4. Realtime Database > Create database.
5. Sao chép `.firebaserc.example` thành `.firebaserc` và thay project ID.
6. Cài Firebase CLI và deploy rules:

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only database
```

Không dùng Test Mode khi đưa website lên public. `database.rules.json` đã giới hạn thao tác theo thành viên và vai trò.

## 3. Deploy Cloudflare Worker

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put YOUTUBE_API_KEY
npm run deploy
```

Trước khi deploy, sửa `ALLOWED_ORIGINS` trong `worker/wrangler.jsonc` thành domain GitHub Pages thực tế. API key được tạo trong Google Cloud Console sau khi bật YouTube Data API v3.

Worker cung cấp:

- `GET /api/search?q=...`
- `GET /api/videos/:videoId`
- `GET /api/playlists/:playlistId`
- `GET /api/sponsor/:videoId?categories=sponsor,intro`

## 4. Deploy GitHub Pages

Trong repository Settings:

1. Pages > Source chọn **GitHub Actions**.
2. Actions secrets and variables > Actions, thêm các secret trong `.env.example`.
3. `VITE_API_BASE_URL` là URL `https://syncbox-api.<account>.workers.dev`.
4. Push lên nhánh `main` hoặc chạy workflow **Deploy GitHub Pages** thủ công.

Vite tự đặt base path theo tên repository trong GitHub Actions. App dùng URL dạng `/#/room/ABC123`, nên refresh trực tiếp không bị lỗi 404.

## Kiểm tra

```bash
npm test
npm run lint
npm run build
cd worker
npm run typecheck
```

## Lưu ý

- YouTube IFrame có thể vẫn hiển thị quảng cáo do YouTube phân phối.
- Một số video giới hạn tuổi hoặc tắt embedding sẽ không phát được.
- SponsorBlock là dữ liệu cộng đồng và có thể không tồn tại cho mọi video.
- YouTube Search API có quota; Worker chỉ gọi search khi người dùng nhấn Enter và trả cache header cho kết quả.

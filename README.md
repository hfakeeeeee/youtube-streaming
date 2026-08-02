# Syncbox

Phòng nghe YouTube cộng tác theo thời gian thực, kết hợp room/queue đồng bộ với trải nghiệm xem tối giản và SponsorBlock.

## Tính năng MVP

- Tạo và tham gia phòng bằng mã 6 ký tự, không cần tài khoản.
- Owner, Co-host, DJ và Listener với quyền riêng biệt; Co-host vận hành phòng, DJ quản lý queue, play/pause và chuyển bài.
- Dán video, Shorts, playlist hoặc link `youtu.be` để thêm vào queue.
- Chỉ tìm kiếm YouTube sau khi người dùng nhấn Enter.
- Đồng bộ play, pause, seek và skip bằng thời gian Firebase server; âm lượng được lưu riêng trên từng thiết bị.
- Chat, presence, chuyển Owner an toàn, Co-host/DJ tự tiếp quản khi Owner offline và quản lý vai trò trong phòng.
- Voice chat dạng Discord qua Cloudflare Realtime SFU: mute, deafen, trạng thái đang nói, tự dọn presence khi rời phòng.
- Browser notification opt-in cho chat mới, quyền DJ/Co-host và force-mute; hỗ trợ tab nền qua Service Worker.
- Kick, ban, unban và rate limit cho chat/thêm bài; Owner và Co-host được bảo vệ theo cấp quyền.
- Danh sách phòng công khai trên trang chủ, đồng bộ qua một Firebase index riêng.
- Ba chế độ loop, queue kéo thả, bình chọn, chống bài trùng bằng transaction, lịch sử 50 bài, tổng thời lượng và xóa toàn bộ queue.
- Dashboard trạng thái Firebase/player/voice với tự phục hồi và thao tác retry thủ công.
- Player phân loại lỗi YouTube, tự thử lại tối đa 2 lần và để một coordinator duy nhất tự bỏ qua video hỏng.
- Activity log hiển thị 100 thay đổi gần nhất: thêm/xóa/chuyển bài, cài đặt, phân quyền và moderation.
- Firebase App Check (reCAPTCHA Enterprise), Database Rules và Worker rate limit bảo vệ các endpoint dễ bị spam.
- Room settings cho quyền thêm bài, chat, public/private và các nhóm SponsorBlock.
- Phòng hết hạn sau 7 ngày Host không hoạt động và được dọn khi có request truy cập tiếp theo.
- SponsorBlock là thiết lập chung của room để mọi thiết bị cùng bỏ qua một đoạn.
- Giao diện responsive và hash routing tương thích GitHub Pages.

## Kiến trúc

- Frontend: React 19, TypeScript, Vite.
- Hosting: GitHub Pages.
- Realtime/Auth: Firebase Anonymous Auth + Realtime Database.
- API proxy: Cloudflare Worker.
- Voice media: Cloudflare Realtime SFU; Firebase chỉ lưu presence, không vận chuyển âm thanh.
- Player: YouTube IFrame API với `youtube-nocookie.com`.
- Sponsor data: SponsorBlock API.

## 1. Tạo và cấu hình Firebase

### 1.1. Tạo project và đăng ký Web app

1. Mở [Firebase Console](https://console.firebase.google.com/) và chọn **Create a project**.
2. Google Analytics không bắt buộc cho Syncbox; có thể tắt.
3. Trong trang **Project overview**, bấm biểu tượng Web `</>`.
4. Đặt nickname, ví dụ `syncbox-web`, rồi bấm **Register app**.
5. Firebase hiển thị object `firebaseConfig`. Giữ trang này để lấy các giá trị:

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  appId: "..."
};
```

Nếu đã đóng màn hình này: bấm biểu tượng bánh răng cạnh **Project Overview** > **Project settings** > tab **General** > kéo xuống **Your apps** > chọn Web app > **SDK setup and configuration** > **Config**.

### 1.2. Bật Anonymous Authentication

1. Firebase Console > **Build** > **Authentication**.
2. Bấm **Get started** nếu đây là lần đầu.
3. Tab **Sign-in method** > chọn **Anonymous** > bật **Enable** > **Save**.
4. Authentication > **Settings** > **Authorized domains**:
   - Thêm `localhost` để chạy local nếu chưa có.
   - Thêm `YOUR_GITHUB_USERNAME.github.io` để chạy trên GitHub Pages.

Chỉ nhập hostname, không nhập `https://` và không nhập tên repository.

### 1.3. Tạo Realtime Database và lấy `VITE_FIREBASE_DATABASE_URL`

1. Firebase Console > **Build** > **Realtime Database**.
2. Bấm **Create Database**.
3. Chọn location gần người dùng của bạn.
4. Chọn **Locked mode**; rules của dự án sẽ được deploy ở bước sau.
5. Sau khi tạo xong, ở đầu tab **Data** sẽ có URL database, ví dụ:

```text
https://syncbox-demo-default-rtdb.asia-southeast1.firebasedatabase.app
```

Hoặc database tại `us-central1` có thể có dạng:

```text
https://syncbox-demo-default-rtdb.firebaseio.com
```

Sao chép nguyên URL, gồm cả `https://`. Đây chính là `VITE_FIREBASE_DATABASE_URL`.

### 1.4. Tạo `.env.local`

Từ thư mục gốc của dự án, chạy PowerShell:

```powershell
Copy-Item .env.example .env.local
```

Điền `.env.local` như sau:

```dotenv
VITE_FIREBASE_API_KEY=giá_trị_apiKey
VITE_FIREBASE_AUTH_DOMAIN=giá_trị_authDomain
VITE_FIREBASE_DATABASE_URL=https://ten-database.region.firebasedatabase.app
VITE_FIREBASE_PROJECT_ID=giá_trị_projectId
VITE_FIREBASE_APP_ID=giá_trị_appId
VITE_FIREBASE_APPCHECK_SITE_KEY=site_key_recaptcha_enterprise
VITE_API_BASE_URL=http://localhost:8787
```

Không thêm dấu nháy. `.env.local` đã nằm trong `.gitignore`.

### 1.5. Deploy Firebase Security Rules

Chạy tại thư mục gốc:

```powershell
npm install -g firebase-tools
firebase login
Copy-Item .firebaserc.example .firebaserc
firebase use --add
```

Khi `firebase use --add` hỏi, chọn Firebase project vừa tạo và đặt alias là `default`. Sau đó:

```powershell
firebase deploy --only database
```

Lệnh này deploy file `database.rules.json`. Không để database public bằng Test Mode.

## 2. Tạo YouTube API key

1. Mở [Google Cloud Console](https://console.cloud.google.com/).
2. Chọn đúng Google Cloud project được Firebase tạo, hoặc tạo một project riêng.
3. **APIs & Services** > **Library**.
4. Tìm **YouTube Data API v3** > **Enable**.
5. **APIs & Services** > **Credentials** > **Create credentials** > **API key**.
6. Mở API key vừa tạo > **API restrictions** > **Restrict key** > chỉ chọn **YouTube Data API v3** > **Save**.

Không đặt key này trong biến `VITE_...`; key chỉ được lưu trong Cloudflare Worker.

## 3. Cấu hình và deploy Cloudflare Worker

1. Tạo tài khoản Cloudflare nếu chưa có.
2. Mở `worker/wrangler.jsonc` và sửa:

```json
"ALLOWED_ORIGINS": "http://localhost:5173,https://YOUR_GITHUB_USERNAME.github.io"
```

3. Chạy:

```powershell
cd worker
npm install
npx wrangler login
npx wrangler secret put YOUTUBE_API_KEY
npx wrangler kv namespace create SEARCH_QUOTA
```

Khi được hỏi secret, dán YouTube API key. Lệnh tạo KV sẽ in ra một `id`. Thêm binding sau vào `worker/wrangler.jsonc` (thay ID bằng giá trị vừa nhận):

```jsonc
"kv_namespaces": [
  { "binding": "SEARCH_QUOTA", "id": "YOUR_KV_NAMESPACE_ID" }
]
```

KV này lưu bộ đếm tìm kiếm theo ngày để giao diện hiển thị quota ước tính. Sau đó deploy:

```powershell
npm run deploy
```

Cloudflare sẽ trả về URL dạng:

```text
https://syncbox-api.YOUR_SUBDOMAIN.workers.dev
```

Kiểm tra:

```text
https://syncbox-api.YOUR_SUBDOMAIN.workers.dev/api/health
```

Kết quả đúng là `{"ok":true}`. Quay lại thư mục gốc và thay `VITE_API_BASE_URL` trong `.env.local` bằng URL Worker này.

Worker cung cấp:

- `GET /api/search?q=...`
- `GET /api/quota`
- `GET /api/videos/:videoId`
- `GET /api/playlists/:playlistId`
- `GET /api/sponsor/:videoId?categories=sponsor,intro`
- `POST /api/voice/*` (yêu cầu Firebase ID token và capability của phiên)

### Bật voice chat

Voice chat cần một Cloudflare Realtime SFU App. App ID và App Secret chỉ được lưu trong Worker, tuyệt đối không đặt trong biến `VITE_...`:

1. Trong Cloudflare Dashboard, mở **Realtime** > **SFU** và tạo một app.
2. Sao chép **App ID** và **App Secret**.
3. Tại thư mục `worker`, nhập ba secret:

```powershell
npx wrangler secret put CLOUDFLARE_REALTIME_APP_ID
npx wrangler secret put CLOUDFLARE_REALTIME_APP_SECRET
npx wrangler secret put FIREBASE_DATABASE_URL
npm run deploy
```

`FIREBASE_DATABASE_URL` là đúng URL đã dùng cho `VITE_FIREBASE_DATABASE_URL`. Worker dùng Firebase ID token của trình duyệt để xác nhận người gọi đang ở trong room trước khi cấp phiên SFU; Worker không bao giờ gửi App Secret xuống frontend.

Mở endpoint health sau khi deploy:

```text
https://syncbox-api.YOUR_SUBDOMAIN.workers.dev/api/health
```

Kết quả có `"voice":true` nghĩa là đủ ba secret voice. Trường `"appCheck":true` chỉ xuất hiện sau khi Worker có `FIREBASE_PROJECT_NUMBER` và `FIREBASE_APP_ID`. Nếu `voice` là `false`, các tính năng nghe nhạc vẫn chạy nhưng nút tham gia voice sẽ báo chưa cấu hình.

Sau khi sửa `database.rules.json`, nhớ deploy Rules mới:

```powershell
firebase deploy --only database
```

Cloudflare Realtime có 1.000 GB egress miễn phí mỗi tháng theo gói hiện tại. Usage và giới hạn nên được theo dõi trực tiếp trong Cloudflare Dashboard vì chính sách có thể thay đổi.

### Dọn phòng hết hạn tự động

Worker chạy mỗi ngày lúc `03:00 UTC` và xóa đồng thời dữ liệu phòng, danh sách phòng công khai và chỉ mục hết hạn. Để bật tác vụ này:

1. Mở **Firebase Console** > **Project settings** > **Service accounts**.
2. Chọn **Generate new private key** và tải file JSON. Không commit hoặc đưa file này lên GitHub.
3. Trong thư mục `worker`, thêm ba secret từ file JSON:

```powershell
npx wrangler secret put FIREBASE_DATABASE_URL
npx wrangler secret put FIREBASE_CLIENT_EMAIL
npx wrangler secret put FIREBASE_PRIVATE_KEY
```

Giá trị tương ứng là URL Realtime Database (ví dụ `https://PROJECT-default-rtdb.asia-southeast1.firebasedatabase.app`), trường `client_email`, và trường `private_key`. Khi nhập private key, có thể dán nguyên giá trị nhiều dòng bao gồm cả `BEGIN PRIVATE KEY` và `END PRIVATE KEY`.

4. Deploy lại Worker để tạo Cron Trigger:

```powershell
npm run deploy
```

Nếu chưa cấu hình đủ ba secret, các API nghe nhạc/search vẫn hoạt động; Worker chỉ bỏ qua lượt dọn phòng theo lịch.

## 4. Chạy local

Mở terminal tại thư mục gốc:

```powershell
npm install
npm run dev
```

Mở `http://localhost:5173`. Để search và SponsorBlock hoạt động local, `VITE_API_BASE_URL` phải trỏ tới Worker đã deploy, hoặc chạy `npm run dev` trong thư mục `worker` và dùng `http://localhost:8787`.

## 5. Deploy GitHub Pages

### 5.1. Thêm GitHub Actions secrets

Trong GitHub repository:

1. **Settings** > **Secrets and variables** > **Actions**.
2. Chọn **New repository secret**.
3. Tạo đúng 7 secret sau, dùng giá trị từ `.env.local`:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_DATABASE_URL
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_APPCHECK_SITE_KEY
VITE_API_BASE_URL
```

`VITE_API_BASE_URL` phải là URL Worker đã deploy, không phải `localhost`.

### 5.2. Bật Firebase App Check

Syncbox dùng reCAPTCHA Enterprise dạng score-based nên người dùng không phải giải CAPTCHA. Hãy bật theo thứ tự dưới đây để không vô tình chặn website hoặc voice chat:

1. Google Cloud Console > **Security** > **reCAPTCHA Enterprise** > tạo key loại **Website**, không bật checkbox challenge. Thêm domain GitHub Pages của bạn.
2. Firebase Console > **App Check** > chọn Web app > đăng ký **reCAPTCHA Enterprise** bằng site key vừa tạo.
3. Điền site key công khai vào `VITE_FIREBASE_APPCHECK_SITE_KEY` trong `.env.local` và GitHub Actions secret cùng tên, sau đó deploy frontend.
4. Lấy **Project number** tại Firebase **Project settings > General**. Trong thư mục `worker`, thêm cấu hình bảo vệ custom API:

```powershell
npx wrangler secret put FIREBASE_PROJECT_NUMBER
npx wrangler secret put FIREBASE_APP_ID
npm run deploy
```

`FIREBASE_APP_ID` ở Worker dùng cùng giá trị với `VITE_FIREBASE_APP_ID`. Khi đủ hai giá trị này, Worker bắt buộc và xác minh chữ ký App Check cho mọi API trừ `/api/health`; nếu chưa cấu hình, Worker vẫn chạy ở chế độ tương thích để bạn rollout an toàn.

5. Kiểm tra Firebase App Check metrics. Khi request hợp lệ đã xuất hiện ổn định, mới bấm **Enforce** cho **Realtime Database**.

Để chạy local sau khi bật enforcement, đặt `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN=true`, mở DevTools để lấy debug token rồi đăng ký token đó tại Firebase Console > App Check > menu Web app > **Manage debug tokens**. Không commit debug token và không thêm biến debug này vào GitHub Pages production.

Tham khảo: [App Check với reCAPTCHA Enterprise](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider), [debug provider](https://firebase.google.com/docs/app-check/web/debug-provider), [xác minh custom backend](https://firebase.google.com/docs/app-check/custom-resource-backend).

Rate limit hiện tại gồm 12 lượt search/phút, 60 request metadata/phút và 120 request voice/phút trên mỗi dấu vân tay mạng; Realtime Database giới hạn chat 1 tin/1,5 giây và listener thêm queue 1 lượt/1,5 giây. Giao diện giữ queue ở tối đa 100 bài. Đây là lớp giảm spam, không thay thế quota chính thức của YouTube/Firebase/Cloudflare.

### 5.3. Bật GitHub Pages

1. Repository **Settings** > **Pages**.
2. Trong **Build and deployment**, tại **Source**, chọn **GitHub Actions**.
3. Push source code lên GitHub. Push sẽ không tự động deploy.
4. Mở tab **Actions** > chọn workflow **Deploy GitHub Pages** > **Run workflow** > chọn nhánh cần deploy > **Run workflow**.
5. Chờ cả `build` lẫn `deploy` chuyển màu xanh.
5. Website sẽ có dạng `https://YOUR_GITHUB_USERNAME.github.io/REPOSITORY_NAME/`.

Workflow đã nằm tại `.github/workflows/deploy-pages.yml`. Vite tự đặt base path theo tên repository. App dùng URL `/#/room/ABC123`, nên refresh room không bị GitHub Pages trả về 404.

## 6. Kiểm tra dự án

```powershell
npm test
npm run lint
npm run build
cd worker
npm run typecheck
```

## Lỗi setup thường gặp

- **Firebase chưa được cấu hình:** có ít nhất một biến `VITE_FIREBASE_...` đang trống; restart `npm run dev` sau khi sửa `.env.local`.
- **auth/unauthorized-domain:** thêm `localhost` hoặc `YOUR_GITHUB_USERNAME.github.io` vào Firebase Authentication > Settings > Authorized domains.
- **PERMISSION_DENIED:** Anonymous Auth chưa bật hoặc chưa chạy `firebase deploy --only database`.
- **Search báo lỗi/CORS:** kiểm tra `VITE_API_BASE_URL` và `ALLOWED_ORIGINS`, rồi deploy Worker lại.
- **Search báo quota:** YouTube Search API đã hết quota trong ngày; dán link video vẫn tiếp tục hoạt động.
- **Video không phát:** video có thể giới hạn tuổi, theo vùng hoặc đã tắt embedding.

## Lưu ý

- YouTube IFrame có thể vẫn hiển thị quảng cáo do YouTube phân phối.
- SponsorBlock là dữ liệu cộng đồng và có thể không tồn tại cho mọi video.
- Firebase config phía frontend không phải server secret; quyền truy cập dữ liệu được bảo vệ bằng Authentication và Database Rules.

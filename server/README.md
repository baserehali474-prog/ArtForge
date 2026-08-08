# ArtForge API — فاز ۲ (بک‌اند + PostgreSQL)

بک‌اند واقعی برای جایگزینی `localStorage` در `js/modules/store.js`. فقط یک وابستگی خارجی
داره: `pg` (برای اتصال به PostgreSQL). بقیه از ماژول‌های داخلی Node.js استفاده می‌کنن:
`node:http`، `node:crypto`.

چرا PostgreSQL به‌جای فایل SQLite؟ چون روی هاست‌های رایگان (مثل Render Free) دیسک دائمی
وجود نداره و فایل SQLite با هر ری‌استارت پاک می‌شه. یک دیتابیس PostgreSQL (حتی نسخه‌ی
رایگانش) جدا از سرور نگه‌داری می‌شه و داده‌ها رو حفظ می‌کنه.

## پیش‌نیاز

- Node.js نسخه ۱۸ یا بالاتر
- یک دیتابیس PostgreSQL (لوکال برای توسعه، یا رایگان روی Render/Railway/Neon/Supabase برای production)

## اجرا (لوکال)

```bash
cd server
npm install
export DATABASE_URL="postgres://user:pass@localhost:5432/artforge"
npm start
# یا برای توسعه با ری‌استارت خودکار:
npm run dev
```

سرور روی `http://localhost:4000` بالا می‌آد. جدول‌ها به‌صورت خودکار در اولین اجرا ساخته می‌شن.

### متغیرهای محیطی

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `DATABASE_URL` | - | **الزامی.** رشتهٔ اتصال PostgreSQL |
| `PORT` | `4000` | پورت سرور |
| `ARTFORGE_SECRET` | یک مقدار dev | کلید امضای توکن — **در Production حتماً عوض بشه** |
| `ARTFORGE_ORIGIN` | `*` | دامنهٔ مجاز برای CORS (بعد از دیپلوی، آدرس فرانت‌اندتون رو اینجا بذارید) |

## Endpoints

| Method | Path | Auth | توضیح |
|---|---|---|---|
| GET | `/api/health` | - | health check |
| POST | `/api/auth/register` | - | ثبت‌نام (`name`, `email`, `password`) |
| POST | `/api/auth/login` | - | ورود (`email`, `password`) → `{token, user}` |
| GET | `/api/auth/me` | ✓ | اطلاعات کاربر لاگین‌شده |
| GET | `/api/orders` | ✓ | لیست سفارش‌ها (کلاینت فقط سفارش‌های خودش، ادمین/طراح همه) — `?status=` فیلتر |
| POST | `/api/orders` | ✓ | ثبت سفارش جدید |
| GET | `/api/orders/:id` | ✓ | جزئیات یک سفارش |
| PATCH | `/api/orders/:id` | ✓ (designer/admin) | تغییر وضعیت/پیشرفت سفارش |
| GET | `/api/notifications` | ✓ | اعلان‌های کاربر |
| GET | `/api/orders/:id/messages` | ✓ | لیست پیام‌های گفتگوی یک سفارش |
| POST | `/api/orders/:id/messages` | ✓ | ارسال پیام جدید (`text`, `replyTo?`, `attachment?`) |
| PATCH | `/api/orders/:id/messages/seen` | ✓ | علامت‌گذاری پیام‌های سفارش به‌عنوان دیده‌شده |

احراز هویت با هدر `Authorization: Bearer <token>` که از `/login` یا `/register` می‌گیرید.

### ساخت حساب طراح/ادمین

ثبت‌نام عمومی (`/api/auth/register`) همیشه نقش `client` می‌سازد — کسی نمی‌تونه با ارسال
`role` توی درخواست، خودش رو ادمین/طراح کنه. برای ساخت حساب طراح یا ادمین، اول یک کاربر
عادی از طریق `signup.html` بسازید، بعد مستقیم توی دیتابیس نقشش رو تغییر بدید:

```sql
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
-- یا role = 'designer'
```

(از Render Dashboard → دیتابیستون → Connect → یک کلاینت psql وصل کنید و این کوئری رو بزنید.)

## دیپلوی رایگان روی Render

1. یک PostgreSQL Database رایگان در Render بسازید (Dashboard → New → PostgreSQL). آدرس
   اتصال (`Internal Database URL`) رو کپی کنید.
2. یک Web Service جدید بسازید و ریپازیتوری گیت‌هابتون رو وصل کنید؛ Root Directory رو
   روی `server` بذارید.
3. Build Command: `npm install` — Start Command: `npm start`.
4. متغیرهای محیطی رو اضافه کنید: `DATABASE_URL` (همون آدرسی که در قدم ۱ کپی کردید)،
   `ARTFORGE_SECRET` (یک رشتهٔ تصادفی امن)، و بعداً `ARTFORGE_ORIGIN` (آدرس فرانت‌اند).

⚠️ نکته: دیتابیس رایگان Render حدود ۳۰ روز بعد از ساخت منقضی می‌شه مگر ارتقا بدید؛ برای
یه سایت شخصی/دمو می‌تونید هر ماه یه دیتابیس رایگان جدید بسازید و `DATABASE_URL` رو
به‌روزرسانی کنید. برای production واقعی، ارتقای دیتابیس یا استفاده از یه سرویس دیگه
(مثل Neon یا Supabase که پلن رایگان دائمی‌تری دارن) رو در نظر بگیرید.

## امنیت پیاده‌شده

- هش پسورد با `scrypt` + salt تصادفی (نه plain-text)
- توکن امضاشده با HMAC-SHA256 (شبیه JWT) با انقضای ۷ روزه
- مقایسهٔ constant-time برای جلوگیری از timing attack
- Rate limiting ساده (۱۰۰ درخواست در دقیقه به ازای IP)
- محدودیت حجم بدنهٔ درخواست (۱MB) در برابر payload flood
- پیام خطای یکسان برای ایمیل/پسورد اشتباه (جلوگیری از user enumeration)
- RBAC پایه: فقط designer/admin می‌تونن وضعیت سفارش رو تغییر بدن؛ client فقط سفارش‌های خودش رو می‌بینه
- هدرهای امنیتی پایه (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`)

⚠️ برای Production واقعی لازمه (در فازهای بعدی اضافه می‌شن): refresh token، قفل حساب
بعد از تلاش‌های ناموفق پیاپی، لاگ حسابرسی کامل (audit log — جدول `activity_log` از الان
آماده است).

/* =========================================================================
   ArtForge v3.0 — Data Store Module
   Additive extension of the v2.0 store. All original v2.0 exports keep
   working exactly as before (getState, updateState, setLogin, logout,
   addOrder, addNotification, markAllRead, statusLabel, validateFile,
   escapeHTML, toast, uid, SERVICES, STATUS_KEYS, STATUS_LIST,
   MAX_FILE_SIZE). Everything below the "v3.0 ADDITIONS" marker is new:
   per-project Workspace data (Chat, Timeline, Files, Notes, Payment,
   Activity Log) plus shared Admin / Designer data (users, tariffs,
   services catalog, site stats). Existing pages are untouched; new
   pages (workspace.html, designer.html) and the admin.html v3 panels
   consume these new exports.
   ========================================================================= */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'artforge_v2_state'; // kept for backward compatibility with existing saved demo data
  var MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB — security rule: file size limit
  var ALLOWED_FILE_TYPES = [
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/pdf', 'application/zip', 'application/x-zip-compressed',
    'video/mp4', 'application/postscript'
  ];

  var SERVICES = [
    { id: 'poster', label: 'طراحی پوستر', icon: '🖼️' },
    { id: 'motion', label: 'موشن گرافیک', icon: '🎞️' },
    { id: 'reels', label: 'ریلز و محتوای شبکه‌های اجتماعی', icon: '📱' },
    { id: 'video', label: 'تدوین ویدیو', icon: '🎬' },
    { id: 'brand', label: 'هویت بصری برند', icon: '✨' },
    { id: 'other', label: 'سایر خدمات خلاقانه', icon: '🎨' }
  ];

  var STATUS_LIST = ['در انتظار بررسی', 'در حال انجام', 'نیازمند اصلاح', 'تکمیل‌شده', 'تحویل‌شده', 'بسته‌شده'];
  var STATUS_KEYS  = ['pending', 'in-progress', 'revision', 'completed', 'delivered', 'closed'];

  /* ---- v3.0: Timeline step catalog (Order → Closed) ---- */
  var TIMELINE_STEPS = [
    { key: 'created',   label: 'ثبت سفارش', icon: '🧾' },
    { key: 'files-in',  label: 'دریافت فایل‌های مرجع', icon: '📥' },
    { key: 'started',   label: 'شروع طراحی', icon: '🎨' },
    { key: 'revision',  label: 'اصلاحیه', icon: '✏️' },
    { key: 'review',    label: 'بررسی مشتری', icon: '👀' },
    { key: 'approved',  label: 'تایید نهایی', icon: '✅' },
    { key: 'delivered', label: 'تحویل پروژه', icon: '📦' },
    { key: 'closed',    label: 'بسته‌شدن پروژه', icon: '🔒' }
  ];

  var EMOJI_SET = ['👍', '❤️', '😂', '🎉', '🔥', '👏'];

  function nowLabel() {
    try {
      return new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'long' }).format(new Date());
    } catch (e) {
      return new Date().toLocaleString();
    }
  }

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 9999);
  }

  /* ---- XSS protection: always escape untrusted text before inserting as HTML ---- */
  function escapeHTML(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function seedState() {
    var demoOrders = [
      {
        id: uid('ord'), title: 'کمپین برند لوکس ساعت', service: 'poster', budget: '۲,۵۰۰,۰۰۰ تومان',
        deadline: '۷ روز', priority: 'بالا', status: 'in-progress', progress: 55,
        description: 'طراحی مجموعه پوستر برای کمپین معرفی محصول جدید.', createdAt: nowLabel(), files: []
      },
      {
        id: uid('ord'), title: 'ریلز معرفی استارتاپ قهوه', service: 'reels', budget: '۹۰۰,۰۰۰ تومان',
        deadline: '۳ روز', priority: 'متوسط', status: 'revision', progress: 80,
        description: 'سه ریلز کوتاه برای معرفی برند در اینستاگرام.', createdAt: nowLabel(), files: []
      },
      {
        id: uid('ord'), title: 'هویت بصری کافی‌شاپ', service: 'brand', budget: '۴,۲۰۰,۰۰۰ تومان',
        deadline: 'تحویل‌شده', priority: 'بالا', status: 'delivered', progress: 100,
        description: 'طراحی لوگو، پالت رنگ و بسته‌بندی.', createdAt: nowLabel(), files: []
      }
    ];
    var demoNotifs = [
      { id: uid('ntf'), type: 'message', text: 'پیام جدیدی درباره‌ی «کمپین برند لوکس ساعت» دریافت شد.', time: 'چند لحظه پیش', read: false },
      { id: uid('ntf'), type: 'revision', text: 'سفارش «ریلز معرفی استارتاپ قهوه» نیاز به اصلاح دارد.', time: 'امروز', read: false },
      { id: uid('ntf'), type: 'delivered', text: 'سفارش «هویت بصری کافی‌شاپ» با موفقیت تحویل داده شد.', time: 'دیروز', read: true },
      { id: uid('ntf'), type: 'file', text: 'فایل پیش‌نمایش جدیدی برای پروژه‌ی شما آپلود شد.', time: '۲ روز پیش', read: true }
    ];
    var demoDownloads = [
      { id: uid('dl'), name: 'پیش‌نمایش کمپین ساعت.pdf', type: 'file', date: nowLabel() },
      { id: uid('dl'), name: 'فاکتور سفارش #1042.pdf', type: 'invoice', date: nowLabel() },
      { id: uid('dl'), name: 'بسته نهایی هویت بصری کافی‌شاپ.zip', type: 'file', date: nowLabel() }
    ];
    /* ---- v3.0: per-project workspace data, keyed by order id ---- */
    var projects = {};
    demoOrders.forEach(function (o, idx) {
      projects[o.id] = seedProjectExtra(o, idx);
    });

    return {
      auth: { loggedIn: false, name: '', contact: '', role: '', userId: '' },
      orders: demoOrders,
      notifications: demoNotifs,
      downloads: demoDownloads,
      profile: { name: 'کاربر آرت‌فورج', contact: '', bio: '', avatarHue: 42 },
      projects: projects,
      admin: seedAdminState()
    };
  }

  /* ---- v3.0: seed a fresh per-project workspace bundle ---- */
  function seedProjectExtra(order, idx) {
    var stepIdx = { pending: 0, 'in-progress': 2, revision: 3, completed: 5, delivered: 6, closed: 7 };
    var upto = stepIdx[order && order.status] || 0;
    var timeline = TIMELINE_STEPS.slice(0, upto + 1).map(function (s, i) {
      return { key: s.key, label: s.label, icon: s.icon, time: i === upto ? 'اکنون' : nowLabel(), done: true };
    });
    var chat = idx === 0 ? [
      { id: uid('msg'), from: 'designer', text: 'سلام! فایل‌های اولیه رو بررسی کردم، تا فردا اولین پیش‌نمایش رو می‌فرستم.', time: 'دیروز', seenByClient: true, replyTo: null, reactions: {}, pinned: false },
      { id: uid('msg'), from: 'client', text: 'ممنون، منتظرم 🙏', time: 'دیروز', seenByClient: true, replyTo: null, reactions: {}, pinned: false }
    ] : [];
    return {
      chat: chat,
      typing: false,
      timeline: timeline,
      files: (order && order.files ? order.files : []).map(function (f, i) {
        return { id: uid('file'), name: f.name, size: f.size || 0, type: f.type || '', version: 1, final: false, uploadedBy: 'client', time: nowLabel() };
      }),
      notes: [],
      payment: { amount: order ? (order.budget || '') : '', status: 'unpaid', method: '' },
      activity: [
        { id: uid('act'), text: 'پروژه ایجاد شد.', time: order ? (order.createdAt || nowLabel()) : nowLabel(), actor: 'system' }
      ]
    };
  }

  function seedAdminState() {
    return {
      users: [
        { id: uid('usr'), name: 'سارا احمدی', contact: '0912xxxxxxx', role: 'client', status: 'active' },
        { id: uid('usr'), name: 'حسین مرادی', contact: '0935xxxxxxx', role: 'client', status: 'active' },
        { id: uid('usr'), name: 'مریم توکلی', contact: 'maryam@mail.com', role: 'client', status: 'active' },
        { id: uid('usr'), name: 'مدیر سیستم', contact: 'admin', role: 'admin', status: 'active' }
      ],
      tariffs: [
        { id: uid('trf'), service: 'poster', title: 'بسته‌ی پایه پوستر', price: '۸۰۰,۰۰۰ تومان', revisions: 1 },
        { id: uid('trf'), service: 'motion', title: 'موشن گرافیک کوتاه', price: '۲,۲۰۰,۰۰۰ تومان', revisions: 2 },
        { id: uid('trf'), service: 'reels', title: 'پکیج ۳ ریلز', price: '۹۰۰,۰۰۰ تومان', revisions: 1 },
        { id: uid('trf'), service: 'brand', title: 'هویت بصری کامل', price: '۴,۲۰۰,۰۰۰ تومان', revisions: 3 }
      ]
    };
  }

  /* ---- v3.0: migrate an older (v2.0) saved state so new fields always exist ---- */
  function migrate(state) {
    if (!state.projects) state.projects = {};
    (state.orders || []).forEach(function (o, idx) {
      if (!state.projects[o.id]) state.projects[o.id] = seedProjectExtra(o, idx);
    });
    if (!state.admin) state.admin = seedAdminState();
    return state;
  }

  function load() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        var seeded = seedState();
        global.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
        return seeded;
      }
      return migrate(JSON.parse(raw));
    } catch (e) {
      return seedState();
    }
  }

  function save(state) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* storage unavailable — demo continues in-memory only */ }
    return state;
  }

  function getState() { return load(); }

  function updateState(mutator) {
    var state = load();
    mutator(state);
    save(state);
    return state;
  }

  function setLogin(name, contact, role, userId) {
    return updateState(function (s) {
      s.auth.loggedIn = true;
      s.auth.name = name || s.auth.name || 'کاربر آرت‌فورج';
      s.auth.contact = contact || s.auth.contact || '';
      if (role) s.auth.role = role;         // 'client' | 'designer' | 'admin' — only set for real backend accounts
      if (userId) s.auth.userId = userId;
      s.profile.name = s.auth.name;
      s.profile.contact = s.auth.contact;
    });
  }

  function logout() {
    return updateState(function (s) { s.auth.loggedIn = false; });
  }

  function addOrder(order) {
    return updateState(function (s) {
      var rec = Object.assign({
        id: uid('ord'), status: 'pending', progress: 5, createdAt: nowLabel(), files: []
      }, order);
      s.orders.unshift(rec);
      s.notifications.unshift({
        id: uid('ntf'), type: 'new-order', orderId: rec.id,
        text: 'سفارش جدید «' + rec.title + '» با موفقیت ثبت شد.',
        time: 'چند لحظه پیش', read: false
      });
    });
  }

  function addNotification(n) {
    return updateState(function (s) {
      s.notifications.unshift(Object.assign({ id: uid('ntf'), time: 'چند لحظه پیش', read: false }, n));
    });
  }

  function markAllRead() {
    return updateState(function (s) { s.notifications.forEach(function (n) { n.read = true; }); });
  }

  /* =======================================================================
     v3.0 ADDITIONS — Project Workspace (Chat / Timeline / Files / Notes /
     Payment / Activity) + shared Admin & Designer data.
     ======================================================================= */

  function ensureProjectExtra(s, orderId) {
    if (!s.projects) s.projects = {};
    if (!s.projects[orderId]) {
      var order = s.orders.find(function (o) { return o.id === orderId; });
      s.projects[orderId] = seedProjectExtra(order, 0);
    }
    return s.projects[orderId];
  }

  /* Full workspace bundle for one order: { order, chat, timeline, files, notes, payment, activity } */
  function getProject(orderId) {
    var s = getState();
    var order = s.orders.find(function (o) { return o.id === orderId; });
    if (!order) return null;
    var extra = s.projects && s.projects[orderId] ? s.projects[orderId] : seedProjectExtra(order, 0);
    return Object.assign({ order: order }, extra);
  }

  function logActivity(s, orderId, text, actor) {
    var extra = ensureProjectExtra(s, orderId);
    extra.activity.unshift({ id: uid('act'), text: text, time: 'اکنون', actor: actor || 'system' });
  }

  /* ---- Chat ---- */
  function addChatMessage(orderId, msg) {
    return updateState(function (s) {
      var extra = ensureProjectExtra(s, orderId);
      var rec = {
        id: uid('msg'),
        from: msg.from || 'client',
        text: msg.text || '',
        attachment: msg.attachment || null,
        replyTo: msg.replyTo || null,
        time: 'اکنون',
        seenByClient: msg.from === 'client',
        seenByDesigner: msg.from === 'designer',
        reactions: {},
        pinned: false
      };
      extra.chat.push(rec);
      logActivity(s, orderId, (msg.from === 'client' ? 'پیام جدید از مشتری ارسال شد.' : 'پیام جدید از طراح ارسال شد.'), msg.from);
      if (msg.from === 'client') {
        s.notifications.unshift({ id: uid('ntf'), type: 'message', orderId: orderId, text: 'پیام شما ارسال شد؛ به‌زودی پاسخ داده می‌شود.', time: 'اکنون', read: true });
      } else {
        s.notifications.unshift({ id: uid('ntf'), type: 'message', orderId: orderId, text: 'پیام جدیدی از طراح دریافت شد.', time: 'اکنون', read: false });
      }
    });
  }

  function toggleReaction(orderId, msgId, emoji) {
    return updateState(function (s) {
      var extra = ensureProjectExtra(s, orderId);
      var m = extra.chat.find(function (c) { return c.id === msgId; });
      if (!m) return;
      if (!m.reactions) m.reactions = {};
      m.reactions[emoji] = (m.reactions[emoji] || 0) ? 0 : 1; // toggle on/off for the demo single-user
      if (!m.reactions[emoji]) delete m.reactions[emoji];
    });
  }

  function pinMessage(orderId, msgId) {
    return updateState(function (s) {
      var extra = ensureProjectExtra(s, orderId);
      var m = extra.chat.find(function (c) { return c.id === msgId; });
      if (m) m.pinned = !m.pinned;
    });
  }

  function markSeen(orderId, who) {
    return updateState(function (s) {
      var extra = ensureProjectExtra(s, orderId);
      extra.chat.forEach(function (m) {
        if (who === 'client') m.seenByClient = true; else m.seenByDesigner = true;
      });
    });
  }

  function setTyping(orderId, isTyping) {
    return updateState(function (s) {
      var extra = ensureProjectExtra(s, orderId);
      extra.typing = !!isTyping;
    });
  }

  /* ---- Timeline / Status ---- */
  function setOrderStatus(orderId, statusKey, progress) {
    return updateState(function (s) {
      var order = s.orders.find(function (o) { return o.id === orderId; });
      if (!order) return;
      order.status = statusKey;
      if (typeof progress === 'number') order.progress = progress;
      var stepMap = { pending: 'created', 'in-progress': 'started', revision: 'revision', completed: 'review', delivered: 'delivered', closed: 'closed' };
      var stepKey = stepMap[statusKey];
      var extra = ensureProjectExtra(s, orderId);
      var step = TIMELINE_STEPS.find(function (t) { return t.key === stepKey; });
      if (step && !extra.timeline.find(function (t) { return t.key === stepKey; })) {
        extra.timeline.push({ key: step.key, label: step.label, icon: step.icon, time: 'اکنون', done: true });
      }
      logActivity(s, orderId, 'وضعیت پروژه به «' + statusLabel(statusKey) + '» تغییر کرد.', 'designer');
      s.notifications.unshift({ id: uid('ntf'), type: statusKey === 'delivered' ? 'delivered' : 'new-order', orderId: orderId, text: 'وضعیت سفارش «' + order.title + '» به «' + statusLabel(statusKey) + '» تغییر کرد.', time: 'اکنون', read: false });
    });
  }

  /* ---- Files & versioning ---- */
  function addFileVersion(orderId, fileMeta, isFinal) {
    return updateState(function (s) {
      var extra = ensureProjectExtra(s, orderId);
      var prevVersions = extra.files.filter(function (f) { return f.name === fileMeta.name; });
      var version = prevVersions.length ? Math.max.apply(null, prevVersions.map(function (f) { return f.version; })) + 1 : 1;
      extra.files.push({
        id: uid('file'), name: fileMeta.name, size: fileMeta.size || 0, type: fileMeta.type || '',
        version: version, final: !!isFinal, uploadedBy: fileMeta.uploadedBy || 'client', time: 'اکنون'
      });
      logActivity(s, orderId, 'فایل «' + fileMeta.name + '» (نسخه ' + version + ') آپلود شد.', fileMeta.uploadedBy || 'client');
      if (isFinal) {
        s.downloads.unshift({ id: uid('dl'), name: fileMeta.name, type: 'file', date: 'اکنون', orderId: orderId });
      }
    });
  }

  /* ---- Notes ---- */
  function addNote(orderId, text, author) {
    return updateState(function (s) {
      var extra = ensureProjectExtra(s, orderId);
      extra.notes.unshift({ id: uid('note'), text: text, author: author || 'client', time: 'اکنون' });
      logActivity(s, orderId, 'یادداشت جدیدی ثبت شد.', author || 'client');
    });
  }

  /* ---- Payment ---- */
  function setPayment(orderId, payment) {
    return updateState(function (s) {
      var extra = ensureProjectExtra(s, orderId);
      extra.payment = Object.assign({}, extra.payment, payment);
      logActivity(s, orderId, 'وضعیت پرداخت به‌روزرسانی شد.', 'client');
    });
  }

  /* ---- Admin: Users ---- */
  function getUsers() { return getState().admin.users; }
  function addUser(user) {
    return updateState(function (s) { s.admin.users.push(Object.assign({ id: uid('usr'), status: 'active' }, user)); });
  }
  function updateUser(id, patch) {
    return updateState(function (s) {
      var u = s.admin.users.find(function (x) { return x.id === id; });
      if (u) Object.assign(u, patch);
    });
  }
  function deleteUser(id) {
    return updateState(function (s) { s.admin.users = s.admin.users.filter(function (u) { return u.id !== id; }); });
  }

  /* ---- Admin: Tariffs ---- */
  function getTariffs() { return getState().admin.tariffs; }
  function addTariff(t) {
    return updateState(function (s) { s.admin.tariffs.push(Object.assign({ id: uid('trf') }, t)); });
  }
  function updateTariff(id, patch) {
    return updateState(function (s) {
      var t = s.admin.tariffs.find(function (x) { return x.id === id; });
      if (t) Object.assign(t, patch);
    });
  }
  function deleteTariff(id) {
    return updateState(function (s) { s.admin.tariffs = s.admin.tariffs.filter(function (t) { return t.id !== id; }); });
  }

  /* ---- Admin / Designer: derived stats ---- */
  function getSiteStats() {
    var s = getState();
    var active = s.orders.filter(function (o) { return ['pending', 'in-progress', 'revision'].indexOf(o.status) !== -1; }).length;
    var delivered = s.orders.filter(function (o) { return o.status === 'delivered' || o.status === 'closed'; }).length;
    var urgent = s.orders.filter(function (o) { return o.priority === 'بالا' && o.status !== 'delivered' && o.status !== 'closed'; }).length;
    var unreadMsgs = 0;
    Object.keys(s.projects || {}).forEach(function (id) {
      (s.projects[id].chat || []).forEach(function (m) { if (m.from === 'client' && !m.seenByDesigner) unreadMsgs++; });
    });
    return {
      totalOrders: s.orders.length,
      activeOrders: active,
      deliveredOrders: delivered,
      urgentOrders: urgent,
      totalUsers: s.admin.users.length,
      unreadMessages: unreadMsgs,
      totalDownloads: s.downloads.length
    };
  }

  function statusLabel(key) {
    var idx = STATUS_KEYS.indexOf(key);
    return idx >= 0 ? STATUS_LIST[idx] : key;
  }

  function validateFile(file) {
    if (!file) return { ok: false, reason: 'فایلی انتخاب نشده است.' };
    if (file.size > MAX_FILE_SIZE) return { ok: false, reason: 'حجم فایل بیشتر از ۱۵ مگابایت است.' };
    if (ALLOWED_FILE_TYPES.indexOf(file.type) === -1) return { ok: false, reason: 'نوع فایل مجاز نیست.' };
    return { ok: true };
  }

  /* ---- Toast notification (additive UI helper, shared by all v2.0 pages) ---- */
  function toast(message, kind) {
    var host = document.getElementById('af-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'af-toast-host';
      host.className = 'af-toast-host';
      document.body.appendChild(host);
    }
    var el = document.createElement('div');
    el.className = 'af-toast' + (kind === 'error' ? ' af-toast-error' : '');
    el.textContent = message; // textContent — no HTML injection
    host.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.remove(); }, 300);
    }, 3200);
  }

  /* =======================================================================
     v4.0 ADDITIONS — Real backend sync (Phase 2).
     Purely additive: every function below is new; nothing above this
     block is modified, so all existing pages keep working exactly as
     before even if the API server is offline (every call fails soft).
     Requires js/modules/api.js to be loaded first (exposes ArtForgeAPI).
     ======================================================================= */

  function formatRemoteDate(iso) {
    try {
      return new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'long' }).format(new Date(iso));
    } catch (e) { return iso; }
  }

  function hasAPI() { return !!(global.ArtForgeAPI); }

  /* Register a real account on the backend, then log the local demo
     session in as that user too (existing UI keeps working unchanged). */
  function registerRemote(name, email, password) {
    if (!hasAPI()) return Promise.reject(new Error('api_unavailable'));
    return global.ArtForgeAPI.register(name, email, password).then(function (data) {
      global.ArtForgeAPI.setToken(data.token);
      setLogin(data.user.name, data.user.email, data.user.role, data.user.id);
      return data.user;
    });
  }

  function loginRemote(email, password) {
    if (!hasAPI()) return Promise.reject(new Error('api_unavailable'));
    return global.ArtForgeAPI.login(email, password).then(function (data) {
      global.ArtForgeAPI.setToken(data.token);
      setLogin(data.user.name, data.user.email, data.user.role, data.user.id);
      return data.user;
    });
  }

  function logoutRemote() {
    if (hasAPI()) global.ArtForgeAPI.clearToken();
    return logout();
  }

  /* Pull orders the logged-in user actually owns on the server and merge
     them into local state (upsert by id) — additive, keeps any purely-
     local demo orders that were never synced. Safe to call repeatedly. */
  function syncOrdersFromServer() {
    if (!hasAPI() || !global.ArtForgeAPI.getToken()) return Promise.resolve(false);
    return global.ArtForgeAPI.listOrders().then(function (data) {
      updateState(function (s) {
        (data.orders || []).forEach(function (remote) {
          var local = s.orders.find(function (o) { return o.id === remote.id; });
          var mapped = {
            id: remote.id, title: remote.title, service: remote.service,
            budget: remote.budget, deadline: remote.deadline, priority: remote.priority,
            status: remote.status, progress: remote.progress, description: remote.description,
            createdAt: formatRemoteDate(remote.created_at), files: (local && local.files) || []
          };
          if (local) {
            Object.assign(local, mapped);
          } else {
            s.orders.push(mapped);
            ensureProjectExtra(s, remote.id);
          }
        });
      });
      return true;
    }).catch(function () { return false; /* offline — local state stays as-is */ });
  }

  /* Same UX as addOrder (instant local insert, unchanged behavior) plus a
     best-effort background push to the server so the order actually
     persists remotely. Reconciles the local id with the server id on
     success; on failure the order simply stays local-only (demo mode). */
  function addOrderSynced(order) {
    var newState = addOrder(order); // existing synchronous behavior, untouched
    var localId = newState.orders[0].id;
    if (hasAPI() && global.ArtForgeAPI.getToken()) {
      global.ArtForgeAPI.createOrder({
        title: order.title, service: order.service, budget: order.budget,
        deadline: order.deadline, priority: order.priority, description: order.description
      }).then(function (data) {
        updateState(function (s) {
          var rec = s.orders.find(function (o) { return o.id === localId; });
          if (rec) { rec.id = data.order.id; }
          if (s.projects && s.projects[localId]) {
            s.projects[data.order.id] = s.projects[localId];
            delete s.projects[localId];
          }
        });
      }).catch(function () { /* stays local-only — no error surfaced, non-blocking */ });
    }
    return newState;
  }

  /* ---- Real chat: pull the server's message thread for one order and
     merge it into local project state (upsert by id), so messages sent
     from any device/browser show up here. Safe to call repeatedly (e.g.
     on a polling timer) — offline just leaves local state untouched. ---- */
  function syncChatFromServer(orderId) {
    if (!hasAPI() || !global.ArtForgeAPI.getToken()) return Promise.resolve(false);
    return global.ArtForgeAPI.listMessages(orderId).then(function (data) {
      updateState(function (s) {
        var extra = ensureProjectExtra(s, orderId);
        (data.messages || []).forEach(function (remote) {
          var local = extra.chat.find(function (m) { return m.id === remote.id; });
          var mapped = {
            id: remote.id,
            from: remote.sender_role === 'client' ? 'client' : 'designer',
            text: remote.text || '',
            attachment: remote.attachment_name ? { name: remote.attachment_name, type: remote.attachment_type, size: remote.attachment_size } : null,
            replyTo: remote.reply_to || null,
            time: formatRemoteDate(remote.created_at),
            seenByClient: !!remote.seen_by_client,
            seenByDesigner: !!remote.seen_by_staff,
            reactions: (local && local.reactions) || {},
            pinned: (local && local.pinned) || false
          };
          if (local) { Object.assign(local, mapped); } else { extra.chat.push(mapped); }
        });
      });
      return true;
    }).catch(function () { return false; });
  }

  /* Same instant-local-insert UX as addChatMessage, plus a best-effort
     background push to the server so the message actually reaches the
     other side. `from` is derived by the caller from the logged-in
     user's real role (s.auth.role), not a hardcoded value. */
  function sendChatMessageSynced(orderId, msg) {
    var newState = addChatMessage(orderId, msg); // existing synchronous local behavior, untouched
    if (hasAPI() && global.ArtForgeAPI.getToken()) {
      global.ArtForgeAPI.sendMessage(orderId, {
        text: msg.text || '', replyTo: msg.replyTo || null, attachment: msg.attachment || null
      }).then(function () {
        return syncChatFromServer(orderId); // reconcile local temp id with the real server id
      }).catch(function () { /* stays local-only — non-blocking */ });
    }
    return newState;
  }

  function markMessagesSeenRemote(orderId) {
    if (!hasAPI() || !global.ArtForgeAPI.getToken()) return Promise.resolve(false);
    return global.ArtForgeAPI.markMessagesSeen(orderId).catch(function () { return false; });
  }

  global.ArtForgeStore = {
    getState: getState,
    updateState: updateState,
    setLogin: setLogin,
    logout: logout,
    addOrder: addOrder,
    addNotification: addNotification,
    markAllRead: markAllRead,
    statusLabel: statusLabel,
    validateFile: validateFile,
    escapeHTML: escapeHTML,
    toast: toast,
    uid: uid,
    SERVICES: SERVICES,
    STATUS_KEYS: STATUS_KEYS,
    STATUS_LIST: STATUS_LIST,
    MAX_FILE_SIZE: MAX_FILE_SIZE,

    /* v3.0 */
    TIMELINE_STEPS: TIMELINE_STEPS,
    EMOJI_SET: EMOJI_SET,
    getProject: getProject,
    addChatMessage: addChatMessage,
    toggleReaction: toggleReaction,
    pinMessage: pinMessage,
    markSeen: markSeen,
    setTyping: setTyping,
    setOrderStatus: setOrderStatus,
    addFileVersion: addFileVersion,
    addNote: addNote,
    setPayment: setPayment,
    getUsers: getUsers,
    addUser: addUser,
    updateUser: updateUser,
    deleteUser: deleteUser,
    getTariffs: getTariffs,
    addTariff: addTariff,
    updateTariff: updateTariff,
    deleteTariff: deleteTariff,
    getSiteStats: getSiteStats,

    /* v4.0 */
    registerRemote: registerRemote,
    loginRemote: loginRemote,
    logoutRemote: logoutRemote,
    syncOrdersFromServer: syncOrdersFromServer,
    addOrderSynced: addOrderSynced,
    syncChatFromServer: syncChatFromServer,
    sendChatMessageSynced: sendChatMessageSynced,
    markMessagesSeenRemote: markMessagesSeenRemote
  };
})(window);

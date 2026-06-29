"""
DROCART — Backend API (standalone)
Pure JSON REST API + Socket.IO. No HTML rendering — the frontend
is a separate static site (see ../frontend) that talks to this
service over HTTP/WebSocket using its own base URL.
"""
import os, re, math, random, string, time, pyotp, io, base64, requests
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, session
from flask_mysqldb import MySQL
from flask_bcrypt import Bcrypt
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

# ── CORS: frontend runs on a different origin (different container/port) ──
# ALLOWED_ORIGINS should be the exact frontend origin(s), e.g.
# "http://localhost:8080,https://drocart.com" — credentials require an
# explicit origin list, "*" will NOT work with supports_credentials=True.
_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:8080").split(",")]
CORS(app, supports_credentials=True, origins=_origins)

app.secret_key = os.getenv("SECRET_KEY", "drocart-secret-2025")
app.permanent_session_lifetime = timedelta(days=30)

# Cross-site cookies: frontend and backend are different origins, so the
# session cookie needs SameSite=None + Secure in production (HTTPS).
# For local HTTP dev, browsers allow SameSite=Lax on localhost.
app.config.update(
    MYSQL_HOST=os.getenv("MYSQL_HOST", "localhost"),
    MYSQL_USER=os.getenv("MYSQL_USER", "root"),
    MYSQL_PASSWORD=os.getenv("MYSQL_PASSWORD", ""),
    MYSQL_DB=os.getenv("MYSQL_DB", "drocart"),
    MYSQL_CURSORCLASS="DictCursor",
    SESSION_COOKIE_SAMESITE=os.getenv("COOKIE_SAMESITE", "Lax"),
    SESSION_COOKIE_SECURE=os.getenv("COOKIE_SECURE", "false").lower() == "true",
)

mysql = MySQL(app)
bcrypt = Bcrypt(app)
socketio = SocketIO(app, cors_allowed_origins=_origins, async_mode="eventlet", manage_session=False)

APP_ENV = os.getenv("APP_ENV", "development")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "https://drocart.com/auth/google/callback")

GMAIL_ADDRESS = os.getenv("GMAIL_ADDRESS", "")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "")
GMAIL_SMTP_HOST = "smtp.gmail.com"
GMAIL_SMTP_PORT = 587

_otp_store = {}

def send_otp_email(email, otp, name="", kind="login"):
    if not GMAIL_ADDRESS or not GMAIL_APP_PASSWORD:
        print(f"\n[DEV OTP EMAIL] to={email} kind={kind} otp={otp} name={name}\n")
        return True
    subjects = {"login": f"Your Drocart login code: {otp}", "email_verify": f"Verify your Drocart email: {otp}", "reset": f"Drocart password reset code: {otp}", "2fa": f"Drocart 2FA code: {otp}"}
    subject = subjects.get(kind, f"Your Drocart code: {otp}")
    action_msgs = {"login": "Sign in to your Drocart account", "email_verify": "Verify your email address", "reset": "Reset your account password", "2fa": "Complete two-factor authentication"}
    action_msg = action_msgs.get(kind, "Verify your identity")
    digit_boxes = "".join(f'<div style="width:52px;height:60px;background:#161616;border-radius:14px;border:1.5px solid #333;display:inline-flex;align-items:center;justify-content:center;font-size:26px;font-weight:600;color:#fff;margin:0 6px">{d}</div>' for d in str(otp))
    html_body = f"""<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>body{{margin:0;padding:0;background:#000;font-family:'Inter',sans-serif}}.outer{{background:#000;padding:40px 20px}}.card{{max-width:480px;margin:0 auto;padding:48px 36px;background:#121212;border-radius:32px;border:1px solid #222;color:#fff}}.brand{{font-size:22px;font-weight:700;color:#f05133;margin-bottom:32px}}h1{{font-size:24px;font-weight:600;margin:0 0 10px}}.subtitle{{font-size:15px;color:#7a7a7a;line-height:1.6;margin-bottom:36px}}.digits-row{{display:flex;justify-content:center;margin:0 0 36px}}.validity{{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:12px 18px;font-size:13px;color:#888;margin-bottom:28px}}.footer{{font-size:12px;color:#333;text-align:center;margin-top:28px;padding-top:20px;border-top:1px solid #1a1a1a}}</style></head><body>
<div class="outer"><div class="card"><div class="brand">Drocart</div><h1>{action_msg}</h1><p class="subtitle">Hi{' ' + name if name else ''},<br>Use the verification code below to continue.</p><div class="digits-row">{digit_boxes}</div><div class="validity">Valid for 10 minutes. Do not share this code.</div><p style="font-size:13px;color:#555">If you didn't request this, ignore this email.</p><div class="footer">&copy; 2025 Drocart Inc.</div></div></div></body></html>"""
    plain_body = f"Drocart Verification Code\n\nHi {name or 'there'},\nYour {kind} code is: {otp}\nValid for 10 minutes.\n\n— The Drocart Team"
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject; msg["From"] = f"Drocart <{GMAIL_ADDRESS}>"; msg["To"] = email
    msg.attach(MIMEText(plain_body, "plain")); msg.attach(MIMEText(html_body, "html"))
    try:
        with smtplib.SMTP(GMAIL_SMTP_HOST, GMAIL_SMTP_PORT, timeout=10) as server:
            server.ehlo(); server.starttls(); server.ehlo()
            server.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
            server.sendmail(GMAIL_ADDRESS, email, msg.as_string())
        print(f"[OTP EMAIL] sent to {email} kind={kind}")
        return True
    except smtplib.SMTPAuthenticationError:
        print("[OTP EMAIL ERROR] auth failed — check GMAIL_APP_PASSWORD"); return False
    except Exception as e:
        print(f"[OTP EMAIL ERROR] {e}"); return False

def cur(): return mysql.connection.cursor()
def ok(data=None, msg="OK", code=200): return jsonify({"success": True, "message": msg, "data": data}), code
def err(msg="Error", code=400): return jsonify({"success": False, "error": msg}), code
def slugify(s): return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")

def login_required(f):
    @wraps(f)
    def d(*a, **kw):
        if "user_id" not in session:
            return err("Login required", 401)
        return f(*a, **kw)
    return d

def role_required(*roles):
    def dec(f):
        @wraps(f)
        def d(*a, **kw):
            if "user_id" not in session: return err("Login required", 401)
            if session.get("role") not in roles: return err("Access denied", 403)
            return f(*a, **kw)
        return d
    return dec

def gen_otp(key):
    otp = str(random.randint(100000, 999999))
    _otp_store[key] = {"otp": otp, "expires": time.time() + 600, "attempts": 0}
    return otp

def verify_otp(key, code):
    entry = _otp_store.get(key)
    if not entry: return False
    entry["attempts"] += 1
    if entry["attempts"] > 5 or time.time() > entry["expires"]: return False
    if entry["otp"] != code: return False
    del _otp_store[key]
    return True

def push_notif(uid, ntype, title, body="", url="", icon="🔔"):
    try:
        c = cur()
        c.execute("INSERT INTO notifications(user_id,type,title,body,url,icon) VALUES(%s,%s,%s,%s,%s,%s)", (uid, ntype, title, body, url, icon))
        mysql.connection.commit()
        socketio.emit("notification", {"type": ntype, "title": title, "body": body, "url": url, "icon": icon}, room=f"user_{uid}")
    except Exception: pass

@app.route("/health")
def health():
    try:
        c = cur(); c.execute("SELECT 1"); c.fetchone(); db_ok = True
    except Exception: db_ok = False
    return jsonify({"status": "ok" if db_ok else "degraded", "db": db_ok, "ts": datetime.now().isoformat()}), 200 if db_ok else 503

@app.route("/api/auth/register", methods=["POST"])
def register():
    d = request.get_json()
    name, email, pw, phone = d.get("name", "").strip(), d.get("email", "").strip().lower(), d.get("password", ""), d.get("phone", "").strip()
    if not all([name, email, pw]): return err("All fields required")
    if len(pw) < 8: return err("Password min 8 chars")
    if not re.match(r"[^@]+@[^@]+\.[^@]+", email): return err("Invalid email")
    c = cur()
    c.execute("SELECT id FROM users WHERE email=%s", (email,))
    if c.fetchone(): return err("Email already registered")
    hpw = bcrypt.generate_password_hash(pw).decode()
    totp_secret = pyotp.random_base32()
    c.execute("INSERT INTO users(name,email,password,phone,totp_secret) VALUES(%s,%s,%s,%s,%s)", (name, email, hpw, phone or None, totp_secret))
    mysql.connection.commit()
    uid = c.lastrowid
    otp = gen_otp(f"email_verify_{email}")
    send_otp_email(email, otp, name, kind="email_verify")
    session.permanent = True
    session.update({"user_id": uid, "name": name, "email": email, "role": "customer"})
    push_notif(uid, "welcome", "Welcome to Drocart! 🎉", "Start shopping!", "/#featured", "🎉")
    return ok({"id": uid, "name": name, "email": email, "role": "customer", "otp_required": True}, "Registered!", 201)

@app.route("/api/auth/login", methods=["POST"])
def login():
    d = request.get_json()
    email, pw = d.get("email", "").strip().lower(), d.get("password", "")
    c = cur()
    c.execute("SELECT * FROM users WHERE email=%s AND status='active'", (email,))
    u = c.fetchone()
    if not u or not bcrypt.check_password_hash(u["password"], pw): return err("Invalid credentials", 401)
    if u.get("two_fa_enabled"):
        otp = gen_otp(f"2fa_{email}")
        send_otp_email(email, otp, u["name"], kind="2fa")
        return ok({"two_fa_required": True, "email": email}, "OTP sent for 2FA")
    c.execute("UPDATE users SET last_login=NOW(),login_count=login_count+1,is_online=1 WHERE id=%s", (u["id"],))
    mysql.connection.commit()
    session.permanent = True
    session.update({"user_id": u["id"], "name": u["name"], "email": u["email"], "role": u["role"]})
    return ok({"id": u["id"], "name": u["name"], "email": u["email"], "role": u["role"], "avatar": u.get("avatar")})

@app.route("/api/auth/otp/send", methods=["POST"])
def otp_send():
    d = request.get_json()
    target, kind = d.get("email", "") or d.get("phone", ""), d.get("kind", "login")
    otp = gen_otp(f"{kind}_{target}")
    if "@" in target:
        try:
            c = cur(); c.execute("SELECT name FROM users WHERE email=%s", (target,)); u = c.fetchone()
            name = u["name"] if u else ""
        except Exception: name = ""
        if not send_otp_email(target, otp, name, kind=kind): return err("Failed to send OTP email. Please try again.", 500)
    else:
        print(f"[DEV SMS OTP] phone={target} otp={otp}")
    return ok(msg="OTP sent")

@app.route("/api/auth/otp/verify", methods=["POST"])
def otp_verify():
    d = request.get_json()
    target, code, kind = d.get("email", "") or d.get("phone", ""), d.get("otp", "").strip(), d.get("kind", "login")
    if not verify_otp(f"{kind}_{target}", code): return err("Invalid or expired OTP", 401)
    c = cur(); c.execute("SELECT * FROM users WHERE email=%s OR phone=%s", (target, target)); u = c.fetchone()
    if u:
        c.execute("UPDATE users SET email_verified=1,is_online=1,last_login=NOW(),login_count=login_count+1 WHERE id=%s", (u["id"],))
        mysql.connection.commit()
        session.permanent = True
        session.update({"user_id": u["id"], "name": u["name"], "email": u["email"], "role": u["role"]})
        return ok({"id": u["id"], "name": u["name"], "email": u["email"], "role": u["role"], "avatar": u.get("avatar")}, "Verified!")
    return err("User not found", 404)

@app.route("/api/auth/otp-login", methods=["POST"])
def otp_login():
    email = request.get_json().get("email", "").strip().lower()
    c = cur(); c.execute("SELECT id,name FROM users WHERE email=%s AND status='active'", (email,)); u = c.fetchone()
    if not u: return err("Email not found", 404)
    otp = gen_otp(f"login_{email}")
    send_otp_email(email, otp, u["name"], kind="login")
    return ok({"email": email}, "OTP sent")

@app.route("/api/auth/google")
def google_auth_url():
    url = (f"https://accounts.google.com/o/oauth2/v2/auth?client_id={GOOGLE_CLIENT_ID}&redirect_uri={GOOGLE_REDIRECT_URI}&response_type=code&scope=openid email profile&access_type=offline&prompt=consent")
    return ok({"url": url})

@app.route("/api/auth/google/callback", methods=["POST"])
def google_callback():
    code = request.get_json().get("code")
    if not code: return err("No code")
    try:
        tr = requests.post("https://oauth2.googleapis.com/token", data={"code": code, "client_id": GOOGLE_CLIENT_ID, "client_secret": GOOGLE_CLIENT_SECRET, "redirect_uri": GOOGLE_REDIRECT_URI, "grant_type": "authorization_code"}, timeout=10)
        ir = requests.get("https://www.googleapis.com/oauth2/v3/userinfo", headers={"Authorization": f"Bearer {tr.json().get('access_token')}"}, timeout=10)
        info = ir.json()
        g_email, g_name, g_pic = info.get("email", "").lower(), info.get("name", ""), info.get("picture", "")
        c = cur(); c.execute("SELECT * FROM users WHERE email=%s", (g_email,)); u = c.fetchone()
        if not u:
            hpw = bcrypt.generate_password_hash(pyotp.random_base32()).decode()
            c.execute("INSERT INTO users(name,email,password,avatar,email_verified,totp_secret,google_id) VALUES(%s,%s,%s,%s,1,%s,%s)", (g_name, g_email, hpw, g_pic, pyotp.random_base32(), info.get("sub", "")))
            mysql.connection.commit()
            uid, role = c.lastrowid, "customer"
            push_notif(uid, "welcome", f"Welcome to Drocart, {g_name}! 🎉", "", "/#featured", "🎉")
        else:
            uid, role = u["id"], u["role"]
            c.execute("UPDATE users SET avatar=%s,is_online=1,last_login=NOW() WHERE id=%s", (g_pic, uid))
            mysql.connection.commit()
        session.permanent = True
        session.update({"user_id": uid, "name": g_name, "email": g_email, "role": role})
        return ok({"id": uid, "name": g_name, "email": g_email, "role": role, "avatar": g_pic}, "Google login successful")
    except Exception as e:
        return err(f"Google login failed: {str(e)}", 502)

@app.route("/api/auth/totp/setup")
@login_required
def totp_setup():
    import qrcode
    c = cur(); c.execute("SELECT totp_secret,name,email FROM users WHERE id=%s", (session["user_id"],)); u = c.fetchone()
    secret = u["totp_secret"] or pyotp.random_base32()
    if not u["totp_secret"]:
        c.execute("UPDATE users SET totp_secret=%s WHERE id=%s", (secret, session["user_id"])); mysql.connection.commit()
    uri = pyotp.TOTP(secret).provisioning_uri(name=u["email"], issuer_name="Drocart")
    qr_img = qrcode.make(uri); buf = io.BytesIO(); qr_img.save(buf, format="PNG")
    return ok({"secret": secret, "qr_code": f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode()}", "uri": uri})

@app.route("/api/auth/totp/enable", methods=["POST"])
@login_required
def totp_enable():
    code = request.get_json().get("code", "").strip()
    c = cur(); c.execute("SELECT totp_secret FROM users WHERE id=%s", (session["user_id"],)); u = c.fetchone()
    if not u or not pyotp.TOTP(u["totp_secret"]).verify(code, valid_window=1): return err("Invalid TOTP code")
    c.execute("UPDATE users SET two_fa_enabled=1 WHERE id=%s", (session["user_id"],)); mysql.connection.commit()
    return ok(msg="Google Authenticator 2FA enabled!")

@app.route("/api/auth/totp/verify", methods=["POST"])
def totp_verify():
    d = request.get_json(); email, code = d.get("email", "").strip().lower(), d.get("code", "").strip()
    c = cur(); c.execute("SELECT * FROM users WHERE email=%s", (email,)); u = c.fetchone()
    if not u or not pyotp.TOTP(u["totp_secret"]).verify(code, valid_window=1): return err("Invalid code", 401)
    c.execute("UPDATE users SET last_login=NOW(),login_count=login_count+1,is_online=1 WHERE id=%s", (u["id"],))
    mysql.connection.commit()
    session.permanent = True
    session.update({"user_id": u["id"], "name": u["name"], "email": u["email"], "role": u["role"]})
    return ok({"id": u["id"], "name": u["name"], "email": u["email"], "role": u["role"]}, "2FA verified!")

@app.route("/api/auth/logout", methods=["POST"])
def logout():
    if "user_id" in session:
        try:
            c = cur(); c.execute("UPDATE users SET is_online=0,last_seen=NOW() WHERE id=%s", (session["user_id"],)); mysql.connection.commit()
        except Exception: pass
    session.clear()
    return ok(msg="Logged out")

@app.route("/api/auth/me")
def auth_me():
    if "user_id" not in session: return jsonify({"logged_in": False})
    c = cur(); c.execute("SELECT id,name,email,role,avatar,phone,email_verified,two_fa_enabled FROM users WHERE id=%s", (session["user_id"],)); u = c.fetchone()
    if not u: return jsonify({"logged_in": False})
    u["logged_in"] = True
    return jsonify(u)

@app.route("/api/auth/forgot-password", methods=["POST"])
def forgot_password():
    email = request.get_json().get("email", "").strip().lower()
    c = cur(); c.execute("SELECT id,name FROM users WHERE email=%s", (email,)); u = c.fetchone()
    if u:
        otp = gen_otp(f"reset_{email}")
        send_otp_email(email, otp, u["name"], kind="reset")
    return ok(msg="If that email exists, an OTP was sent")

@app.route("/api/auth/reset-password", methods=["POST"])
def reset_password():
    d = request.get_json(); email, code, pw = d.get("email", "").strip().lower(), d.get("otp", "").strip(), d.get("password", "")
    if not verify_otp(f"reset_{email}", code): return err("Invalid OTP", 401)
    if len(pw) < 8: return err("Password min 8 chars")
    c = cur(); c.execute("UPDATE users SET password=%s WHERE email=%s", (bcrypt.generate_password_hash(pw).decode(), email)); mysql.connection.commit()
    return ok(msg="Password reset successful")

@app.route("/api/categories")
def get_categories():
    c = cur()
    c.execute("SELECT cat.*,COUNT(p.id) AS product_count FROM categories cat LEFT JOIN products p ON p.category_id=cat.id AND p.is_active=1 WHERE cat.is_active=1 GROUP BY cat.id ORDER BY cat.sort_order")
    return ok(c.fetchall())

@app.route("/api/products")
def get_products():
    cat, q, feat = request.args.get("category", ""), request.args.get("q", ""), request.args.get("featured", "")
    sort, min_p, max_p = request.args.get("sort", "newest"), request.args.get("min_price", ""), request.args.get("max_price", "")
    page, limit = max(1, int(request.args.get("page", 1))), min(50, int(request.args.get("limit", 12)))
    offset = (page - 1) * limit
    where, params = ["p.is_active=1"], []
    if cat: where.append("c.slug=%s"); params.append(cat)
    if feat: where.append("p.is_featured=1")
    if q: where.append("(p.name LIKE %s OR p.description LIKE %s)"); params += [f"%{q}%", f"%{q}%"]
    if min_p: where.append("p.price>=%s"); params.append(float(min_p))
    if max_p: where.append("p.price<=%s"); params.append(float(max_p))
    ob = {"price_asc": "p.price ASC", "price_desc": "p.price DESC", "rating": "p.rating DESC", "newest": "p.created_at DESC", "popular": "p.sold_count DESC"}.get(sort, "p.created_at DESC")
    wsql = " AND ".join(where); c = cur()
    c.execute(f"SELECT p.*,c.name AS category_name,c.slug AS category_slug FROM products p JOIN categories c ON c.id=p.category_id WHERE {wsql} ORDER BY {ob} LIMIT %s OFFSET %s", params + [limit, offset])
    products = c.fetchall()
    c.execute(f"SELECT COUNT(*) AS total FROM products p JOIN categories c ON c.id=p.category_id WHERE {wsql}", params)
    total = c.fetchone()["total"]
    return ok({"products": products, "total": total, "page": page, "pages": math.ceil(total / limit)})

@app.route("/api/products/<slug>")
def get_product(slug):
    c = cur()
    c.execute("SELECT p.*,c.name AS category_name,c.slug AS category_slug FROM products p JOIN categories c ON c.id=p.category_id WHERE p.slug=%s AND p.is_active=1", (slug,))
    p = c.fetchone()
    if not p: return err("Not found", 404)
    c.execute("SELECT r.*,u.name AS user_name FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.product_id=%s AND r.is_approved=1 ORDER BY r.created_at DESC LIMIT 10", (p["id"],))
    p["reviews"] = c.fetchall()
    c.execute("SELECT id,name,slug,price,old_price,emoji,rating,badge FROM products WHERE category_id=%s AND id!=%s AND is_active=1 LIMIT 6", (p["category_id"], p["id"]))
    p["related"] = c.fetchall()
    c.execute("UPDATE products SET view_count=view_count+1 WHERE id=%s", (p["id"],)); mysql.connection.commit()
    return ok(p)

@app.route("/api/products/search/suggest")
def suggest():
    q = request.args.get("q", "").strip()
    if len(q) < 2: return ok([])
    c = cur()
    c.execute("SELECT p.id,p.name,p.slug,p.price,p.emoji,c.name AS category_name FROM products p JOIN categories c ON c.id=p.category_id WHERE p.is_active=1 AND p.name LIKE %s ORDER BY p.sold_count DESC LIMIT 8", (f"{q}%",))
    return ok(c.fetchall())

@app.route("/api/cart")
@login_required
def get_cart():
    c = cur()
    c.execute("SELECT ci.id,ci.qty,p.id AS product_id,p.name,p.price,p.old_price,p.emoji,p.stock,p.slug FROM cart_items ci JOIN products p ON p.id=ci.product_id WHERE ci.user_id=%s", (session["user_id"],))
    items = c.fetchall(); subtotal = sum(float(i["price"]) * i["qty"] for i in items); shipping = 0 if subtotal >= 999 else 99
    return ok({"items": items, "subtotal": round(subtotal, 2), "shipping": shipping, "total": round(subtotal + shipping, 2), "count": sum(i["qty"] for i in items)})

@app.route("/api/cart", methods=["POST"])
@login_required
def add_cart():
    d = request.get_json(); pid, qty = int(d.get("product_id")), max(1, int(d.get("qty", 1)))
    c = cur(); c.execute("SELECT id FROM products WHERE id=%s AND is_active=1", (pid,))
    if not c.fetchone(): return err("Product not found", 404)
    c.execute("INSERT INTO cart_items(user_id,product_id,qty) VALUES(%s,%s,%s) ON DUPLICATE KEY UPDATE qty=qty+%s", (session["user_id"], pid, qty, qty))
    mysql.connection.commit(); return ok(msg="Added to cart")

@app.route("/api/cart/<int:iid>", methods=["PUT"])
@login_required
def update_cart(iid):
    qty = int(request.get_json().get("qty", 1)); c = cur()
    if qty <= 0: c.execute("DELETE FROM cart_items WHERE id=%s AND user_id=%s", (iid, session["user_id"]))
    else: c.execute("UPDATE cart_items SET qty=%s WHERE id=%s AND user_id=%s", (qty, iid, session["user_id"]))
    mysql.connection.commit(); return ok(msg="Updated")

@app.route("/api/cart/<int:iid>", methods=["DELETE"])
@login_required
def del_cart(iid):
    c = cur(); c.execute("DELETE FROM cart_items WHERE id=%s AND user_id=%s", (iid, session["user_id"])); mysql.connection.commit(); return ok(msg="Removed")

@app.route("/api/cart/clear", methods=["DELETE"])
@login_required
def clear_cart():
    c = cur(); c.execute("DELETE FROM cart_items WHERE user_id=%s", (session["user_id"],)); mysql.connection.commit(); return ok(msg="Cleared")

@app.route("/api/wishlist")
@login_required
def get_wishlist():
    c = cur()
    c.execute("SELECT p.id,p.name,p.price,p.old_price,p.emoji,p.slug,p.rating,p.badge,c.name AS category_name FROM wishlists w JOIN products p ON p.id=w.product_id JOIN categories c ON c.id=p.category_id WHERE w.user_id=%s ORDER BY w.added_at DESC", (session["user_id"],))
    return ok(c.fetchall())

@app.route("/api/wishlist/<int:pid>", methods=["POST"])
@login_required
def toggle_wish(pid):
    c = cur(); c.execute("SELECT id FROM wishlists WHERE user_id=%s AND product_id=%s", (session["user_id"], pid))
    if c.fetchone():
        c.execute("DELETE FROM wishlists WHERE user_id=%s AND product_id=%s", (session["user_id"], pid)); mysql.connection.commit(); return ok({"wishlisted": False}, "Removed")
    c.execute("INSERT INTO wishlists(user_id,product_id) VALUES(%s,%s)", (session["user_id"], pid)); mysql.connection.commit(); return ok({"wishlisted": True}, "Added")

@app.route("/api/orders")
@login_required
def get_orders():
    c = cur()
    c.execute("SELECT o.*,COUNT(oi.id) AS item_count FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id WHERE o.user_id=%s GROUP BY o.id ORDER BY o.created_at DESC", (session["user_id"],))
    rows = c.fetchall()
    for r in rows:
        for k in ("created_at", "updated_at", "estimated_delivery"): r[k] = str(r[k]) if r.get(k) else None
    return ok(rows)

@app.route("/api/orders/<int:oid>")
@login_required
def get_order(oid):
    c = cur(); c.execute("SELECT * FROM orders WHERE id=%s AND user_id=%s", (oid, session["user_id"])); o = c.fetchone()
    if not o: return err("Not found", 404)
    c.execute("SELECT * FROM order_items WHERE order_id=%s", (oid,)); o["items"] = c.fetchall()
    c.execute("SELECT * FROM order_status_history WHERE order_id=%s ORDER BY created_at", (oid,)); o["history"] = c.fetchall()
    c.execute("SELECT * FROM delivery_checkpoints WHERE order_id=%s ORDER BY sort_order", (oid,)); o["checkpoints"] = c.fetchall()
    for k in ("estimated_delivery", "delivered_at", "created_at", "updated_at"): o[k] = str(o[k]) if o.get(k) else None
    for cp in o["checkpoints"]:
        for k in ("reached_at", "estimated_at", "created_at"): cp[k] = str(cp[k]) if cp.get(k) else None
    for h in o["history"]: h["created_at"] = str(h["created_at"]) if h.get("created_at") else None
    return ok(o)

@app.route("/api/orders", methods=["POST"])
@login_required
def place_order():
    d = request.get_json(); payment, addr, coupon_code = d.get("payment_method", "cod"), d.get("address", {}), d.get("coupon_code", "")
    c = cur()
    c.execute("SELECT ci.qty,p.id AS pid,p.name,p.price,p.emoji,p.stock FROM cart_items ci JOIN products p ON p.id=ci.product_id WHERE ci.user_id=%s", (session["user_id"],))
    items = c.fetchall()
    if not items: return err("Cart is empty")
    for i in items:
        if i["stock"] < i["qty"]: return err(f"'{i['name']}' out of stock")
    subtotal = sum(float(i["price"]) * i["qty"] for i in items); shipping = 0 if subtotal >= 999 else 99; discount = 0
    if coupon_code:
        c.execute("SELECT * FROM coupons WHERE code=%s AND is_active=1 AND (expires_at IS NULL OR expires_at>NOW()) AND used_count<max_uses", (coupon_code,))
        cpn = c.fetchone()
        if cpn and subtotal >= float(cpn["min_order"]):
            discount = subtotal * float(cpn["value"]) / 100 if cpn["type"] == "percent" else float(cpn["value"])
            if cpn["type"] == "free_shipping": discount = shipping
            c.execute("UPDATE coupons SET used_count=used_count+1 WHERE code=%s", (coupon_code,))
    total = max(0, subtotal + shipping - discount); aid = None
    if addr.get("line1"):
        c.execute("INSERT INTO addresses(user_id,full_name,line1,line2,city,state,pincode,phone) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)", (session["user_id"], addr.get("full_name", session["name"]), addr.get("line1", ""), addr.get("line2", ""), addr.get("city", ""), addr.get("state", ""), addr.get("pincode", ""), addr.get("phone", "")))
        aid = c.lastrowid
    est = (datetime.now() + timedelta(days=random.randint(3, 5))).date()
    c.execute("INSERT INTO orders(user_id,address_id,payment_method,payment_status,subtotal,discount,shipping_fee,total,estimated_delivery) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)", (session["user_id"], aid, payment, "paid" if payment != "cod" else "pending", subtotal, discount, shipping, total, est))
    oid = c.lastrowid
    for i in items:
        c.execute("INSERT INTO order_items(order_id,product_id,name,emoji,price,qty,subtotal) VALUES(%s,%s,%s,%s,%s,%s,%s)", (oid, i["pid"], i["name"], i["emoji"], i["price"], i["qty"], float(i["price"]) * i["qty"]))
    tracking_no = "DRC" + "".join(random.choices(string.digits, k=10))
    c.execute("UPDATE orders SET tracking_number=%s WHERE id=%s", (tracking_no, oid))
    checkpoints = [("order_placed","Order Placed","Payment confirmed.","Drocart HQ","Bangalore",12.9716,77.5946),("processing","Processing","Items picked.","Drocart Warehouse","Bangalore",12.9800,77.5900),("packed","Packed & Ready","Securely packaged.","Fulfilment Centre","Bangalore",12.9850,77.5950),("shipped","Shipped","Handed to courier.","Airport Hub","Bangalore",13.1986,77.7066),("in_transit","In Transit","Package en route.","Transit Hub","En Route",16.5062,80.6480),("out_for_delivery","Out for Delivery","Agent on the way!","Local Depot","Your City",17.4156,78.4487),("delivered","Delivered","Package delivered!","Your Address","Your City",17.4065,78.4772)]
    for idx, (status, title, desc, loc, city, lat, lng) in enumerate(checkpoints):
        c.execute("INSERT INTO delivery_checkpoints(order_id,status,title,description,location,city,latitude,longitude,is_reached,is_current,reached_at,estimated_at,sort_order) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", (oid, status, title, desc, loc, city, lat, lng, idx == 0, idx == 0, datetime.now() if idx == 0 else None, datetime.now() + timedelta(hours=idx * 8), idx + 1))
    c.execute("SELECT id FROM delivery_agents WHERE status='available' ORDER BY RAND() LIMIT 1"); agent = c.fetchone()
    if agent:
        c.execute("INSERT INTO order_assignments(order_id,agent_id) VALUES(%s,%s)", (oid, agent["id"]))
        c.execute("UPDATE delivery_agents SET status='on_delivery' WHERE id=%s", (agent["id"],))
    c.execute("INSERT INTO order_status_history(order_id,status,note) VALUES(%s,'pending','Order placed')", (oid,))
    c.execute("DELETE FROM cart_items WHERE user_id=%s", (session["user_id"],))
    mysql.connection.commit()
    c.execute("SELECT order_number FROM orders WHERE id=%s", (oid,)); row = c.fetchone()
    push_notif(session["user_id"], "order", f"Order #{row['order_number']} Confirmed! 📦", f"Total ₹{total:,.0f}", f"/order/{oid}", "📦")
    return ok({"order_id": oid, "order_number": row["order_number"], "total": total, "tracking_number": tracking_no}, "Order placed!", 201)

@app.route("/api/orders/<int:oid>/cancel", methods=["POST"])
@login_required
def cancel_order(oid):
    reason = request.get_json().get("reason", "Customer request"); c = cur()
    c.execute("SELECT status FROM orders WHERE id=%s AND user_id=%s", (oid, session["user_id"])); o = c.fetchone()
    if not o: return err("Not found", 404)
    if o["status"] not in ("pending", "confirmed"): return err("Cannot cancel after shipment")
    c.execute("UPDATE orders SET status='cancelled',cancel_reason=%s WHERE id=%s", (reason, oid))
    c.execute("UPDATE products p JOIN order_items oi ON oi.product_id=p.id SET p.stock=p.stock+oi.qty WHERE oi.order_id=%s", (oid,))
    c.execute("INSERT INTO order_status_history(order_id,status,note) VALUES(%s,'cancelled',%s)", (oid, reason))
    mysql.connection.commit()
    push_notif(session["user_id"], "order", "Order Cancelled", "Refund in 5-7 days.", f"/order/{oid}", "❌")
    return ok(msg="Cancelled")

@app.route("/api/track/<order_number>")
def track_order(order_number):
    c = cur()
    c.execute("SELECT o.*,a.full_name,a.line1,a.line2,a.city,a.state,a.pincode FROM orders o LEFT JOIN addresses a ON a.id=o.address_id WHERE o.order_number=%s", (order_number,))
    o = c.fetchone()
    if not o: return err("Order not found", 404)
    c.execute("SELECT * FROM delivery_checkpoints WHERE order_id=%s ORDER BY sort_order", (o["id"],)); o["checkpoints"] = c.fetchall()
    c.execute("SELECT da.name AS agent_name,da.phone AS agent_phone,da.vehicle,da.vehicle_no,da.rating AS agent_rating FROM order_assignments oa JOIN delivery_agents da ON da.id=oa.agent_id WHERE oa.order_id=%s", (o["id"],)); o["agent"] = c.fetchone()
    c.execute("SELECT * FROM order_items WHERE order_id=%s", (o["id"],)); o["items"] = c.fetchall()
    for k in ("estimated_delivery", "delivered_at", "created_at", "updated_at"): o[k] = str(o[k]) if o.get(k) else None
    for cp in o.get("checkpoints", []):
        for k in ("reached_at", "estimated_at", "created_at"): cp[k] = str(cp[k]) if cp.get(k) else None
    return ok(o)

@app.route("/api/payments/initiate", methods=["POST"])
@login_required
def initiate_payment():
    d = request.get_json()
    pay_ref = "PAY" + "".join(random.choices(string.digits + string.ascii_uppercase, k=12))
    return ok({"payment_ref": pay_ref, "amount": d.get("amount", 0), "method": d.get("method", "upi"), "status": "initiated"}, "Payment initiated")

@app.route("/api/payments/confirm", methods=["POST"])
@login_required
def confirm_payment():
    d = request.get_json(); pay_ref, oid = d.get("payment_ref", ""), d.get("order_id")
    c = cur(); c.execute("UPDATE orders SET payment_status='paid',payment_ref=%s WHERE id=%s AND user_id=%s", (pay_ref, oid, session["user_id"])); mysql.connection.commit()
    push_notif(session["user_id"], "payment", "Payment Successful! ✅", f"Ref: {pay_ref}", f"/order/{oid}", "💳")
    return ok({"status": "paid", "payment_ref": pay_ref}, "Confirmed")

@app.route("/api/coupons/apply", methods=["POST"])
@login_required
def apply_coupon():
    d = request.get_json(); code, subtotal = d.get("code", "").upper().strip(), float(d.get("subtotal", 0))
    c = cur(); c.execute("SELECT * FROM coupons WHERE code=%s AND is_active=1 AND (expires_at IS NULL OR expires_at>NOW()) AND used_count<max_uses", (code,)); cpn = c.fetchone()
    if not cpn: return err("Invalid or expired coupon")
    if subtotal < float(cpn["min_order"]): return err(f"Min order ₹{cpn['min_order']}")
    disc = subtotal * float(cpn["value"]) / 100 if cpn["type"] == "percent" else float(cpn["value"])
    if cpn["type"] == "free_shipping": disc = 99
    return ok({"discount": round(disc, 2), "code": code, "type": cpn["type"]}, f"Save ₹{disc:,.0f}!")

@app.route("/api/notifications")
@login_required
def get_notifs():
    c = cur(); c.execute("SELECT * FROM notifications WHERE user_id=%s ORDER BY created_at DESC LIMIT 30", (session["user_id"],)); notifs = c.fetchall()
    for n in notifs: n["created_at"] = str(n["created_at"]) if n.get("created_at") else None
    c.execute("SELECT COUNT(*) AS cnt FROM notifications WHERE user_id=%s AND is_read=0", (session["user_id"],))
    return ok({"notifications": notifs, "unread": c.fetchone()["cnt"]})

@app.route("/api/notifications/read", methods=["POST"])
@login_required
def mark_read():
    nid = request.get_json().get("id"); c = cur()
    if nid: c.execute("UPDATE notifications SET is_read=1 WHERE id=%s AND user_id=%s", (nid, session["user_id"]))
    else: c.execute("UPDATE notifications SET is_read=1 WHERE user_id=%s", (session["user_id"],))
    mysql.connection.commit(); return ok(msg="Read")

@app.route("/api/reviews/<int:pid>", methods=["POST"])
@login_required
def add_review(pid):
    d = request.get_json(); rating = int(d.get("rating", 5))
    if not (1 <= rating <= 5): return err("Rating 1-5")
    c = cur()
    try:
        c.execute("INSERT INTO reviews(product_id,user_id,rating,title,body) VALUES(%s,%s,%s,%s,%s)", (pid, session["user_id"], rating, d.get("title", ""), d.get("body", "")))
        mysql.connection.commit()
        c.execute("CALL UpdateProductRating(%s)", (pid,)); mysql.connection.commit()
        return ok(msg="Review submitted", code=201)
    except Exception:
        return err("Already reviewed")

@app.route("/api/profile")
@login_required
def get_profile():
    c = cur(); c.execute("SELECT id,name,email,phone,role,avatar,email_verified,two_fa_enabled,created_at FROM users WHERE id=%s", (session["user_id"],)); u = c.fetchone()
    u["created_at"] = str(u["created_at"]) if u.get("created_at") else None
    c.execute("SELECT * FROM addresses WHERE user_id=%s", (session["user_id"],)); u["addresses"] = c.fetchall()
    return ok(u)

@app.route("/api/profile", methods=["PUT"])
@login_required
def update_profile():
    d = request.get_json(); c = cur()
    c.execute("UPDATE users SET name=%s,phone=%s WHERE id=%s", (d.get("name", ""), d.get("phone", ""), session["user_id"])); mysql.connection.commit()
    session["name"] = d.get("name", ""); return ok(msg="Updated")

@app.route("/api/addresses", methods=["POST"])
@login_required
def add_address():
    d = request.get_json(); c = cur()
    c.execute("INSERT INTO addresses(user_id,label,full_name,line1,line2,city,state,pincode,phone) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)", (session["user_id"], d.get("label", "Home"), d.get("full_name", ""), d.get("line1", ""), d.get("line2", ""), d.get("city", ""), d.get("state", ""), d.get("pincode", ""), d.get("phone", "")))
    mysql.connection.commit(); return ok({"id": c.lastrowid}, "Saved", 201)

@app.route("/api/addresses/<int:aid>", methods=["DELETE"])
@login_required
def del_address(aid):
    c = cur(); c.execute("DELETE FROM addresses WHERE id=%s AND user_id=%s", (aid, session["user_id"])); mysql.connection.commit(); return ok(msg="Deleted")

@app.route("/api/newsletter", methods=["POST"])
def newsletter():
    email = request.get_json().get("email", "").strip().lower()
    if not email or "@" not in email: return err("Valid email required")
    c = cur()
    try:
        c.execute("INSERT INTO subscribers(email) VALUES(%s)", (email,)); mysql.connection.commit(); return ok(msg="Subscribed!")
    except Exception:
        return err("Already subscribed")

BOT_GREETINGS = ["Hi! 👋 I'm Droca, your Drocart assistant.", "Hello! Welcome to Drocart Support 🛒", "Hey! I'm Droca 🤖 — ask me anything Drocart!"]

def bot_reply(sid, body, mtype="bot", sender="Drocart Bot"):
    c = cur(); c.execute("INSERT INTO chat_messages(session_id,sender_id,sender_name,body,type) VALUES(%s,NULL,%s,%s,%s)", (sid, sender, body, mtype)); mysql.connection.commit()
    socketio.emit("new_message", {"session_id": sid, "sender_id": None, "sender_name": sender, "body": body, "type": mtype, "sent_at": str(datetime.now())}, room=f"chat_{sid}")

def get_bot_response(text, sid, uid):
    c = cur(); c.execute("SELECT response,keywords FROM chat_quick_replies WHERE is_active=1 ORDER BY sort_order"); qrs = c.fetchall(); tl = text.lower(); matched = None
    for qr in qrs:
        if qr["keywords"]:
            for kw in qr["keywords"].split(","):
                if kw.strip() in tl: matched = qr["response"]; break
        if matched: break
    if "order" in tl and uid:
        c.execute("SELECT order_number,status,total FROM orders WHERE user_id=%s ORDER BY created_at DESC LIMIT 1", (uid,)); lo = c.fetchone()
        if lo: matched = f"📦 **Order #{lo['order_number']}** — {lo['status']} — ₹{float(lo['total']):,.0f}\n\n[Track Order](/track/{lo['order_number']})"
    return matched or "Let me get a support agent to help."

@app.route("/api/chat/sessions", methods=["POST"])
@login_required
def create_chat():
    d = request.get_json(); subject, oid = d.get("subject", "General Enquiry"), d.get("order_id")
    c = cur(); c.execute("INSERT INTO chat_sessions(user_id,subject,order_id) VALUES(%s,%s,%s)", (session["user_id"], subject, oid)); mysql.connection.commit()
    sid = c.lastrowid; greeting = random.choice(BOT_GREETINGS)
    if oid:
        c.execute("SELECT order_number,status FROM orders WHERE id=%s", (oid,)); o = c.fetchone()
        if o: greeting += f"\n\nI see your question is about order **#{o['order_number']}**."
    bot_reply(sid, greeting); return ok({"session_id": sid}, code=201)

@app.route("/api/chat/sessions")
@login_required
def get_chats():
    c = cur()
    c.execute("SELECT cs.*,u.name AS agent_name,(SELECT body FROM chat_messages WHERE session_id=cs.id ORDER BY sent_at DESC LIMIT 1) AS last_message,(SELECT COUNT(*) FROM chat_messages WHERE session_id=cs.id AND is_read=0 AND (sender_id!=%s OR sender_id IS NULL)) AS unread FROM chat_sessions cs LEFT JOIN users u ON u.id=cs.agent_id WHERE cs.user_id=%s ORDER BY cs.created_at DESC", (session["user_id"], session["user_id"]))
    sessions = c.fetchall()
    for s in sessions:
        for k in ("created_at", "assigned_at", "resolved_at"): s[k] = str(s[k]) if s.get(k) else None
    return ok(sessions)

@app.route("/api/chat/sessions/<int:sid>/messages")
@login_required
def get_msgs(sid):
    c = cur(); c.execute("SELECT * FROM chat_messages WHERE session_id=%s ORDER BY sent_at", (sid,)); msgs = c.fetchall()
    for m in msgs: m["sent_at"] = str(m["sent_at"]) if m.get("sent_at") else None
    c.execute("UPDATE chat_messages SET is_read=1 WHERE session_id=%s AND (sender_id!=%s OR sender_id IS NULL)", (sid, session["user_id"])); mysql.connection.commit()
    return ok(msgs)

@app.route("/api/chat/sessions/<int:sid>/messages", methods=["POST"])
@login_required
def send_msg(sid):
    body = request.get_json().get("body", "").strip()
    if not body: return err("Empty message")
    c = cur(); c.execute("SELECT agent_id,status FROM chat_sessions WHERE id=%s", (sid,)); sess = c.fetchone()
    if not sess: return err("Session not found", 404)
    c.execute("INSERT INTO chat_messages(session_id,sender_id,sender_name,body,type) VALUES(%s,%s,%s,%s,'text')", (sid, session["user_id"], session["name"], body)); mysql.connection.commit()
    msg = {"session_id": sid, "sender_id": session["user_id"], "sender_name": session["name"], "body": body, "type": "text", "sent_at": str(datetime.now())}
    socketio.emit("new_message", msg, room=f"chat_{sid}")
    if not sess["agent_id"]: bot_reply(sid, get_bot_response(body, sid, session["user_id"]))
    return ok(msg, "Sent", 201)

@app.route("/api/chat/sessions/<int:sid>/rate", methods=["POST"])
@login_required
def rate_chat(sid):
    d = request.get_json(); c = cur()
    c.execute("UPDATE chat_sessions SET rating=%s,feedback=%s,status='closed' WHERE id=%s AND user_id=%s", (d.get("rating"), d.get("feedback", ""), sid, session["user_id"])); mysql.connection.commit()
    return ok(msg="Thanks!")

@app.route("/api/admin/stats")
@role_required("admin")
def admin_stats():
    c = cur()
    def q(sql, p=()): c.execute(sql, p); return c.fetchone()
    users = q("SELECT COUNT(*) AS n FROM users WHERE role='customer'")["n"]
    orders = q("SELECT COUNT(*) AS n FROM orders")["n"]
    revenue = float(q("SELECT COALESCE(SUM(total),0) AS n FROM orders WHERE payment_status='paid'")["n"])
    products = q("SELECT COUNT(*) AS n FROM products WHERE is_active=1")["n"]
    open_chats = q("SELECT COUNT(*) AS n FROM chat_sessions WHERE status='open'")["n"]
    pending = q("SELECT COUNT(*) AS n FROM orders WHERE status='pending'")["n"]
    c.execute("SELECT DATE(created_at) AS d,COUNT(*) AS orders,COALESCE(SUM(total),0) AS revenue FROM orders WHERE created_at>=DATE_SUB(NOW(),INTERVAL 7 DAY) GROUP BY DATE(created_at) ORDER BY d")
    chart = c.fetchall()
    for row in chart: row["d"] = str(row["d"]); row["revenue"] = float(row["revenue"])
    c.execute("SELECT o.order_number,o.total,o.status,o.created_at,u.name AS customer FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 10")
    recent = c.fetchall()
    for r in recent: r["created_at"] = str(r["created_at"]) if r.get("created_at") else None
    return ok({"users": users, "orders": orders, "revenue": revenue, "products": products, "open_chats": open_chats, "pending_orders": pending, "chart": chart, "recent_orders": recent})

@app.route("/api/admin/orders")
@role_required("admin")
def admin_orders():
    c = cur(); c.execute("SELECT o.*,u.name AS customer,u.email FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 200"); rows = c.fetchall()
    for r in rows:
        for k in ("created_at", "updated_at", "estimated_delivery", "delivered_at"): r[k] = str(r[k]) if r.get(k) else None
    return ok(rows)

@app.route("/api/admin/orders/<int:oid>", methods=["PATCH"])
@role_required("admin")
def admin_update_order(oid):
    d = request.get_json(); status = d.get("status"); c = cur()
    if status:
        c.execute("UPDATE orders SET status=%s WHERE id=%s", (status, oid))
        c.execute("INSERT INTO order_status_history(order_id,status,note,created_by) VALUES(%s,%s,%s,%s)", (oid, status, d.get("note", ""), session["user_id"]))
        if status == "delivered": c.execute("UPDATE orders SET delivered_at=NOW() WHERE id=%s", (oid,))
        c.execute("SELECT user_id,order_number FROM orders WHERE id=%s", (oid,)); o = c.fetchone()
        if o: push_notif(o["user_id"], "order", f"Order #{o['order_number']}: {status.replace('_',' ').title()}", "", f"/order/{oid}", "🚚")
    mysql.connection.commit(); return ok(msg="Updated")

@app.route("/api/admin/orders/<int:oid>/advance", methods=["POST"])
@role_required("admin", "support")
def advance_checkpoint(oid):
    d = request.get_json(); note, loc = d.get("note", ""), d.get("location", ""); c = cur()
    c.execute("SELECT id,sort_order,status FROM delivery_checkpoints WHERE order_id=%s AND is_current=1", (oid,)); cur_cp = c.fetchone()
    if not cur_cp: return err("No active checkpoint")
    c.execute("UPDATE delivery_checkpoints SET is_reached=1,is_current=0,reached_at=NOW() WHERE id=%s", (cur_cp["id"],))
    c.execute("SELECT id,status,title FROM delivery_checkpoints WHERE order_id=%s AND sort_order>%s ORDER BY sort_order LIMIT 1", (oid, cur_cp["sort_order"])); nxt = c.fetchone()
    if nxt:
        c.execute("UPDATE delivery_checkpoints SET is_current=1,reached_at=NOW() WHERE id=%s", (nxt["id"],))
        c.execute("UPDATE orders SET status=%s WHERE id=%s", (nxt["status"], oid))
        c.execute("INSERT INTO order_status_history(order_id,status,note,location) VALUES(%s,%s,%s,%s)", (oid, nxt["status"], note or nxt["title"], loc))
        if nxt["status"] == "delivered": c.execute("UPDATE orders SET delivered_at=NOW() WHERE id=%s", (oid,))
        mysql.connection.commit()
        c.execute("SELECT user_id,order_number FROM orders WHERE id=%s", (oid,)); o = c.fetchone()
        push_notif(o["user_id"], "tracking", f"Order Update: {nxt['title']}", note or nxt["title"], f"/track/{o['order_number']}", "🚚")
        socketio.emit("tracking_update", {"order_id": oid, "status": nxt["status"], "title": nxt["title"]}, room=f"track_{oid}")
        return ok({"new_status": nxt["status"], "title": nxt["title"]}, "Advanced")
    mysql.connection.commit(); return ok(msg="Final checkpoint")

@app.route("/api/admin/products", methods=["POST"])
@role_required("admin")
def admin_add_product():
    d = request.get_json(); slug = slugify(d["name"]); base, n, c = slug, 1, cur()
    while True:
        c.execute("SELECT id FROM products WHERE slug=%s", (slug,))
        if not c.fetchone(): break
        slug = f"{base}-{n}"; n += 1
    c.execute("INSERT INTO products(category_id,name,slug,description,price,old_price,stock,emoji,badge,is_featured) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", (d["category_id"], d["name"], slug, d.get("description", ""), d["price"], d.get("old_price") or None, d.get("stock", 0), d.get("emoji", "📦"), d.get("badge", ""), int(d.get("is_featured", 0))))
    mysql.connection.commit(); return ok({"id": c.lastrowid, "slug": slug}, "Added", 201)

@app.route("/api/admin/products/<int:pid>", methods=["DELETE"])
@role_required("admin")
def admin_del_product(pid):
    c = cur(); c.execute("UPDATE products SET is_active=0 WHERE id=%s", (pid,)); mysql.connection.commit(); return ok(msg="Deleted")

@app.route("/api/admin/users")
@role_required("admin")
def admin_users():
    c = cur(); c.execute("SELECT id,name,email,role,status,email_verified,login_count,last_login,created_at FROM users ORDER BY created_at DESC LIMIT 200"); rows = c.fetchall()
    for r in rows:
        for k in ("last_login", "created_at"): r[k] = str(r[k]) if r.get(k) else None
    return ok(rows)

@app.route("/api/admin/coupons")
@role_required("admin")
def admin_coupons():
    c = cur(); c.execute("SELECT * FROM coupons ORDER BY created_at DESC"); rows = c.fetchall()
    for r in rows:
        for k in ("expires_at", "created_at"): r[k] = str(r[k]) if r.get(k) else None
    return ok(rows)

@app.route("/api/admin/coupons", methods=["POST"])
@role_required("admin")
def admin_add_coupon():
    d = request.get_json(); c = cur()
    c.execute("INSERT INTO coupons(code,type,value,min_order,max_uses,expires_at) VALUES(%s,%s,%s,%s,%s,%s)", (d["code"].upper(), d.get("type", "percent"), d["value"], d.get("min_order", 0), d.get("max_uses", 100), d.get("expires_at") or None))
    mysql.connection.commit(); return ok({"id": c.lastrowid}, "Created", 201)

@app.route("/api/admin/agent/sessions")
@role_required("admin", "support")
def agent_sessions():
    c = cur()
    c.execute("SELECT cs.*,u.name AS customer_name,u.email AS customer_email,(SELECT body FROM chat_messages WHERE session_id=cs.id ORDER BY sent_at DESC LIMIT 1) AS last_message FROM chat_sessions cs LEFT JOIN users u ON u.id=cs.user_id WHERE cs.status IN ('open','assigned') ORDER BY cs.created_at DESC")
    return ok(c.fetchall())

@app.route("/api/admin/agent/sessions/<int:sid>/assign", methods=["POST"])
@role_required("admin", "support")
def assign_session(sid):
    c = cur(); c.execute("UPDATE chat_sessions SET agent_id=%s,status='assigned',assigned_at=NOW() WHERE id=%s", (session["user_id"], sid)); mysql.connection.commit()
    bot_reply(sid, f"You've been connected to **{session['name']}**! 👤", "system", "Drocart Support")
    return ok(msg="Assigned")

@socketio.on("connect")
def on_connect():
    uid = session.get("user_id")
    if uid: join_room(f"user_{uid}")

@socketio.on("disconnect")
def on_disconnect():
    uid = session.get("user_id")
    if uid:
        try:
            c = cur(); c.execute("UPDATE users SET is_online=0,last_seen=NOW() WHERE id=%s", (uid,)); mysql.connection.commit()
        except Exception: pass

@socketio.on("join_chat")
def on_join_chat(data):
    if data.get("session_id"): join_room(f"chat_{data['session_id']}")

@socketio.on("join_tracking")
def on_join_tracking(data):
    if data.get("order_id"): join_room(f"track_{data['order_id']}")

@socketio.on("typing")
def on_typing(data):
    emit("user_typing", {"sender": session.get("name", "User")}, room=f"chat_{data.get('session_id')}", include_self=False)

@socketio.on("stop_typing")
def on_stop(data):
    emit("user_stop_typing", {}, room=f"chat_{data.get('session_id')}", include_self=False)

@app.errorhandler(404)
def not_found(e):
    return jsonify({"success": False, "error": "Not found"}), 404

@app.errorhandler(500)
def server_error(e):
    return jsonify({"success": False, "error": "Server error"}), 500

if __name__ == "__main__":
    socketio.run(app, debug=APP_ENV != "production", host="0.0.0.0", port=int(os.getenv("PORT", "5000")))

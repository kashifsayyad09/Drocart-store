"""
Drocart - Flask Backend Application
====================================
Run:
    pip install flask flask-mysqldb flask-login flask-bcrypt flask-cors python-dotenv
    python app.py
"""

import os
import json
from datetime import datetime, timedelta
from functools import wraps

from flask import (
    Flask, render_template, request, jsonify,
    session, redirect, url_for, flash
)
from flask_mysqldb import MySQL
from flask_bcrypt import Bcrypt
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

# ─────────────────────────────────────────────
#  App Setup
# ─────────────────────────────────────────────
app = Flask(__name__)
CORS(app, supports_credentials=True)

app.secret_key = os.getenv("SECRET_KEY", "drocart-super-secret-2025")
app.permanent_session_lifetime = timedelta(days=30)

# ─────────────────────────────────────────────
#  MySQL Config
# ─────────────────────────────────────────────
app.config["MYSQL_HOST"]     = os.getenv("MYSQL_HOST", "localhost")
app.config["MYSQL_USER"]     = os.getenv("MYSQL_USER", "root")
app.config["MYSQL_PASSWORD"] = os.getenv("MYSQL_PASSWORD", "")
app.config["MYSQL_DB"]       = os.getenv("MYSQL_DB", "drocart")
app.config["MYSQL_CURSORCLASS"] = "DictCursor"

mysql  = MySQL(app)
bcrypt = Bcrypt(app)


# ─────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────
def get_cursor():
    return mysql.connection.cursor()


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            return jsonify({"error": "Login required"}), 401
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if session.get("role") != "admin":
            return jsonify({"error": "Admin access required"}), 403
        return f(*args, **kwargs)
    return login_required(decorated)


def success(data=None, msg="OK", code=200):
    return jsonify({"success": True, "message": msg, "data": data}), code


def error(msg="Error", code=400):
    return jsonify({"success": False, "error": msg}), code


# ─────────────────────────────────────────────
#  FRONTEND ROUTES  (serve HTML pages)
# ─────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/product/<slug>")
def product_detail(slug):
    return render_template("index.html")


@app.route("/cart")
def cart():
    return render_template("index.html")


@app.route("/checkout")
def checkout():
    return render_template("index.html")


@app.route("/orders")
def orders_page():
    return render_template("index.html")


@app.route("/admin")
def admin():
    return render_template("admin.html")


# ─────────────────────────────────────────────
#  AUTH API
# ─────────────────────────────────────────────
@app.route("/api/auth/register", methods=["POST"])
def register():
    data  = request.get_json()
    name  = data.get("name", "").strip()
    email = data.get("email", "").strip().lower()
    pw    = data.get("password", "")

    if not all([name, email, pw]):
        return error("All fields required")
    if len(pw) < 6:
        return error("Password must be at least 6 characters")

    cur = get_cursor()
    cur.execute("SELECT id FROM users WHERE email=%s", (email,))
    if cur.fetchone():
        return error("Email already registered")

    hashed = bcrypt.generate_password_hash(pw).decode("utf-8")
    cur.execute(
        "INSERT INTO users (name, email, password) VALUES (%s,%s,%s)",
        (name, email, hashed)
    )
    mysql.connection.commit()
    user_id = cur.lastrowid

    session.permanent = True
    session["user_id"] = user_id
    session["name"]    = name
    session["email"]   = email
    session["role"]    = "customer"

    return success({"id": user_id, "name": name, "email": email, "role": "customer"},
                   "Registered successfully", 201)


@app.route("/api/auth/login", methods=["POST"])
def login():
    data  = request.get_json()
    email = data.get("email", "").strip().lower()
    pw    = data.get("password", "")

    cur = get_cursor()
    cur.execute("SELECT * FROM users WHERE email=%s AND is_active=1", (email,))
    user = cur.fetchone()

    if not user or not bcrypt.check_password_hash(user["password"], pw):
        return error("Invalid email or password", 401)

    session.permanent = True
    session["user_id"] = user["id"]
    session["name"]    = user["name"]
    session["email"]   = user["email"]
    session["role"]    = user["role"]

    return success({
        "id": user["id"], "name": user["name"],
        "email": user["email"], "role": user["role"]
    }, "Login successful")


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    session.clear()
    return success(msg="Logged out")


@app.route("/api/auth/me")
def me():
    if "user_id" not in session:
        return jsonify({"logged_in": False}), 200
    return jsonify({
        "logged_in": True,
        "id": session["user_id"],
        "name": session["name"],
        "email": session["email"],
        "role": session["role"]
    })


# ─────────────────────────────────────────────
#  CATEGORIES API
# ─────────────────────────────────────────────
@app.route("/api/categories")
def get_categories():
    cur = get_cursor()
    cur.execute("""
        SELECT c.*, COUNT(p.id) AS product_count
        FROM categories c
        LEFT JOIN products p ON p.category_id = c.id AND p.is_active=1
        WHERE c.is_active=1
        GROUP BY c.id
        ORDER BY c.sort_order
    """)
    return success(cur.fetchall())


# ─────────────────────────────────────────────
#  PRODUCTS API
# ─────────────────────────────────────────────
@app.route("/api/products")
def get_products():
    category = request.args.get("category", "")
    search   = request.args.get("q", "")
    featured = request.args.get("featured", "")
    sort     = request.args.get("sort", "created_at_desc")
    page     = max(1, int(request.args.get("page", 1)))
    limit    = min(50, int(request.args.get("limit", 12)))
    offset   = (page - 1) * limit

    where = ["p.is_active=1"]
    params = []

    if category:
        where.append("c.slug=%s")
        params.append(category)
    if featured:
        where.append("p.is_featured=1")
    if search:
        where.append("(p.name LIKE %s OR p.description LIKE %s)")
        params += [f"%{search}%", f"%{search}%"]

    sort_map = {
        "price_asc":  "p.price ASC",
        "price_desc": "p.price DESC",
        "rating":     "p.rating DESC",
        "newest":     "p.created_at DESC",
        "created_at_desc": "p.created_at DESC",
    }
    order_by = sort_map.get(sort, "p.created_at DESC")

    where_sql = " AND ".join(where)
    cur = get_cursor()

    cur.execute(f"""
        SELECT p.*, c.name AS category_name, c.slug AS category_slug
        FROM products p
        JOIN categories c ON c.id = p.category_id
        WHERE {where_sql}
        ORDER BY {order_by}
        LIMIT %s OFFSET %s
    """, params + [limit, offset])
    products = cur.fetchall()

    cur.execute(f"""
        SELECT COUNT(*) AS total FROM products p
        JOIN categories c ON c.id = p.category_id
        WHERE {where_sql}
    """, params)
    total = cur.fetchone()["total"]

    return success({
        "products": products,
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit,
        "limit": limit
    })


@app.route("/api/products/<slug>")
def get_product(slug):
    cur = get_cursor()
    cur.execute("""
        SELECT p.*, c.name AS category_name, c.slug AS category_slug
        FROM products p
        JOIN categories c ON c.id = p.category_id
        WHERE p.slug=%s AND p.is_active=1
    """, (slug,))
    product = cur.fetchone()
    if not product:
        return error("Product not found", 404)

    cur.execute("""
        SELECT r.*, u.name AS user_name
        FROM reviews r JOIN users u ON u.id = r.user_id
        WHERE r.product_id=%s AND r.is_approved=1
        ORDER BY r.created_at DESC LIMIT 10
    """, (product["id"],))
    product["reviews"] = cur.fetchall()
    return success(product)


# ─────────────────────────────────────────────
#  CART API
# ─────────────────────────────────────────────
@app.route("/api/cart", methods=["GET"])
@login_required
def get_cart():
    cur = get_cursor()
    cur.execute("""
        SELECT ci.id, ci.qty, p.id AS product_id, p.name, p.price,
               p.old_price, p.emoji, p.stock, p.slug
        FROM cart_items ci
        JOIN products p ON p.id = ci.product_id
        WHERE ci.user_id=%s
    """, (session["user_id"],))
    items = cur.fetchall()

    subtotal = sum(float(i["price"]) * i["qty"] for i in items)
    shipping = 0 if subtotal >= 999 else 99
    total    = subtotal + shipping

    return success({
        "items": items,
        "subtotal": round(subtotal, 2),
        "shipping": shipping,
        "total": round(total, 2),
        "count": sum(i["qty"] for i in items)
    })


@app.route("/api/cart", methods=["POST"])
@login_required
def add_to_cart():
    data       = request.get_json()
    product_id = int(data.get("product_id"))
    qty        = max(1, int(data.get("qty", 1)))

    cur = get_cursor()
    cur.execute("SELECT id, stock FROM products WHERE id=%s AND is_active=1", (product_id,))
    product = cur.fetchone()
    if not product:
        return error("Product not found", 404)

    cur.execute("""
        INSERT INTO cart_items (user_id, product_id, qty)
        VALUES (%s,%s,%s)
        ON DUPLICATE KEY UPDATE qty = qty + %s
    """, (session["user_id"], product_id, qty, qty))
    mysql.connection.commit()
    return success(msg="Added to cart")


@app.route("/api/cart/<int:item_id>", methods=["PUT"])
@login_required
def update_cart(item_id):
    qty = int(request.get_json().get("qty", 1))
    cur = get_cursor()
    if qty <= 0:
        cur.execute("DELETE FROM cart_items WHERE id=%s AND user_id=%s",
                    (item_id, session["user_id"]))
    else:
        cur.execute("UPDATE cart_items SET qty=%s WHERE id=%s AND user_id=%s",
                    (qty, item_id, session["user_id"]))
    mysql.connection.commit()
    return success(msg="Cart updated")


@app.route("/api/cart/<int:item_id>", methods=["DELETE"])
@login_required
def remove_from_cart(item_id):
    cur = get_cursor()
    cur.execute("DELETE FROM cart_items WHERE id=%s AND user_id=%s",
                (item_id, session["user_id"]))
    mysql.connection.commit()
    return success(msg="Item removed")


@app.route("/api/cart/clear", methods=["DELETE"])
@login_required
def clear_cart():
    cur = get_cursor()
    cur.execute("DELETE FROM cart_items WHERE user_id=%s", (session["user_id"],))
    mysql.connection.commit()
    return success(msg="Cart cleared")


# ─────────────────────────────────────────────
#  WISHLIST API
# ─────────────────────────────────────────────
@app.route("/api/wishlist", methods=["GET"])
@login_required
def get_wishlist():
    cur = get_cursor()
    cur.execute("""
        SELECT p.id, p.name, p.price, p.old_price, p.emoji, p.slug, p.rating
        FROM wishlists w JOIN products p ON p.id = w.product_id
        WHERE w.user_id=%s
    """, (session["user_id"],))
    return success(cur.fetchall())


@app.route("/api/wishlist/<int:product_id>", methods=["POST"])
@login_required
def toggle_wishlist(product_id):
    cur = get_cursor()
    cur.execute("SELECT id FROM wishlists WHERE user_id=%s AND product_id=%s",
                (session["user_id"], product_id))
    existing = cur.fetchone()
    if existing:
        cur.execute("DELETE FROM wishlists WHERE user_id=%s AND product_id=%s",
                    (session["user_id"], product_id))
        mysql.connection.commit()
        return success({"wishlisted": False}, "Removed from wishlist")
    else:
        cur.execute("INSERT INTO wishlists (user_id, product_id) VALUES (%s,%s)",
                    (session["user_id"], product_id))
        mysql.connection.commit()
        return success({"wishlisted": True}, "Added to wishlist")


# ─────────────────────────────────────────────
#  ORDERS API
# ─────────────────────────────────────────────
@app.route("/api/orders", methods=["GET"])
@login_required
def get_orders():
    cur = get_cursor()
    cur.execute("""
        SELECT o.*, COUNT(oi.id) AS item_count
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        WHERE o.user_id=%s
        GROUP BY o.id
        ORDER BY o.created_at DESC
    """, (session["user_id"],))
    orders = cur.fetchall()
    return success(orders)


@app.route("/api/orders/<int:order_id>")
@login_required
def get_order(order_id):
    cur = get_cursor()
    cur.execute("SELECT * FROM orders WHERE id=%s AND user_id=%s",
                (order_id, session["user_id"]))
    order = cur.fetchone()
    if not order:
        return error("Order not found", 404)

    cur.execute("SELECT * FROM order_items WHERE order_id=%s", (order_id,))
    order["items"] = cur.fetchall()
    return success(order)


@app.route("/api/orders", methods=["POST"])
@login_required
def place_order():
    data           = request.get_json()
    payment_method = data.get("payment_method", "cod")
    address_data   = data.get("address", {})

    cur = get_cursor()
    # Fetch cart
    cur.execute("""
        SELECT ci.qty, p.id AS product_id, p.name, p.price, p.emoji, p.stock
        FROM cart_items ci JOIN products p ON p.id = ci.product_id
        WHERE ci.user_id=%s
    """, (session["user_id"],))
    cart_items = cur.fetchall()

    if not cart_items:
        return error("Cart is empty")

    # Check stock
    for item in cart_items:
        if item["stock"] < item["qty"]:
            return error(f"'{item['name']}' is out of stock")

    subtotal = sum(float(i["price"]) * i["qty"] for i in cart_items)
    shipping = 0 if subtotal >= 999 else 99
    total    = subtotal + shipping

    # Save address if provided
    address_id = None
    if address_data.get("line1"):
        cur.execute("""
            INSERT INTO addresses (user_id, full_name, line1, line2, city, state, pincode, phone)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        """, (
            session["user_id"],
            address_data.get("full_name", session["name"]),
            address_data.get("line1", ""),
            address_data.get("line2", ""),
            address_data.get("city", ""),
            address_data.get("state", ""),
            address_data.get("pincode", ""),
            address_data.get("phone", "")
        ))
        address_id = cur.lastrowid

    # Create order
    cur.execute("""
        INSERT INTO orders (user_id, address_id, payment_method, subtotal, shipping_fee, total)
        VALUES (%s,%s,%s,%s,%s,%s)
    """, (session["user_id"], address_id, payment_method, subtotal, shipping, total))
    order_id = cur.lastrowid

    # Insert order items + reduce stock
    for item in cart_items:
        cur.execute("""
            INSERT INTO order_items (order_id, product_id, name, emoji, price, qty, subtotal)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
        """, (order_id, item["product_id"], item["name"], item["emoji"],
              item["price"], item["qty"], float(item["price"]) * item["qty"]))
        cur.execute("UPDATE products SET stock=stock-%s WHERE id=%s",
                    (item["qty"], item["product_id"]))

    # Clear cart
    cur.execute("DELETE FROM cart_items WHERE user_id=%s", (session["user_id"],))
    mysql.connection.commit()

    # Fetch saved order_number
    cur.execute("SELECT order_number FROM orders WHERE id=%s", (order_id,))
    row = cur.fetchone()
    return success({
        "order_id": order_id,
        "order_number": row["order_number"],
        "total": total
    }, "Order placed successfully", 201)


# ─────────────────────────────────────────────
#  REVIEWS API
# ─────────────────────────────────────────────
@app.route("/api/reviews/<int:product_id>", methods=["POST"])
@login_required
def add_review(product_id):
    data   = request.get_json()
    rating = int(data.get("rating", 5))
    title  = data.get("title", "")
    body   = data.get("body", "")

    if not (1 <= rating <= 5):
        return error("Rating must be 1-5")

    cur = get_cursor()
    try:
        cur.execute("""
            INSERT INTO reviews (product_id, user_id, rating, title, body)
            VALUES (%s,%s,%s,%s,%s)
        """, (product_id, session["user_id"], rating, title, body))
        mysql.connection.commit()
        return success(msg="Review submitted for approval", code=201)
    except Exception:
        return error("You have already reviewed this product")


# ─────────────────────────────────────────────
#  COUPON API
# ─────────────────────────────────────────────
@app.route("/api/coupons/apply", methods=["POST"])
@login_required
def apply_coupon():
    code     = request.get_json().get("code", "").upper().strip()
    subtotal = float(request.get_json().get("subtotal", 0))

    cur = get_cursor()
    cur.execute("""
        SELECT * FROM coupons
        WHERE code=%s AND is_active=1
          AND (expires_at IS NULL OR expires_at > NOW())
          AND used_count < max_uses
    """, (code,))
    coupon = cur.fetchone()

    if not coupon:
        return error("Invalid or expired coupon")
    if subtotal < float(coupon["min_order"]):
        return error(f"Minimum order ₹{coupon['min_order']} required")

    if coupon["type"] == "percent":
        discount = round(subtotal * float(coupon["value"]) / 100, 2)
    else:
        discount = float(coupon["value"])

    return success({
        "discount": discount,
        "type": coupon["type"],
        "value": float(coupon["value"]),
        "code": code
    }, f"Coupon applied! You save ₹{discount}")


# ─────────────────────────────────────────────
#  NEWSLETTER API
# ─────────────────────────────────────────────
@app.route("/api/newsletter", methods=["POST"])
def newsletter():
    email = request.get_json().get("email", "").strip().lower()
    if not email or "@" not in email:
        return error("Valid email required")
    cur = get_cursor()
    try:
        cur.execute("INSERT INTO subscribers (email) VALUES (%s)", (email,))
        mysql.connection.commit()
        return success(msg="Subscribed successfully!")
    except Exception:
        return error("Already subscribed")


# ─────────────────────────────────────────────
#  ADMIN API
# ─────────────────────────────────────────────
@app.route("/api/admin/stats")
@login_required
@admin_required
def admin_stats():
    cur = get_cursor()
    cur.execute("SELECT COUNT(*) AS total FROM users WHERE role='customer'")
    total_users = cur.fetchone()["total"]

    cur.execute("SELECT COUNT(*) AS total FROM orders")
    total_orders = cur.fetchone()["total"]

    cur.execute("SELECT COALESCE(SUM(total),0) AS revenue FROM orders WHERE payment_status='paid'")
    revenue = cur.fetchone()["revenue"]

    cur.execute("SELECT COUNT(*) AS total FROM products WHERE is_active=1")
    total_products = cur.fetchone()["total"]

    cur.execute("""
        SELECT o.order_number, o.total, o.status, o.created_at, u.name AS customer
        FROM orders o JOIN users u ON u.id = o.user_id
        ORDER BY o.created_at DESC LIMIT 10
    """)
    recent_orders = cur.fetchall()

    return success({
        "total_users": total_users,
        "total_orders": total_orders,
        "revenue": float(revenue),
        "total_products": total_products,
        "recent_orders": recent_orders
    })


@app.route("/api/admin/orders")
@login_required
@admin_required
def admin_orders():
    cur = get_cursor()
    cur.execute("""
        SELECT o.*, u.name AS customer, u.email AS customer_email
        FROM orders o JOIN users u ON u.id = o.user_id
        ORDER BY o.created_at DESC
    """)
    return success(cur.fetchall())


@app.route("/api/admin/orders/<int:order_id>", methods=["PATCH"])
@login_required
@admin_required
def update_order_status(order_id):
    status = request.get_json().get("status")
    valid  = ("pending","confirmed","processing","shipped","delivered","cancelled","refunded")
    if status not in valid:
        return error("Invalid status")
    cur = get_cursor()
    cur.execute("UPDATE orders SET status=%s WHERE id=%s", (status, order_id))
    mysql.connection.commit()
    return success(msg="Order status updated")


@app.route("/api/admin/products", methods=["POST"])
@login_required
@admin_required
def admin_add_product():
    d = request.get_json()
    import re
    slug = re.sub(r"[^a-z0-9]+", "-", d["name"].lower()).strip("-")
    cur = get_cursor()
    cur.execute("""
        INSERT INTO products
        (category_id, name, slug, description, price, old_price, stock, emoji, badge, is_featured)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """, (
        d["category_id"], d["name"], slug, d.get("description",""),
        d["price"], d.get("old_price") or None, d.get("stock", 0),
        d.get("emoji","📦"), d.get("badge",""), int(d.get("is_featured",0))
    ))
    mysql.connection.commit()
    return success({"id": cur.lastrowid}, "Product added", 201)


@app.route("/api/admin/products/<int:product_id>", methods=["DELETE"])
@login_required
@admin_required
def admin_delete_product(product_id):
    cur = get_cursor()
    cur.execute("UPDATE products SET is_active=0 WHERE id=%s", (product_id,))
    mysql.connection.commit()
    return success(msg="Product deleted")


# ─────────────────────────────────────────────
#  USER PROFILE
# ─────────────────────────────────────────────
@app.route("/api/profile", methods=["GET"])
@login_required
def get_profile():
    cur = get_cursor()
    cur.execute("SELECT id, name, email, phone, role, created_at FROM users WHERE id=%s",
                (session["user_id"],))
    return success(cur.fetchone())


@app.route("/api/profile", methods=["PUT"])
@login_required
def update_profile():
    data  = request.get_json()
    name  = data.get("name", "").strip()
    phone = data.get("phone", "").strip()
    cur   = get_cursor()
    cur.execute("UPDATE users SET name=%s, phone=%s WHERE id=%s",
                (name, phone, session["user_id"]))
    mysql.connection.commit()
    session["name"] = name
    return success(msg="Profile updated")


# ─────────────────────────────────────────────
#  ERROR HANDLERS
# ─────────────────────────────────────────────
@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def server_error(e):
    return jsonify({"error": "Internal server error"}), 500


# ─────────────────────────────────────────────
#  RUN
# ─────────────────────────────────────────────
if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)

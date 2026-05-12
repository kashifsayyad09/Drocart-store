# 🛒 Drocart — Full Stack E-Commerce
# pip3 install flask flask-mysqldb flask-login flask-bcrypt flask-cors python-dotenv
# sudo dnf install mariadb105-devel gcc python3-devel -y
A production-ready e-commerce application built with **Flask**, **MySQL**, and a dynamic 3D frontend.

UPDATE users
SET role = 'admin'
WHERE email = 'kashifsayyad09@gmail.com';

---

## 📁 Project Structure

```
drocart/
├── app.py                  # Flask application & all API routes
├── database.sql            # MySQL schema + seed data
├── requirements.txt        # Python dependencies
├── .env.example            # Environment variable template
│
├── templates/
│   ├── index.html          # Main storefront
│   └── admin.html          # Admin dashboard
│
└── static/
    ├── css/
    │   ├── style.css       # Main stylesheet (dark luxury theme)
    │   └── admin.css       # Admin dashboard styles
    └── js/
        ├── main.js         # All storefront logic
        └── admin.js        # Admin dashboard logic
```

---

## 🚀 Setup Instructions

### 1. Prerequisites
- Python 3.9+
- MySQL 8.0+
- pip

### 2. Clone & Install
```bash
cd drocart
pip install -r requirements.txt
```

### 3. Configure Environment
```bash
cp .env.example .env
# Edit .env with your MySQL credentials
```

### 4. Set Up Database
```bash
mysql -u root -p < database.sql
```

### 5. Run the App
```bash
python app.py
```
Visit → **http://localhost:5000**
Admin → **http://localhost:5000/admin**

---

## 🔑 Default Credentials

| Role     | Email                | Password   |
|----------|----------------------|------------|
| Admin    | admin@drocart.com    | admin123   |
| Customer | test@drocart.com     | admin123   |

> ⚠️ Change these immediately in production!

---

## 🛠️ API Reference

### Auth
| Method | Endpoint              | Description       |
|--------|-----------------------|-------------------|
| POST   | `/api/auth/register`  | Register user     |
| POST   | `/api/auth/login`     | Login             |
| POST   | `/api/auth/logout`    | Logout            |
| GET    | `/api/auth/me`        | Get current user  |

### Products
| Method | Endpoint                    | Description              |
|--------|-----------------------------|--------------------------|
| GET    | `/api/products`             | List products (paginated)|
| GET    | `/api/products/<slug>`      | Single product detail    |
| GET    | `/api/categories`           | All categories           |

**Query params:** `?category=electronics&featured=1&q=watch&sort=price_asc&page=1&limit=12`

### Cart (login required)
| Method | Endpoint              | Description     |
|--------|-----------------------|-----------------|
| GET    | `/api/cart`           | Get cart        |
| POST   | `/api/cart`           | Add item        |
| PUT    | `/api/cart/<id>`      | Update quantity |
| DELETE | `/api/cart/<id>`      | Remove item     |
| DELETE | `/api/cart/clear`     | Clear cart      |

### Orders (login required)
| Method | Endpoint              | Description     |
|--------|-----------------------|-----------------|
| GET    | `/api/orders`         | My orders       |
| GET    | `/api/orders/<id>`    | Order detail    |
| POST   | `/api/orders`         | Place order     |

### Wishlist (login required)
| Method | Endpoint                      | Description       |
|--------|-------------------------------|-------------------|
| GET    | `/api/wishlist`               | Get wishlist      |
| POST   | `/api/wishlist/<product_id>`  | Toggle wishlist   |

### Coupons
| Method | Endpoint              | Description   |
|--------|-----------------------|---------------|
| POST   | `/api/coupons/apply`  | Apply coupon  |

**Coupon codes:** `DROCART10` (10% off), `WELCOME500` (₹500 off), `SALE20` (20% off)

### Admin (admin role required)
| Method | Endpoint                        | Description         |
|--------|---------------------------------|---------------------|
| GET    | `/api/admin/stats`              | Dashboard stats     |
| GET    | `/api/admin/orders`             | All orders          |
| PATCH  | `/api/admin/orders/<id>`        | Update order status |
| POST   | `/api/admin/products`           | Add product         |
| DELETE | `/api/admin/products/<id>`      | Delete product      |

---

## ✨ Features

### Frontend
- 🌌 **Three.js 3D hero scene** — rotating TorusKnot with orbiting spheres
- 🎯 **Custom magnetic cursor** with ring follower
- ✨ **Particle network** background (160 particles, live connections)
- 🎠 **Animated marquee** ticker strip
- 🔍 **Live search** with 400ms debounce
- 🛒 **Slide-in cart sidebar** with real-time sync
- 💳 **Full checkout flow** with address + payment selection
- 🎟️ **Coupon code** system
- ❤️ **Wishlist** toggle per product
- 🔔 **Toast notifications** system
- 📱 **Fully responsive** down to mobile

### Backend
- 🔐 **BCrypt** password hashing
- 🍪 **Session-based auth** (30-day persistent)
- 📄 **Pagination** on all list endpoints
- 🔍 **Full-text search** (MySQL FULLTEXT index)
- 📦 **Stock management** (auto-decrements on order)
- 🧾 **Auto order numbers** (MySQL trigger)
- 📊 **Admin dashboard** with stats + order management
- 🗄️ **Stored procedures** for rating recalculation

### Database
- 12 tables with proper foreign keys & indexes
- Seed data (categories, products, users, coupons)
- MySQL stored procedure + trigger included

---

## 🎨 Design Tokens

| Token       | Value      | Usage                |
|-------------|------------|----------------------|
| `--ink`     | `#0a0a0f`  | Main background      |
| `--gold`    | `#f5c842`  | Primary accent       |
| `--accent`  | `#7c6fff`  | Violet accent        |
| `--rose`    | `#ff5f7e`  | Red accent / danger  |
| `--teal`    | `#00e5c4`  | Green/teal accent    |

Fonts: **Syne** (display/headings) + **DM Sans** (body)

---

## 🔧 Production Notes

1. Set `DEBUG = False` in `app.py`
2. Use `gunicorn` instead of Flask dev server
3. Configure a proper `SECRET_KEY` in `.env`
4. Set up HTTPS (SSL certificate)
5. Use environment variables for all secrets
6. Add rate limiting for auth endpoints

```bash
# Production start
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:5000 app:app
```

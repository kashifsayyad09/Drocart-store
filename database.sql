-- ============================================================
--  DROCART E-Commerce Database Schema
--  MySQL 8.0+
--  Run: mysql -u root -p < database.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS drocart CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE drocart;

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(120)        NOT NULL,
    email       VARCHAR(180)        NOT NULL UNIQUE,
    password    VARCHAR(256)        NOT NULL,          -- bcrypt hash
    phone       VARCHAR(20),
    avatar      VARCHAR(300),
    role        ENUM('customer','admin') DEFAULT 'customer',
    is_active   TINYINT(1)          DEFAULT 1,
    created_at  DATETIME            DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME            DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email)
) ENGINE=InnoDB;

-- ============================================================
-- CATEGORIES
-- ============================================================
CREATE TABLE IF NOT EXISTS categories (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100)        NOT NULL,
    slug        VARCHAR(120)        NOT NULL UNIQUE,
    description TEXT,
    icon        VARCHAR(10),
    image       VARCHAR(300),
    is_active   TINYINT(1)          DEFAULT 1,
    sort_order  INT                 DEFAULT 0,
    created_at  DATETIME            DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ============================================================
-- PRODUCTS
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    category_id   INT             NOT NULL,
    name          VARCHAR(200)    NOT NULL,
    slug          VARCHAR(220)    NOT NULL UNIQUE,
    description   TEXT,
    price         DECIMAL(10,2)   NOT NULL,
    old_price     DECIMAL(10,2),
    stock         INT             DEFAULT 0,
    sku           VARCHAR(80)     UNIQUE,
    emoji         VARCHAR(10)     DEFAULT '',
    badge         ENUM('new','sale','hot','') DEFAULT '',
    rating        DECIMAL(3,2)    DEFAULT 0.00,
    review_count  INT             DEFAULT 0,
    is_active     TINYINT(1)      DEFAULT 1,
    is_featured   TINYINT(1)      DEFAULT 0,
    created_at    DATETIME        DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
    INDEX idx_category (category_id),
    INDEX idx_featured (is_featured),
    FULLTEXT idx_search (name, description)
) ENGINE=InnoDB;

-- ============================================================
-- PRODUCT IMAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS product_images (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    product_id  INT             NOT NULL,
    url         VARCHAR(400)    NOT NULL,
    alt_text    VARCHAR(200),
    sort_order  INT             DEFAULT 0,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- ADDRESSES
-- ============================================================
CREATE TABLE IF NOT EXISTS addresses (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT             NOT NULL,
    full_name   VARCHAR(120)    NOT NULL,
    line1       VARCHAR(200)    NOT NULL,
    line2       VARCHAR(200),
    city        VARCHAR(80)     NOT NULL,
    state       VARCHAR(80)     NOT NULL,
    pincode     VARCHAR(12)     NOT NULL,
    country     VARCHAR(60)     DEFAULT 'India',
    phone       VARCHAR(20),
    is_default  TINYINT(1)      DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- ORDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT             NOT NULL,
    address_id      INT,
    order_number    VARCHAR(30)     NOT NULL UNIQUE,
    status          ENUM('pending','confirmed','processing','shipped','delivered','cancelled','refunded')
                    DEFAULT 'pending',
    payment_method  ENUM('cod','upi','card','netbanking') DEFAULT 'cod',
    payment_status  ENUM('pending','paid','failed','refunded') DEFAULT 'pending',
    subtotal        DECIMAL(10,2)   NOT NULL,
    discount        DECIMAL(10,2)   DEFAULT 0.00,
    shipping_fee    DECIMAL(10,2)   DEFAULT 0.00,
    total           DECIMAL(10,2)   NOT NULL,
    notes           TEXT,
    created_at      DATETIME        DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (address_id) REFERENCES addresses(id),
    INDEX idx_user_orders (user_id),
    INDEX idx_status (status)
) ENGINE=InnoDB;

-- ============================================================
-- ORDER ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS order_items (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    order_id    INT             NOT NULL,
    product_id  INT             NOT NULL,
    name        VARCHAR(200)    NOT NULL,
    emoji       VARCHAR(10),
    price       DECIMAL(10,2)   NOT NULL,
    qty         INT             NOT NULL,
    subtotal    DECIMAL(10,2)   NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;

-- ============================================================
-- CART (server-side / session backup)
-- ============================================================
CREATE TABLE IF NOT EXISTS cart_items (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT             NOT NULL,
    product_id  INT             NOT NULL,
    qty         INT             NOT NULL DEFAULT 1,
    added_at    DATETIME        DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_user_product (user_id, product_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- WISHLISTS
-- ============================================================
CREATE TABLE IF NOT EXISTS wishlists (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT             NOT NULL,
    product_id  INT             NOT NULL,
    added_at    DATETIME        DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_wishlist (user_id, product_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- REVIEWS
-- ============================================================
CREATE TABLE IF NOT EXISTS reviews (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    product_id  INT             NOT NULL,
    user_id     INT             NOT NULL,
    rating      TINYINT         NOT NULL CHECK (rating BETWEEN 1 AND 5),
    title       VARCHAR(200),
    body        TEXT,
    is_approved TINYINT(1)      DEFAULT 0,
    created_at  DATETIME        DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_review (product_id, user_id),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- COUPONS
-- ============================================================
CREATE TABLE IF NOT EXISTS coupons (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    code            VARCHAR(30)     NOT NULL UNIQUE,
    type            ENUM('percent','fixed') DEFAULT 'percent',
    value           DECIMAL(10,2)   NOT NULL,
    min_order       DECIMAL(10,2)   DEFAULT 0,
    max_uses        INT             DEFAULT 100,
    used_count      INT             DEFAULT 0,
    expires_at      DATETIME,
    is_active       TINYINT(1)      DEFAULT 1,
    created_at      DATETIME        DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ============================================================
-- NEWSLETTER SUBSCRIBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS subscribers (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    email       VARCHAR(180)    NOT NULL UNIQUE,
    subscribed_at DATETIME      DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ============================================================
-- SEED DATA
-- ============================================================

INSERT INTO categories (name, slug, description, icon, sort_order) VALUES
('Electronics',    'electronics',  'Gadgets, audio, cameras & more',  '', 1),
('Fashion',        'fashion',      'Clothing, shoes & accessories',   '', 2),
('Jewelry',        'jewelry',      'Rings, necklaces & luxury pieces','', 3),
('Home & Living',  'home-living',  'Furniture, decor & appliances',   '', 4),
('Beauty',         'beauty',       'Skincare, makeup & fragrances',   '', 5),
('Sports',         'sports',       'Equipment & activewear',          '', 6);

INSERT INTO users (name, email, password, role) VALUES
('Admin User', 'admin@drocart.com',
 '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMaJObIuPxA9P7v6q4z.Hs4W6W',  -- password: admin123
 'admin'),
('Test Customer', 'test@drocart.com',
 '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMaJObIuPxA9P7v6q4z.Hs4W6W',  -- password: admin123
 'customer');

INSERT INTO products (category_id, name, slug, description, price, old_price, stock, sku, emoji, badge, rating, review_count, is_featured) VALUES
(1,'Pro Audio Headphones X1','pro-audio-headphones-x1',
 'Studio-grade wireless headphones with 40hr battery, ANC, and Hi-Res Audio certification.',
 18999, 24999, 85, 'ELEC-001', '🎧', 'sale', 4.90, 2341, 1),

(1,'Smart Watch Series 9','smart-watch-series-9',
 'Always-on retina display, health sensors, GPS, crash detection — your ultimate wrist companion.',
 32499, NULL, 42, 'ELEC-002', '⌚', 'new', 4.80, 1204, 1),

(2,'Air Max Signature','air-max-signature',
 'Iconic silhouette reimagined. Full-length Air cushioning with premium leather upper.',
 12999, 15999, 130, 'FASH-001', '👟', 'hot', 4.70, 876, 1),

(1,'Mirrorless Camera Pro','mirrorless-camera-pro',
 '61MP full-frame sensor, 8-stop IBIS, 4K120 video — the camera professionals swear by.',
 89999, NULL, 18, 'ELEC-003', '📷', 'new', 4.90, 445, 1),

(5,'Luxe Perfume Collection','luxe-perfume-collection',
 'Eau de Parfum crafted by master perfumers. Woody, floral, and oriental accords.',
 7499, 9999, 200, 'BEAU-001', '🌹', 'sale', 4.60, 1102, 1),

(1,'UltraBook Pro 15','ultrabook-pro-15',
 'M3 Pro chip, 18hr battery, Liquid Retina XDR display, 36GB unified memory.',
 124999, 139999, 25, 'ELEC-004', '💻', 'hot', 4.80, 567, 1),

(3,'Diamond Tennis Bracelet','diamond-tennis-bracelet',
 '18K white gold with 5ct total weight VS1 diamonds. Certificate of authenticity included.',
 245000, NULL, 8, 'JEWL-001', '💎', 'new', 5.00, 89, 0),

(4,'Minimal Desk Lamp','minimal-desk-lamp',
 'Touch-controlled with 5 color temperatures, wireless charger base, 50,000hr LED.',
 4999, 6999, 300, 'HOME-001', '💡', 'sale', 4.50, 430, 0),

(6,'Pro Running Shoes','pro-running-shoes',
 'Carbon fibre plate, responsive foam stack, breathable engineered mesh upper.',
 14999, NULL, 95, 'SPRT-001', '🏃', 'new', 4.70, 312, 0),

(2,'Silk Blend Blazer','silk-blend-blazer',
 'Italian silk-wool blend, slim Italian cut, peak lapels, double-vent back.',
 22999, 28999, 55, 'FASH-002', '🧥', 'sale', 4.60, 198, 0);

INSERT INTO coupons (code, type, value, min_order, max_uses) VALUES
('DROCART10', 'percent', 10.00, 999.00, 1000),
('WELCOME500', 'fixed',  500.00, 2000.00, 500),
('SALE20',    'percent', 20.00, 5000.00, 200);

-- ============================================================
-- Stored procedure: recalculate product rating
-- ============================================================
DELIMITER $$
CREATE PROCEDURE IF NOT EXISTS UpdateProductRating(IN p_id INT)
BEGIN
    UPDATE products
    SET rating       = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE product_id = p_id AND is_approved = 1),
        review_count = (SELECT COUNT(*) FROM reviews WHERE product_id = p_id AND is_approved = 1)
    WHERE id = p_id;
END$$
DELIMITER ;

-- ============================================================
-- Trigger: auto generate order_number
-- ============================================================
DELIMITER $$
CREATE TRIGGER IF NOT EXISTS before_order_insert
BEFORE INSERT ON orders FOR EACH ROW
BEGIN
    SET NEW.order_number = CONCAT('DRC', LPAD(FLOOR(RAND()*9000000+1000000), 7, '0'));
END$$
DELIMITER ;

CREATE DATABASE IF NOT EXISTS drocart CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE drocart;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120) NOT NULL, email VARCHAR(180) NOT NULL UNIQUE,
  password VARCHAR(256) NOT NULL, phone VARCHAR(25), avatar VARCHAR(400),
  role ENUM('customer','seller','admin','support') DEFAULT 'customer',
  status ENUM('active','banned','pending') DEFAULT 'active',
  email_verified TINYINT(1) DEFAULT 0, two_fa_enabled TINYINT(1) DEFAULT 0,
  totp_secret VARCHAR(64), google_id VARCHAR(100), is_online TINYINT(1) DEFAULT 0,
  last_seen DATETIME, last_login DATETIME, login_count INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email), INDEX idx_role (role)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, slug VARCHAR(120) NOT NULL UNIQUE,
  description TEXT, icon VARCHAR(10), sort_order INT DEFAULT 0, is_active TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY, category_id INT NOT NULL, name VARCHAR(220) NOT NULL,
  slug VARCHAR(240) NOT NULL UNIQUE, description TEXT, price DECIMAL(12,2) NOT NULL, old_price DECIMAL(12,2),
  stock INT DEFAULT 0, sku VARCHAR(80) UNIQUE, emoji VARCHAR(10) DEFAULT '',
  badge ENUM('new','sale','hot','') DEFAULT '', rating DECIMAL(3,2) DEFAULT 0.00, review_count INT DEFAULT 0,
  sold_count INT DEFAULT 0, view_count INT DEFAULT 0, is_active TINYINT(1) DEFAULT 1, is_featured TINYINT(1) DEFAULT 0,
  tags VARCHAR(400), created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
  INDEX idx_category (category_id), INDEX idx_featured (is_featured), FULLTEXT idx_search (name, description)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS addresses (
  id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, label VARCHAR(40) DEFAULT 'Home',
  full_name VARCHAR(120) NOT NULL, line1 VARCHAR(220) NOT NULL, line2 VARCHAR(220),
  city VARCHAR(80) NOT NULL, state VARCHAR(80) NOT NULL, pincode VARCHAR(12) NOT NULL,
  country VARCHAR(60) DEFAULT 'India', phone VARCHAR(25), is_default TINYINT(1) DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, address_id INT,
  order_number VARCHAR(30) NOT NULL UNIQUE,
  status ENUM('pending','confirmed','processing','packed','shipped','out_for_delivery','delivered','cancelled','returned','refunded') DEFAULT 'pending',
  payment_method ENUM('cod','upi','card','netbanking','wallet') DEFAULT 'cod',
  payment_status ENUM('pending','paid','failed','refunded') DEFAULT 'pending',
  payment_ref VARCHAR(120), subtotal DECIMAL(12,2) NOT NULL, discount DECIMAL(12,2) DEFAULT 0.00,
  shipping_fee DECIMAL(10,2) DEFAULT 0.00, total DECIMAL(12,2) NOT NULL,
  tracking_number VARCHAR(80), courier VARCHAR(80) DEFAULT 'Drocart Express',
  estimated_delivery DATE, delivered_at DATETIME, cancel_reason VARCHAR(300), notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (address_id) REFERENCES addresses(id),
  INDEX idx_user (user_id), INDEX idx_status (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY, order_id INT NOT NULL, product_id INT NOT NULL,
  name VARCHAR(220) NOT NULL, emoji VARCHAR(10), price DECIMAL(12,2) NOT NULL, qty INT NOT NULL, subtotal DECIMAL(12,2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE, FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_status_history (
  id INT AUTO_INCREMENT PRIMARY KEY, order_id INT NOT NULL, status VARCHAR(60) NOT NULL,
  note TEXT, location VARCHAR(200), created_by INT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS delivery_checkpoints (
  id INT AUTO_INCREMENT PRIMARY KEY, order_id INT NOT NULL, status VARCHAR(80) NOT NULL, title VARCHAR(200) NOT NULL,
  description VARCHAR(400), location VARCHAR(200), city VARCHAR(80), latitude DECIMAL(10,7), longitude DECIMAL(10,7),
  is_reached TINYINT(1) DEFAULT 0, is_current TINYINT(1) DEFAULT 0, reached_at DATETIME, estimated_at DATETIME,
  sort_order INT DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE, INDEX idx_order (order_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS delivery_agents (
  id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120) NOT NULL, phone VARCHAR(25) NOT NULL,
  vehicle VARCHAR(60), vehicle_no VARCHAR(20), rating DECIMAL(3,2) DEFAULT 4.50,
  status ENUM('available','on_delivery','off_duty') DEFAULT 'available', latitude DECIMAL(10,7), longitude DECIMAL(10,7),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_assignments (
  id INT AUTO_INCREMENT PRIMARY KEY, order_id INT NOT NULL UNIQUE, agent_id INT NOT NULL,
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id), FOREIGN KEY (agent_id) REFERENCES delivery_agents(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cart_items (
  id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, product_id INT NOT NULL, qty INT NOT NULL DEFAULT 1,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_cart (user_id, product_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wishlists (
  id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, product_id INT NOT NULL,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_wish (user_id, product_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reviews (
  id INT AUTO_INCREMENT PRIMARY KEY, product_id INT NOT NULL, user_id INT NOT NULL,
  rating TINYINT NOT NULL CHECK (rating BETWEEN 1 AND 5), title VARCHAR(200), body TEXT,
  is_approved TINYINT(1) DEFAULT 0, is_verified TINYINT(1) DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_review (product_id, user_id),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS coupons (
  id INT AUTO_INCREMENT PRIMARY KEY, code VARCHAR(30) NOT NULL UNIQUE,
  type ENUM('percent','fixed','free_shipping') DEFAULT 'percent', value DECIMAL(10,2) NOT NULL,
  min_order DECIMAL(10,2) DEFAULT 0, max_uses INT DEFAULT 100, used_count INT DEFAULT 0,
  expires_at DATETIME, is_active TINYINT(1) DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chat_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, agent_id INT, order_id INT,
  subject VARCHAR(200) DEFAULT 'General Enquiry', status ENUM('open','assigned','resolved','closed') DEFAULT 'open',
  rating TINYINT, feedback VARCHAR(400), created_at DATETIME DEFAULT CURRENT_TIMESTAMP, assigned_at DATETIME, resolved_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL, FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chat_messages (
  id INT AUTO_INCREMENT PRIMARY KEY, session_id INT NOT NULL, sender_id INT, sender_name VARCHAR(80),
  body TEXT NOT NULL, type ENUM('text','image','file','system','bot') DEFAULT 'text',
  is_read TINYINT(1) DEFAULT 0, sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE, INDEX idx_session (session_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chat_quick_replies (
  id INT AUTO_INCREMENT PRIMARY KEY, label VARCHAR(100) NOT NULL, response TEXT NOT NULL,
  keywords VARCHAR(400), category VARCHAR(60), is_active TINYINT(1) DEFAULT 1, sort_order INT DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, type VARCHAR(50) NOT NULL, title VARCHAR(200) NOT NULL,
  body TEXT, icon VARCHAR(10) DEFAULT '🔔', url VARCHAR(300), is_read TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_unread (user_id, is_read)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS subscribers (
  id INT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(180) NOT NULL UNIQUE, subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admin_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, admin_id INT NOT NULL, action VARCHAR(100) NOT NULL,
  target VARCHAR(100), target_id INT, ip VARCHAR(45), created_at DATETIME DEFAULT CURRENT_TIMESTAMP, INDEX idx_admin (admin_id)
) ENGINE=InnoDB;

DELIMITER $$
DROP TRIGGER IF EXISTS before_order_insert$$
CREATE TRIGGER before_order_insert BEFORE INSERT ON orders FOR EACH ROW
BEGIN SET NEW.order_number = CONCAT('DRC',DATE_FORMAT(NOW(),'%y%m'),LPAD(FLOOR(RAND()*900000+100000),6,'0')); END$$

DROP TRIGGER IF EXISTS after_order_item_insert$$
CREATE TRIGGER after_order_item_insert AFTER INSERT ON order_items FOR EACH ROW
BEGIN UPDATE products SET stock=stock-NEW.qty, sold_count=sold_count+NEW.qty WHERE id=NEW.product_id; END$$

DROP PROCEDURE IF EXISTS UpdateProductRating$$
CREATE PROCEDURE UpdateProductRating(IN p_id INT)
BEGIN
  UPDATE products SET rating=COALESCE((SELECT AVG(rating) FROM reviews WHERE product_id=p_id AND is_approved=1),0),
    review_count=(SELECT COUNT(*) FROM reviews WHERE product_id=p_id AND is_approved=1) WHERE id=p_id;
END$$
DELIMITER ;

INSERT IGNORE INTO users (name,email,password,role,status,email_verified) VALUES
('Super Admin','admin@drocart.com','$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMaJObIuPxA9P7v6q4z.Hs4W6W','admin','active',1),
('Support Agent','agent@drocart.com','$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMaJObIuPxA9P7v6q4z.Hs4W6W','support','active',1),
('Aanya Kapoor','aanya@example.com','$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMaJObIuPxA9P7v6q4z.Hs4W6W','customer','active',1),
('Rohan Sharma','rohan@example.com','$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMaJObIuPxA9P7v6q4z.Hs4W6W','customer','active',1);

INSERT IGNORE INTO categories (name,slug,icon,sort_order) VALUES
('Electronics','electronics','🎧',1),('Fashion','fashion','👟',2),('Jewelry','jewelry','💎',3),
('Home & Living','home-living','🏠',4),('Beauty','beauty','🌹',5),('Sports','sports','⚽',6);

INSERT IGNORE INTO products (category_id,name,slug,description,price,old_price,stock,sku,emoji,badge,rating,review_count,sold_count,is_featured) VALUES
(1,'Pro Audio Headphones X1','pro-audio-headphones-x1','Studio-grade wireless, 40hr battery, ANC.',18999,24999,85,'AUD-001','🎧','sale',4.90,2341,1240,1),
(1,'Smart Watch Series 9','smart-watch-series-9','Always-on display, 8 health sensors, GPS.',32499,NULL,42,'WER-001','⌚','new',4.80,1204,560,1),
(2,'Air Max Signature','air-max-signature','Full-length Air cushioning, premium leather.',12999,15999,130,'SHO-001','👟','hot',4.70,876,890,1),
(1,'Mirrorless Camera Pro','mirrorless-camera-pro','61MP full-frame, 8-stop IBIS, 4K120.',89999,NULL,18,'CAM-001','📷','new',4.90,445,120,1),
(5,'Luxe Perfume Collection','luxe-perfume-collection','Woody, floral & oriental accords.',7499,9999,200,'BEA-001','🌹','sale',4.60,1102,780,1),
(1,'UltraBook Pro 15','ultrabook-pro-15','M3 Pro chip, 18hr battery, Liquid Retina XDR.',124999,139999,25,'LAP-001','💻','hot',4.80,567,234,1),
(3,'Diamond Tennis Bracelet','diamond-tennis-bracelet','18K white gold, 5ct VS1 diamonds.',245000,NULL,8,'JWL-001','💎','',5.00,89,12,0),
(4,'Minimal Desk Lamp','minimal-desk-lamp','Touch control, 5 colour temps.',4999,6999,300,'HOM-001','💡','sale',4.50,430,310,0),
(6,'Carbon Runner Pro','carbon-runner-pro','Carbon fibre plate, 40mm foam.',14999,NULL,95,'SPT-001','🏃','new',4.70,312,430,1),
(1,'4K OLED Monitor 27"','4k-oled-monitor-27','27" OLED, 120Hz, USB-C 140W.',68999,79999,35,'MON-001','🖥️','sale',4.85,234,110,1);

INSERT IGNORE INTO delivery_agents (name,phone,vehicle,vehicle_no,rating,status,latitude,longitude) VALUES
('Arjun Singh','+91-98001-11111','Bike','TS09AB1234',4.80,'available',17.4065,78.4772),
('Meera Patel','+91-98001-22222','Bike','MH12CD5678',4.90,'available',17.4100,78.4900),
('Karthik Rao','+91-98001-33333','Van','KA03EF9012',4.70,'available',17.3950,78.4600);

INSERT IGNORE INTO chat_quick_replies (label,response,keywords,sort_order) VALUES
('Track Order','To track your order, go to **My Orders** in your account.','track,tracking,where,order,delivery,status',1),
('Cancel Order','You can cancel from **My Orders → Cancel**. Only before shipment.','cancel,cancellation',2),
('Return Policy','Returns within **7 days** of delivery. Refunds in 5–7 days.','return,refund,exchange',3),
('Delivery Time','🚚 Standard: **3–5 business days**.','delivery,time,when,days,shipping',4),
('Payment Methods','💳 Cards, 📱 UPI, 🏦 Net Banking, 💵 COD.','payment,pay,upi,card,cod',5),
('Coupon Codes','Use **DROCART10** (10% off), **WELCOME500** (₹500 off).','coupon,discount,promo,code',6),
('Live Agent','Connecting to a **live support agent** 👤.','agent,human,real,speak',7);

INSERT IGNORE INTO coupons (code,type,value,min_order,max_uses,expires_at) VALUES
('DROCART10','percent',10,999,1000,DATE_ADD(NOW(),INTERVAL 90 DAY)),
('WELCOME500','fixed',500,2000,500,DATE_ADD(NOW(),INTERVAL 90 DAY)),
('SALE20','percent',20,5000,200,DATE_ADD(NOW(),INTERVAL 30 DAY)),
('FREESHIP','free_shipping',0,499,2000,DATE_ADD(NOW(),INTERVAL 60 DAY));

INSERT IGNORE INTO reviews (product_id,user_id,rating,title,body,is_approved,is_verified) VALUES
(1,3,5,'Absolutely stunning!','Best headphones I have owned.',1,1),
(2,3,5,'Game changer!','Health sensors accurate.',1,1),
(3,4,4,'Very comfortable','Great cushioning and stylish.',1,1),
(6,3,5,'Best laptop ever','M3 Pro chip is insanely fast.',1,1);

INSERT IGNORE INTO notifications (user_id,type,title,body,icon,url) VALUES
(3,'welcome','Welcome to Drocart! 🎉','Start shopping and enjoy deals.','🎉','/#featured'),
(3,'offer','Weekend Sale — Up to 40% Off!','New deals added.','🔥','/#featured');

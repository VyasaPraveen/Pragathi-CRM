-- ============================================================================
-- Pragathi CRM — MySQL schema (Hostinger migration off Firestore)
-- Firestore's document model → one table per collection: (id, data JSON, ts).
-- The app loads whole collections and filters client-side, so JSON-doc rows
-- give exact behavioural parity with minimal API surface.
-- Charset utf8mb4 for full Unicode (₹, emoji, etc.). Requires MySQL 5.7+/8.0.
-- ============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ── Users (auth) ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            VARCHAR(40)  NOT NULL,
  email         VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NULL,
  display_name  VARCHAR(190) NULL,
  phone         VARCHAR(20)  NULL,
  role          VARCHAR(40)  NOT NULL DEFAULT 'staff',
  designation   VARCHAR(80)  NULL,
  approved      TINYINT(1)   NOT NULL DEFAULT 0,
  permissions   JSON         NULL,
  data          JSON         NULL,          -- any extra fields (address, notes, teamId…)
  last_login    DATETIME     NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_approved (approved)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Company settings (single-row key/value document) ─────────────────────────
CREATE TABLE IF NOT EXISTS company_settings (
  id         VARCHAR(40) NOT NULL,           -- e.g. 'settings'
  data       JSON        NULL,
  updated_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── FCM push tokens (Firebase kept ONLY for Cloud Messaging, Spark plan) ──────
CREATE TABLE IF NOT EXISTS fcm_tokens (
  token       VARCHAR(255) NOT NULL,
  user_id     VARCHAR(40)  NULL,
  user_email  VARCHAR(190) NULL,
  user_name   VARCHAR(190) NULL,
  platform    VARCHAR(20)  NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (token),
  KEY idx_fcm_user (user_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Generic document collections ─────────────────────────────────────────────
-- Each mirrors a former Firestore collection. Table names are snake_case; the
-- API maps the frontend collection name → table via an allowlist.

-- helper macro is not available in plain SQL, so tables are spelled out:

CREATE TABLE IF NOT EXISTS leads          (id VARCHAR(40) NOT NULL, data JSON NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, created_by VARCHAR(190) NULL, updated_by VARCHAR(190) NULL, PRIMARY KEY (id), KEY idx_created (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS customers      (id VARCHAR(40) NOT NULL, data JSON NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, created_by VARCHAR(190) NULL, updated_by VARCHAR(190) NULL, PRIMARY KEY (id), KEY idx_created (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS installations  (id VARCHAR(40) NOT NULL, data JSON NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, created_by VARCHAR(190) NULL, updated_by VARCHAR(190) NULL, PRIMARY KEY (id), KEY idx_created (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS team           (id VARCHAR(40) NOT NULL, data JSON NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, created_by VARCHAR(190) NULL, updated_by VARCHAR(190) NULL, PRIMARY KEY (id), KEY idx_created (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS materials      (id VARCHAR(40) NOT NULL, data JSON NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, created_by VARCHAR(190) NULL, updated_by VARCHAR(190) NULL, PRIMARY KEY (id), KEY idx_created (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS ongoing_work   (id VARCHAR(40) NOT NULL, data JSON NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, created_by VARCHAR(190) NULL, updated_by VARCHAR(190) NULL, PRIMARY KEY (id), KEY idx_created (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS income         (id VARCHAR(40) NOT NULL, data JSON NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, created_by VARCHAR(190) NULL, updated_by VARCHAR(190) NULL, PRIMARY KEY (id), KEY idx_created (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS expenses       (id VARCHAR(40) NOT NULL, data JSON NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, created_by VARCHAR(190) NULL, updated_by VARCHAR(190) NULL, PRIMARY KEY (id), KEY idx_created (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS reminders      (id VARCHAR(40) NOT NULL, data JSON NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, created_by VARCHAR(190) NULL, updated_by VARCHAR(190) NULL, PRIMARY KEY (id), KEY idx_created (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS gallery        (id VARCHAR(40) NOT NULL, data JSON NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, created_by VARCHAR(190) NULL, updated_by VARCHAR(190) NULL, PRIMARY KEY (id), KEY idx_created (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS purchase_orders(id VARCHAR(40) NOT NULL, data JSON NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, created_by VARCHAR(190) NULL, updated_by VARCHAR(190) NULL, PRIMARY KEY (id), KEY idx_created (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS retailers      (id VARCHAR(40) NOT NULL, data JSON NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, created_by VARCHAR(190) NULL, updated_by VARCHAR(190) NULL, PRIMARY KEY (id), KEY idx_created (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS influencers    (id VARCHAR(40) NOT NULL, data JSON NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, created_by VARCHAR(190) NULL, updated_by VARCHAR(190) NULL, PRIMARY KEY (id), KEY idx_created (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS employee_tasks (id VARCHAR(40) NOT NULL, data JSON NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, created_by VARCHAR(190) NULL, updated_by VARCHAR(190) NULL, PRIMARY KEY (id), KEY idx_created (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS lead_pos       (id VARCHAR(40) NOT NULL, data JSON NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, created_by VARCHAR(190) NULL, updated_by VARCHAR(190) NULL, PRIMARY KEY (id), KEY idx_created (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS expenditures   (id VARCHAR(40) NOT NULL, data JSON NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, created_by VARCHAR(190) NULL, updated_by VARCHAR(190) NULL, PRIMARY KEY (id), KEY idx_created (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS bom_templates  (id VARCHAR(40) NOT NULL, data JSON NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, created_by VARCHAR(190) NULL, updated_by VARCHAR(190) NULL, PRIMARY KEY (id), KEY idx_created (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS activity_log   (id VARCHAR(40) NOT NULL, data JSON NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, created_by VARCHAR(190) NULL, updated_by VARCHAR(190) NULL, PRIMARY KEY (id), KEY idx_created (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS notifications   (id VARCHAR(40) NOT NULL, data JSON NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, created_by VARCHAR(190) NULL, updated_by VARCHAR(190) NULL, PRIMARY KEY (id), KEY idx_created (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

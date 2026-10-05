-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20261003_add_marketplace_and_transport
-- Description: Add school marketplace (Phase C-4) and transport (Phase C-5) tables
-- Strategy: ADDITIVE ONLY — no existing tables modified
-- V1 scope: V1-DEFERRED product features — backend controllers are active so
--           tables must exist to prevent Prisma ORM errors at startup/import.
-- Dependency order:
--   schools, users, students, teachers must exist first.
--   Within this migration: school_buses → bus_routes → bus_stops
--                          school_buses, bus_routes, bus_stops, drivers → bus_assignments
--                          products → orders → reviews
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── products ────────────────────────────────────────────────────────────────
CREATE TABLE `products` (
  `id`            VARCHAR(191)                              NOT NULL,
  `schoolId`      VARCHAR(191)                              NULL,
  `sellerId`      VARCHAR(191)                              NOT NULL,
  `title`         VARCHAR(191)                              NOT NULL,
  `description`   TEXT                                      NULL,
  `category`      VARCHAR(191)                              NOT NULL DEFAULT 'OTHER',
  `condition`     ENUM('NEW','LIKE_NEW','GOOD','FAIR','POOR') NOT NULL DEFAULT 'NEW',
  `price`         DECIMAL(10, 2)                            NOT NULL,
  `negotiable`    TINYINT(1)                                NOT NULL DEFAULT 0,
  `images`        LONGTEXT                                  NULL,
  `stock`         INT                                       NOT NULL DEFAULT 1,
  `viewCount`     INT                                       NOT NULL DEFAULT 0,
  `favoriteCount` INT                                       NOT NULL DEFAULT 0,
  `soldCount`     INT                                       NOT NULL DEFAULT 0,
  `isActive`      TINYINT(1)                                NOT NULL DEFAULT 1,
  `featured`      TINYINT(1)                                NOT NULL DEFAULT 0,
  `expiresAt`     DATETIME(3)                               NULL,
  `deletedAt`     DATETIME(3)                               NULL,
  `createdAt`     DATETIME(3)                               NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3)                               NOT NULL,

  PRIMARY KEY (`id`),
  INDEX `products_schoolId_idx` (`schoolId`),
  INDEX `products_sellerId_idx` (`sellerId`),
  INDEX `products_category_idx` (`category`),
  INDEX `products_condition_idx` (`condition`),
  INDEX `products_isActive_idx` (`isActive`),
  INDEX `products_createdAt_idx` (`createdAt`),

  CONSTRAINT `products_schoolId_fkey`
    FOREIGN KEY (`schoolId`) REFERENCES `schools` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `products_sellerId_fkey`
    FOREIGN KEY (`sellerId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE

) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── orders ──────────────────────────────────────────────────────────────────
CREATE TABLE `orders` (
  `id`              VARCHAR(191)                                                             NOT NULL,
  `schoolId`        VARCHAR(191)                                                             NULL,
  `productId`       VARCHAR(191)                                                             NOT NULL,
  `buyerId`         VARCHAR(191)                                                             NOT NULL,
  `sellerId`        VARCHAR(191)                                                             NOT NULL,
  `quantity`        INT                                                                      NOT NULL DEFAULT 1,
  `totalPrice`      DECIMAL(10, 2)                                                           NOT NULL,
  `status`          ENUM('PENDING','CONFIRMED','PROCESSING','SHIPPED','DELIVERED','CANCELLED','REFUNDED') NOT NULL DEFAULT 'PENDING',
  `shippingAddress` LONGTEXT                                                                 NULL,
  `notes`           TEXT                                                                     NULL,
  `confirmedAt`     DATETIME(3)                                                              NULL,
  `shippedAt`       DATETIME(3)                                                              NULL,
  `deliveredAt`     DATETIME(3)                                                              NULL,
  `cancelledAt`     DATETIME(3)                                                              NULL,
  `refundedAt`      DATETIME(3)                                                              NULL,
  `deletedAt`       DATETIME(3)                                                              NULL,
  `createdAt`       DATETIME(3)                                                              NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3)                                                              NOT NULL,

  PRIMARY KEY (`id`),
  INDEX `orders_schoolId_idx` (`schoolId`),
  INDEX `orders_productId_idx` (`productId`),
  INDEX `orders_buyerId_idx` (`buyerId`),
  INDEX `orders_sellerId_idx` (`sellerId`),
  INDEX `orders_status_idx` (`status`),
  INDEX `orders_createdAt_idx` (`createdAt`),

  CONSTRAINT `orders_schoolId_fkey`
    FOREIGN KEY (`schoolId`) REFERENCES `schools` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `orders_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `products` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `orders_buyerId_fkey`
    FOREIGN KEY (`buyerId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `orders_sellerId_fkey`
    FOREIGN KEY (`sellerId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE

) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── reviews ─────────────────────────────────────────────────────────────────
CREATE TABLE `reviews` (
  `id`         VARCHAR(191) NOT NULL,
  `productId`  VARCHAR(191) NULL,
  `orderId`    VARCHAR(191) NULL,
  `reviewerId` VARCHAR(191) NOT NULL,
  `sellerId`   VARCHAR(191) NOT NULL,
  `rating`     INT          NOT NULL,
  `title`      VARCHAR(191) NULL,
  `body`       TEXT         NULL,
  `images`     LONGTEXT     NULL,
  `isVerified` TINYINT(1)   NOT NULL DEFAULT 0,
  `deletedAt`  DATETIME(3)  NULL,
  `createdAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`  DATETIME(3)  NOT NULL,

  PRIMARY KEY (`id`),
  INDEX `reviews_productId_idx` (`productId`),
  INDEX `reviews_orderId_idx` (`orderId`),
  INDEX `reviews_reviewerId_idx` (`reviewerId`),
  INDEX `reviews_sellerId_idx` (`sellerId`),
  INDEX `reviews_rating_idx` (`rating`),

  CONSTRAINT `reviews_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `products` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `reviews_orderId_fkey`
    FOREIGN KEY (`orderId`) REFERENCES `orders` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `reviews_reviewerId_fkey`
    FOREIGN KEY (`reviewerId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `reviews_sellerId_fkey`
    FOREIGN KEY (`sellerId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE

) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── school_buses ────────────────────────────────────────────────────────────
CREATE TABLE `school_buses` (
  `id`              VARCHAR(191)                                        NOT NULL,
  `schoolId`        VARCHAR(191)                                        NOT NULL,
  `plateNumber`     VARCHAR(191)                                        NOT NULL,
  `busNumber`       VARCHAR(191)                                        NOT NULL,
  `capacity`        INT                                                 NOT NULL DEFAULT 40,
  `make`            VARCHAR(191)                                        NULL,
  `model`           VARCHAR(191)                                        NULL,
  `year`            INT                                                 NULL,
  `color`           VARCHAR(191)                                        NULL,
  `fuelType`        VARCHAR(191)                                        NULL DEFAULT 'DIESEL',
  `status`          ENUM('ACTIVE','INACTIVE','MAINTENANCE','OUT_OF_SERVICE') NOT NULL DEFAULT 'ACTIVE',
  `insuranceExpiry` DATETIME(3)                                         NULL,
  `lastServiceAt`   DATETIME(3)                                         NULL,
  `nextServiceAt`   DATETIME(3)                                         NULL,
  `notes`           TEXT                                                NULL,
  `deletedAt`       DATETIME(3)                                         NULL,
  `createdAt`       DATETIME(3)                                         NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3)                                         NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `school_buses_plateNumber_key` (`plateNumber`),
  UNIQUE INDEX `school_buses_busNumber_key` (`busNumber`),
  INDEX `school_buses_schoolId_idx` (`schoolId`),
  INDEX `school_buses_status_idx` (`status`),

  CONSTRAINT `school_buses_schoolId_fkey`
    FOREIGN KEY (`schoolId`) REFERENCES `schools` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE

) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── bus_routes ──────────────────────────────────────────────────────────────
CREATE TABLE `bus_routes` (
  `id`          VARCHAR(191) NOT NULL,
  `schoolId`    VARCHAR(191) NOT NULL,
  `busId`       VARCHAR(191) NOT NULL,
  `name`        VARCHAR(191) NOT NULL,
  `description` TEXT         NULL,
  `routeNumber` VARCHAR(191) NULL,
  `startTime`   VARCHAR(191) NOT NULL,
  `endTime`     VARCHAR(191) NOT NULL,
  `distanceKm`  DOUBLE       NULL,
  `durationMin` INT          NULL,
  `isActive`    TINYINT(1)   NOT NULL DEFAULT 1,
  `deletedAt`   DATETIME(3)  NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3)  NOT NULL,

  PRIMARY KEY (`id`),
  INDEX `bus_routes_schoolId_idx` (`schoolId`),
  INDEX `bus_routes_busId_idx` (`busId`),
  INDEX `bus_routes_isActive_idx` (`isActive`),

  CONSTRAINT `bus_routes_schoolId_fkey`
    FOREIGN KEY (`schoolId`) REFERENCES `schools` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `bus_routes_busId_fkey`
    FOREIGN KEY (`busId`) REFERENCES `school_buses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE

) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── bus_stops ───────────────────────────────────────────────────────────────
CREATE TABLE `bus_stops` (
  `id`            VARCHAR(191) NOT NULL,
  `routeId`       VARCHAR(191) NOT NULL,
  `name`          VARCHAR(191) NOT NULL,
  `address`       TEXT         NULL,
  `latitude`      DOUBLE       NULL,
  `longitude`     DOUBLE       NULL,
  `sequence`      INT          NOT NULL DEFAULT 0,
  `estimatedTime` VARCHAR(191) NULL,
  `isActive`      TINYINT(1)   NOT NULL DEFAULT 1,
  `deletedAt`     DATETIME(3)  NULL,
  `createdAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3)  NOT NULL,

  PRIMARY KEY (`id`),
  INDEX `bus_stops_routeId_idx` (`routeId`),
  INDEX `bus_stops_sequence_idx` (`sequence`),

  CONSTRAINT `bus_stops_routeId_fkey`
    FOREIGN KEY (`routeId`) REFERENCES `bus_routes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE

) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── drivers ─────────────────────────────────────────────────────────────────
CREATE TABLE `drivers` (
  `id`               VARCHAR(191)                                   NOT NULL,
  `schoolId`         VARCHAR(191)                                   NOT NULL,
  `userId`           VARCHAR(191)                                   NULL,
  `firstName`        VARCHAR(191)                                   NOT NULL,
  `lastName`         VARCHAR(191)                                   NOT NULL,
  `phone`            VARCHAR(191)                                   NOT NULL,
  `licenseNumber`    VARCHAR(191)                                   NOT NULL,
  `licenseExpiry`    DATETIME(3)                                    NULL,
  `address`          TEXT                                           NULL,
  `emergencyContact` LONGTEXT                                       NULL,
  `status`           ENUM('ACTIVE','INACTIVE','ON_LEAVE','SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  `hiredAt`          DATETIME(3)                                    NULL,
  `notes`            TEXT                                           NULL,
  `deletedAt`        DATETIME(3)                                    NULL,
  `createdAt`        DATETIME(3)                                    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`        DATETIME(3)                                    NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `drivers_userId_key` (`userId`),
  UNIQUE INDEX `drivers_licenseNumber_key` (`licenseNumber`),
  INDEX `drivers_schoolId_idx` (`schoolId`),
  INDEX `drivers_userId_idx` (`userId`),
  INDEX `drivers_status_idx` (`status`),

  CONSTRAINT `drivers_schoolId_fkey`
    FOREIGN KEY (`schoolId`) REFERENCES `schools` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `drivers_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE

) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── bus_assignments ─────────────────────────────────────────────────────────
CREATE TABLE `bus_assignments` (
  `id`            VARCHAR(191) NOT NULL,
  `schoolId`      VARCHAR(191) NOT NULL,
  `busId`         VARCHAR(191) NOT NULL,
  `routeId`       VARCHAR(191) NOT NULL,
  `stopId`        VARCHAR(191) NULL,
  `driverId`      VARCHAR(191) NOT NULL,
  `studentId`     VARCHAR(191) NOT NULL,
  `pickupTime`    VARCHAR(191) NOT NULL,
  `dropoffTime`   VARCHAR(191) NOT NULL,
  `isMorning`     TINYINT(1)   NOT NULL DEFAULT 1,
  `isAfternoon`   TINYINT(1)   NOT NULL DEFAULT 1,
  `isActive`      TINYINT(1)   NOT NULL DEFAULT 1,
  `effectiveFrom` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `effectiveTo`   DATETIME(3)  NULL,
  `notes`         TEXT         NULL,
  `deletedAt`     DATETIME(3)  NULL,
  `createdAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3)  NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `bus_assignments_studentId_isMorning_effectiveFrom_key` (`studentId`, `isMorning`, `effectiveFrom`),
  INDEX `bus_assignments_schoolId_idx` (`schoolId`),
  INDEX `bus_assignments_busId_idx` (`busId`),
  INDEX `bus_assignments_routeId_idx` (`routeId`),
  INDEX `bus_assignments_driverId_idx` (`driverId`),
  INDEX `bus_assignments_studentId_idx` (`studentId`),
  INDEX `bus_assignments_isActive_idx` (`isActive`),

  CONSTRAINT `bus_assignments_busId_fkey`
    FOREIGN KEY (`busId`) REFERENCES `school_buses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `bus_assignments_routeId_fkey`
    FOREIGN KEY (`routeId`) REFERENCES `bus_routes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `bus_assignments_stopId_fkey`
    FOREIGN KEY (`stopId`) REFERENCES `bus_stops` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `bus_assignments_driverId_fkey`
    FOREIGN KEY (`driverId`) REFERENCES `drivers` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `bus_assignments_studentId_fkey`
    FOREIGN KEY (`studentId`) REFERENCES `students` (`id`) ON DELETE CASCADE ON UPDATE CASCADE

) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "nameUz" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "nameUz" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "priceUzs" INTEGER NOT NULL,
    "image" TEXT NOT NULL,
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "descriptionRu" TEXT,
    "descriptionUz" TEXT,
    "tdp" INTEGER,
    "socket" TEXT,
    "ramType" TEXT,
    "ramSlots" INTEGER,
    "formFactor" TEXT,
    "gpuLength" INTEGER,
    "maxGpuLength" INTEGER,
    "coolerHeight" INTEGER,
    "maxCoolerHeight" INTEGER,
    "coolerType" TEXT,
    "maxRadiatorSupport" TEXT,
    "psuWattage" INTEGER,
    "psuCertification" TEXT,
    "storageInterface" TEXT,
    "capacityGb" INTEGER,
    "speedMhz" INTEGER,
    "cpuScore" INTEGER,
    "gpuScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "genre" TEXT NOT NULL,
    "releaseYear" INTEGER NOT NULL,
    "gpuIntensity" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "cpuIntensity" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "baseFps1080pUltra" INTEGER NOT NULL DEFAULT 60,
    "ramMinGb" INTEGER NOT NULL DEFAULT 16,
    "descriptionRu" TEXT NOT NULL,
    "descriptionUz" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerTelegram" TEXT,
    "deliveryAddress" TEXT,
    "totalUzs" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "itemsJson" TEXT NOT NULL,
    "isCustomPc" BOOLEAN NOT NULL DEFAULT false,
    "telegramReceiptSent" BOOLEAN NOT NULL DEFAULT false,
    "paymentReceiptUrl" TEXT,
    "paymentReceiptName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

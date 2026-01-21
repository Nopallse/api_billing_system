// transactionController.js
const { Transaction, Device, Category, Member, Payment, Product, TransactionProduct } = require("../models");
const { getAnyActiveShift, createPaymentRecord } = require("./shift.controller");
// WebSocket DISABLED - Stub functions untuk backward compatibility
const sendToESP32 = () => ({ success: true });
const getConnectionStatus = () => ({ devices: [], totalDevices: 0 });
const onDeviceDisconnect = () => { };
const notifyMobileClients = () => { };
const sendAddTime = () => ({ success: true });
const sendCommand = () => ({ success: true });
const { v4: uuidv4 } = require("uuid");
const { Op } = require("sequelize");
const {
  logTransactionStart,
  logTransactionEnd,
  getTransactionActivities,
  getTransactionSummary,
    logBleDisconnect,
} = require("../utils/transactionActivityLogger");

// Register disconnect callback untuk semua device - DISABLED (WebSocket removed)
// const registerDisconnectHandlers = () => { ... };
// Initialize disconnect handlers - DISABLED
// registerDisconnectHandlers();

// Helpers: parse/format local datetime and compute usage from activities
// Extracted to shared helper file for reuse across controllers
const {
  parseLocalDateTime,
  formatLocalDateTime,
  computeUsageSecondsFromActivities
} = require('./transaction.controller.helpers');

const createTransaction = async (req, res) => {
  try {
    const { deviceId, start, duration } = req.body;

    // Validasi input
    if (!deviceId || !duration || !start) {
      return res.status(400).json({
        message: " deviceId, start, dan duration wajib diisi",
      });
    }

    // Cek apakah device terdaftar di database
    const device = await Device.findByPk(deviceId);
    if (!device) {
      return res.status(404).json({
        message: "Device tidak ditemukan di database",
      });
    }

    // NOTE: Tidak perlu cek WebSocket lagi karena relay control sekarang via BLE
    // Mobile app akan mengirim perintah langsung ke ESP32 via BLE
    // Backend hanya menyimpan data transaksi

    // Validasi shift aktif
    const activeShift = await getAnyActiveShift();
    if (!activeShift) {
      return res.status(400).json({
        message: "Tidak dapat memulai transaksi. Shift belum aktif. Silakan mulai shift terlebih dahulu.",
      });
    }

    // Cek apakah device sudah memiliki transaksi aktif di database
    const existingTransaction = await Transaction.findOne({
      where: {
        deviceId: deviceId,
        end: null,
      },
    });

    if (existingTransaction) {
      return res.status(400).json({
        message:
          "Device masih memiliki transaksi aktif. Harap selesaikan transaksi yang ada terlebih dahulu.",
      });
    }

    // Cek apakah device memiliki timer yang aktif di database
    // if (device.timerStatus === 'start') {
    //     return res.status(400).json({
    //         message: 'Device masih memiliki timer yang aktif di database. Harap tunggu timer selesai atau gunakan command end terlebih dahulu.'
    //     });
    // }

    // Hitung cost (duration dari frontend diasumsikan DETIK)
    const category = await Category.findByPk(device.categoryId);
    if (!category) {
      return res
        .status(400)
        .json({ message: "Kategori device tidak ditemukan" });
    }
    const { calculateCost } = require("../utils/cost");
    const durationSeconds = Number(duration);
    if (isNaN(durationSeconds) || durationSeconds <= 0) {
      return res
        .status(400)
        .json({
          message: "Duration harus berupa angka detik yang valid (> 0)",
        });
    }
    const cost = calculateCost(durationSeconds, category);
    if (cost <= 0) {
      return res.status(400).json({
        message: "Perhitungan biaya menghasilkan nilai tidak valid",
        data: {
          durationSeconds,
          periodeMenit: category.periode,
          costPerPeriode: category.cost,
        },
      });
    }

    const transactionId = uuidv4();

    await device.update({
      timerStart: start,
      timerDuration: duration,
      timerStatus: "start",
    });

    //
    // Buat transaksi - end harus null untuk transaksi yang sedang aktif
    // Gunakan Date object langsung untuk kolom DATETIME
    const startDateTime = new Date(start);

    const transaction = await Transaction.create({
      id: transactionId,
      userId: req.user.id,
      deviceId,
      start: startDateTime, // DATETIME object
      end: null, // Transaksi aktif tidak boleh memiliki end timestamp
      duration,
      cost: cost,
      isMemberTransaction: false,
      paymentType: "upfront",
      status: "active",
    });

    if (activeShift) {
      await createPaymentRecord({
        shiftId: activeShift.id,
        userId: req.user.id,
        transactionId: transactionId,
        amount: cost,
        type: 'RENTAL',
        paymentMethod: req.body.paymentMethod || 'CASH',
        note: `Bayar di awal - Device: ${device.name}`
      });
    }

    // Log aktivitas start transaksi
    await logTransactionStart(transactionId, deviceId, duration, cost, false, {
      userId: req.user.id,
    });

    // NOTE: Tidak perlu kirim ke ESP32 via WebSocket lagi
    // Relay control sekarang via BLE langsung dari mobile app ke ESP32
    // Backend hanya menyimpan data transaksi

    return res.status(201).json({
      message: "Transaksi berhasil dibuat",
      data: {
        transaction,
      },
    });
  } catch (error) {
    console.error("Error creating transaction:", error);
    return res.status(500).json({
      message: "Terjadi kesalahan saat membuat transaksi",
      error: error.message,
    });
  }
};

// Create regular transaction (bayar di akhir)
const createRegularTransaction = async (req, res) => {
  try {
    const { deviceId } = req.body;
    const userId = req.user.id;

    // Validasi input
    if (!deviceId) {
      return res.status(400).json({
        message: "Device ID wajib diisi",
      });
    }

    // Cari device
    const device = await Device.findByPk(deviceId, {
      include: [
        {
          model: Category,
        },
      ],
    });

    if (!device) {
      return res.status(404).json({
        message: "Device tidak ditemukan",
      });
    }

    // NOTE: Tidak perlu cek WebSocket lagi karena relay control sekarang via BLE
    // Mobile app akan mengirim perintah langsung ke ESP32 via BLE

    // Validasi shift aktif
    const activeShift = await getAnyActiveShift();
    if (!activeShift) {
      return res.status(400).json({
        message: "Tidak dapat memulai transaksi. Shift belum aktif. Silakan mulai shift terlebih dahulu.",
      });
    }

    // Cek apakah device sedang digunakan
    if (device.timerStatus === "start") {
      return res.status(400).json({
        message: "Device sedang digunakan",
      });
    }

    // Cek apakah ada transaksi aktif untuk device ini
    const activeTransaction = await Transaction.findOne({
      where: {
        deviceId: deviceId,
        end: null,
      },
    });

    if (activeTransaction) {
      return res.status(400).json({
        message: "Device masih memiliki transaksi aktif",
      });
    }

    const startTime = new Date();
    const transactionId = uuidv4();

    // Gunakan Date object langsung untuk kolom DATETIME
    // Buat transaksi dengan duration null (unlimited)
    const transaction = await Transaction.create({
      id: transactionId,
      deviceId: deviceId,
      userId: userId,
      start: startTime, // DATETIME object
      end: null,
      duration: null, // Unlimited duration
      cost: null, // Will be calculated when finished
      isMemberTransaction: false,
      memberId: null,
      paymentType: "end", // Bayar di akhir
      status: "active",
    });

    // Update device timer status
    await device.update({
      timerStatus: "start",
      timerStart: startTime,
      timerDuration: null, // Unlimited
      timerElapsed: 0,
    });

    // Log aktivitas transaksi
    await logTransactionStart(transactionId, {
      deviceId,
      userId,
      transactionType: "regular",
      paymentType: "end",
      duration: "unlimited",
    });

    // NOTE: Relay control sekarang via BLE, tidak perlu kirim ke ESP32 via WebSocket

    return res.status(201).json({
      message: "Transaksi regular berhasil dimulai (bayar di akhir)",
      data: {
        transaction: {
          id: transactionId,
          deviceId,
          userId,
          start: startTime,
          paymentType: "end",
          status: "active",
        },
      },
    });
  } catch (error) {
    console.error("Error creating regular transaction:", error);
    return res.status(500).json({
      message: "Terjadi kesalahan saat membuat transaksi regular",
      error: error.message,
    });
  }
};

const getAllTransactions = async (req, res) => {
  try {
    const { start_date, end_date, page = 1, limit = 10, activeShiftOnly } = req.query;
    const userId = req.user.id;

    // Validasi format tanggal
    const startDate = start_date ? new Date(start_date) : null;
    const endDate = end_date ? new Date(end_date) : null;

    if (start_date && isNaN(startDate.getTime())) {
      return res.status(400).json({
        message:
          "Format tanggal mulai tidak valid (gunakan format: YYYY-MM-DD)",
      });
    }

    if (end_date && isNaN(endDate.getTime())) {
      return res.status(400).json({
        message:
          "Format tanggal selesai tidak valid (gunakan format: YYYY-MM-DD)",
      });
    }

    // Konfigurasi where clause
    const whereClause = {};
    
    // Filter by active shift if requested
    if (activeShiftOnly === 'true') {
      const activeShift = await getAnyActiveShift();
      if (activeShift) {
        // Get all payment transaction IDs from this shift
        const shiftPayments = await Payment.findAll({
          where: { shiftId: activeShift.id },
          attributes: ['transactionId']
        });
        
        const transactionIds = shiftPayments
          .map(p => p.transactionId)
          .filter(id => id !== null);
        
        if (transactionIds.length > 0) {
          whereClause.id = {
            [Op.in]: transactionIds
          };
        } else {
          // No transactions in this shift yet
          whereClause.id = {
            [Op.in]: [] // Empty result
          };
        }
      } else {
        // No active shift, return empty (will be handled by frontend to show all)
        whereClause.id = {
          [Op.in]: [] // Empty result
        };
      }
    }
    if (startDate && endDate) {
      // Jika tanggal sama, set waktu end_date ke akhir hari
      if (startDate.toDateString() === endDate.toDateString()) {
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);
        whereClause.createdAt = {
          [Op.between]: [startDate, endOfDay],
        };
      } else {
        whereClause.createdAt = {
          [Op.between]: [startDate, endDate],
        };
      }
    } else if (startDate) {
      whereClause.createdAt = {
        [Op.gte]: startDate,
      };
    } else if (endDate) {
      whereClause.createdAt = {
        [Op.lte]: endDate,
      };
    }

    // Hitung offset untuk pagination
    const offset = (page - 1) * limit;

    // Query dengan pagination dan filter
    const { count, rows: transactions } = await Transaction.findAndCountAll({
      where: whereClause,
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: Device,
          include: [
            {
              model: Category,
            },
          ],
        },
        {
          model: Member,
          as: "member",
          attributes: ["id", "username", "email", "deposit"],
          required: false,
        },
      ],
      limit: parseInt(limit),
      offset: offset,
    });

    // Hitung total halaman
    const totalPages = Math.ceil(count / limit);

    return res.status(200).json({
      message: "Success",
      data: {
        transactions,
        pagination: {
          totalItems: count,
          totalPages,
          currentPage: parseInt(page),
          itemsPerPage: parseInt(limit),
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      },
    });
  } catch (error) {
    console.error("Error getting transactions:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

const getTransactionById = async (req, res) => {
  const { id } = req.params;

  try {
    const transaction = await Transaction.findByPk(id, {
      include: [
        {
          model: Device,
          include: [
            {
              model: Category,
            },
          ],
        },
        {
          model: Member,
          as: "member",
          attributes: ["id", "username", "email", "deposit"],
          required: false,
        },
        {
          model: TransactionProduct,
          as: "transactionProducts",
          include: [
            {
              model: Product,
              as: "product",
              attributes: ["id", "name", "description", "price"]
            }
          ],
          required: false
        }
      ],
    });

    if (!transaction) {
      return res.status(404).json({
        message: "Transaction not found",
      });
    }

    // Format data untuk response
    const transactionData = transaction.toJSON();

    // Dapatkan aktivitas dan ringkasan transaksi (digunakan untuk hitung durasi riil)
    const activities = await getTransactionActivities(id);
    const activitySummary = await getTransactionSummary(id);

    // Hitung informasi receipt berbasis waktu DB & activity
    let receiptInfo = null;
    if (transactionData.Device && transactionData.Device.Category) {
      const category = transactionData.Device.Category;

      // Ambil start/end dari DB (local time) dan hitung durasi riil dari activity
      const startDT = parseLocalDateTime(
        transactionData.start || transactionData.createdAt
      );
      const endDT = transactionData.end
        ? parseLocalDateTime(transactionData.end)
        : null;
      const realUsageSeconds = computeUsageSecondsFromActivities(
        activities,
        startDT,
        endDT
      );
      const realUsageMinutes = Math.ceil(realUsageSeconds / 60);

      // Fallback endTime jika tidak ada end namun ada duration di record
      let endForDisplay = endDT;
      if (!endForDisplay && startDT && transactionData.duration) {
        endForDisplay = new Date(
          startDT.getTime() + Number(transactionData.duration) * 1000
        );
      }

      receiptInfo = {
        deviceName: transactionData.Device.name,
        categoryName: category.categoryName,
        startTime: formatLocalDateTime(startDT),
        endTime: formatLocalDateTime(endForDisplay),
        durationSeconds: realUsageSeconds,
        durationMinutes: realUsageMinutes,
        costPerPeriod: category.cost,
        periodMinutes: category.periode,
        totalCost: transactionData.cost,
        isMemberTransaction: transactionData.isMemberTransaction || false,
        member: transactionData.member || null,
        transactionStatus: transactionData.end ? "completed" : "active",
      };
    }

    return res.status(200).json({
      message: "Success",
      data: {
        ...transactionData,
        duration: receiptInfo
          ? receiptInfo.durationSeconds
          : transactionData.duration,
        actualUsageSeconds: receiptInfo
          ? receiptInfo.durationSeconds
          : undefined,
        receipt: receiptInfo,
        activities,
        activitySummary,
      },
    });
  } catch (error) {
    console.error("Error getting transaction:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

const getTransactionsByUserId = async (req, res) => {
  const { userId } = req.params;
  const { start_date, end_date, page = 1, limit = 10 } = req.query;

  try {
    // Validasi format tanggal
    const startDate = start_date ? new Date(start_date) : null;
    const endDate = end_date ? new Date(end_date) : null;

    if (start_date && isNaN(startDate.getTime())) {
      return res.status(400).json({
        message:
          "Format tanggal mulai tidak valid (gunakan format: YYYY-MM-DD)",
      });
    }

    if (end_date && isNaN(endDate.getTime())) {
      return res.status(400).json({
        message:
          "Format tanggal selesai tidak valid (gunakan format: YYYY-MM-DD)",
      });
    }

    // Konfigurasi where clause
    const whereClause = { userId };
    if (startDate && endDate) {
      whereClause.createdAt = {
        [Op.between]: [startDate, endDate],
      };
    } else if (startDate) {
      whereClause.createdAt = {
        [Op.gte]: startDate,
      };
    } else if (endDate) {
      whereClause.createdAt = {
        [Op.lte]: endDate,
      };
    }

    // Hitung offset untuk pagination
    const offset = (page - 1) * limit;

    const { count, rows: transactions } = await Transaction.findAndCountAll({
      where: whereClause,
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: Device,
          include: [
            {
              model: Category,
            },
          ],
        },
      ],
      limit: parseInt(limit),
      offset: offset,
    });

    // Hitung total halaman
    const totalPages = Math.ceil(count / limit);

    return res.status(200).json({
      message: "Success",
      data: {
        transactions,
        pagination: {
          totalItems: count,
          totalPages,
          currentPage: parseInt(page),
          itemsPerPage: parseInt(limit),
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      },
    });
  } catch (error) {
    console.error("Error getting user transactions:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

const updateTransaction = async (req, res) => {
  const { id } = req.params;
  const { start, end, duration, cost } = req.body;

  try {
    const transaction = await Transaction.findByPk(id);

    if (!transaction) {
      return res.status(404).json({
        message: "Transaction not found",
      });
    }

    await transaction.update({
      start,
      end,
      duration,
      cost,
    });

    return res.status(200).json({
      message: "Transaction updated successfully",
      data: transaction,
    });
  } catch (error) {
    console.error("Error updating transaction:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

const deleteTransaction = async (req, res) => {
  const { id } = req.params;

  try {
    const transaction = await Transaction.findByPk(id);

    if (!transaction) {
      return res.status(404).json({
        message: "Transaction not found",
      });
    }

    await transaction.destroy();

    return res.status(200).json({
      message: "Transaction deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting transaction:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Finish regular transaction (bayar di akhir)
const finishRegularTransaction = async (req, res) => {
  try {
    console.log(
      "Finishing regular transaction with request body:>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>",
      req.body
    );
    const { deviceId } = req.body;
    const userId = req.user.id;

    // Validasi input
    if (!deviceId) {
      return res.status(400).json({
        message: "Device ID wajib diisi",
      });
    }

    // Cari device
    const device = await Device.findByPk(deviceId, {
      include: [
        {
          model: Category,
        },
      ],
    });

    if (!device) {
      return res.status(404).json({
        message: "Device tidak ditemukan",
      });
    }

    // Cari transaksi aktif untuk device ini (khusus untuk user yang sama)
    const activeTransaction = await Transaction.findOne({
      where: {
        deviceId: deviceId,
        end: null,
        paymentType: "end", // Pastikan ini transaksi bayar di akhir
      },
      order: [["createdAt", "DESC"]],
    });

    if (!activeTransaction) {
      return res.status(404).json({
        message:
          "Tidak ada transaksi bayar di akhir yang aktif untuk device ini dan user ini",
      });
    }

    const endTime = new Date();

    // Gunakan start time dari transaksi (sekarang sudah DATETIME)
    const startTime = new Date(activeTransaction.start);

    // Hitung durasi dalam detik
    const duration = Math.floor((endTime - startTime) / 1000);

    console.log("Duration calculation:", {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationSeconds: duration,
    });

    // Hitung cost berdasarkan durasi
    const costPerMinute = device.Category ? device.Category.cost : 0;
    const periodMinutes = device.Category ? device.Category.periode : 60;
    const totalMinutes = Math.ceil(duration / 60); // Round up ke menit terdekat
    const periods = Math.ceil(totalMinutes / periodMinutes);
    const durationCost = periods * costPerMinute; // Biaya rental saja

    // Dapatkan produk dalam transaksi SEBELUM update
    const transactionProducts = await TransactionProduct.findAll({
      where: {
        transactionId: activeTransaction.id
      },
      include: [{
        model: Product,
        as: 'product'
      }]
    });

    // Hitung total produk
    const productsTotal = transactionProducts.reduce((sum, tp) => sum + tp.subtotal, 0);

    // Total cost = durasi + produk
    const totalCost = durationCost + productsTotal;

    // Gunakan Date object langsung untuk kolom DATETIME

    // Update transaksi
    console.log("Updating transaction with:", {
      transactionId: activeTransaction.id,
      endTime: endTime,
      duration: duration,
      durationCost: durationCost,
      productsTotal: productsTotal,
      totalCost: totalCost,
      status: "completed",
    });

    const updatedTransaction = await activeTransaction.update({
      end: endTime, // DATETIME object
      duration: duration,
      cost: totalCost, // Total biaya (rental + produk)
      status: "completed",
    });

    console.log("Transaction updated successfully:", {
      id: updatedTransaction.id,
      end: updatedTransaction.end,
      duration: updatedTransaction.duration,
      cost: updatedTransaction.cost,
      status: updatedTransaction.status,
    });

    // Send command ke ESP32 untuk stop
    await sendCommand({
      deviceId,
      command: "end",
    });

    // Update device status
    await device.update({
      timerStatus: "stop",
      timerStart: null,
      timerDuration: null,
      timerElapsed: 0,
      lastPausedAt: null,
    });

    // Log aktivitas transaksi
    await logTransactionEnd(activeTransaction.id, {
      duration,
      cost: totalCost,
      endReason: "user_finish",
    });

    // Buat payment record untuk shift aktif (bayar di akhir)
    const activeShift = await getAnyActiveShift();
    if (activeShift) {
      // Payment untuk rental
      await createPaymentRecord({
        shiftId: activeShift.id,
        userId: userId,
        transactionId: updatedTransaction.id,
        amount: durationCost, // Hanya biaya rental
        type: 'RENTAL',
        paymentMethod: req.body.paymentMethod || 'CASH',
        note: `Bayar di akhir - Device: ${device.name}`
      });

      // Payment untuk produk (jika ada)
      if (productsTotal > 0) {
        await createPaymentRecord({
          shiftId: activeShift.id,
          userId: userId,
          transactionId: updatedTransaction.id,
          amount: productsTotal,
          type: 'FNB',
          paymentMethod: req.body.paymentMethod || 'CASH',
          note: `Produk F&B - ${transactionProducts.length} item`
        });
      }
    }

    // Notify mobile clients
    notifyMobileClients("device_status_changed", {
      deviceId: deviceId,
      status: "off",
      transaction: {
        id: activeTransaction.id,
        duration,
        cost: totalCost,
        endTime: endTime.toISOString(),
      },
    });

    return res.status(200).json({
      message: "Transaksi berhasil diselesaikan",
      data: {
        transaction: {
          id: updatedTransaction.id,
          deviceId,
          start: updatedTransaction.start,
          end: updatedTransaction.end,
          duration: updatedTransaction.duration,
          cost: updatedTransaction.cost,
          durationCost: durationCost,
          productsTotal: productsTotal,
          grandTotal: totalCost, // Sama dengan cost
          paymentType: "end",
        },
        receipt: {
          transactionId: updatedTransaction.id,
          deviceName: device.name,
          category: device.Category?.categoryName || "Unknown",
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          duration: `${Math.floor(duration / 3600)}j ${Math.floor(
            (duration % 3600) / 60
          )}m ${duration % 60}d`,
          rentalCost: durationCost,
          products: transactionProducts,
          productsTotal: productsTotal,
          grandTotal: totalCost
        },
      },
    });
  } catch (error) {
    console.error("Error finishing regular transaction:", error);
    return res.status(500).json({
      message: "Terjadi kesalahan saat menyelesaikan transaksi",
      error: error.message,
    });
  }
};

// Fungsi untuk menambah waktu pada transaksi yang sedang aktif

// Helper: Get local date string (YYYY-MM-DD) from Date object
// Uses server's local timezone (e.g., Asia/Jakarta)
const getLocalDateString = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Mendapatkan summary transaksi per tanggal (langsung dari tabel Transaction)
const getTransactionSummaryByDate = async (req, res) => {
  try {
    const { page = 1, limit = 10, start_date, end_date } = req.query;

    // Build where clause
    const whereClause = {
      status: 'completed' // Hanya transaksi yang selesai
    };

    if (start_date && end_date) {
      // Create local date boundaries using server's local timezone
      // Parse YYYY-MM-DD and create Date object in local timezone
      const [startYear, startMonth, startDay] = start_date.split('-').map(Number);
      const [endYear, endMonth, endDay] = end_date.split('-').map(Number);
      
      const startOfDay = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
      const endOfDay = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999);
      
      whereClause.start = {
        [Op.between]: [startOfDay, endOfDay]
      };
    } else if (start_date) {
      const [year, month, day] = start_date.split('-').map(Number);
      const startOfDay = new Date(year, month - 1, day, 0, 0, 0, 0);
      whereClause.start = {
        [Op.gte]: startOfDay
      };
    } else if (end_date) {
      const [year, month, day] = end_date.split('-').map(Number);
      const endOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);
      whereClause.start = {
        [Op.lte]: endOfDay
      };
    }

    // Get all transactions with products
    const transactions = await Transaction.findAll({
      where: whereClause,
      include: [
        {
          model: Device,
          include: [{ model: Category }]
        },
        {
          model: TransactionProduct,
          as: 'transactionProducts',
          include: [{
            model: Product,
            as: 'product'
          }],
          required: false
        }
      ],
      order: [['start', 'DESC']]
    });

    // Group by LOCAL date and calculate summary
    const dateMap = new Map();

    transactions.forEach(transaction => {
      const txData = transaction.toJSON();
      // Use LOCAL date of the transaction (server timezone)
      const dateKey = getLocalDateString(txData.start);

      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, {
          date: dateKey,
          pendapatanDevice: 0,
          pendapatanCafe: 0,
          totalPendapatan: 0,
          transactionCount: 0
        });
      }

      const dateSummary = dateMap.get(dateKey);
      dateSummary.transactionCount += 1;

      // Calculate rental cost (device)
      // If transaction has products, rental cost = total cost - products total
      const productsTotal = txData.transactionProducts 
        ? txData.transactionProducts.reduce((sum, tp) => sum + (tp.subtotal || 0), 0)
        : 0;
      
      const rentalCost = (txData.cost || 0) - productsTotal;

      dateSummary.pendapatanDevice += rentalCost > 0 ? rentalCost : 0;
      dateSummary.pendapatanCafe += productsTotal;
      dateSummary.totalPendapatan += txData.cost || 0;
    });

    // Convert map to array and sort by date descending
    const allDates = Array.from(dateMap.values()).sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    // Apply pagination
    const totalItems = allDates.length;
    const totalPages = Math.ceil(totalItems / limit);
    const offset = (page - 1) * parseInt(limit);
    const paginatedDates = allDates.slice(offset, offset + parseInt(limit));

    return res.status(200).json({
      message: 'Success',
      data: {
        summaries: paginatedDates,
        pagination: {
          totalItems,
          totalPages,
          currentPage: parseInt(page),
          itemsPerPage: parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Error getting transaction summary by date:', error);
    return res.status(500).json({
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Mendapatkan transaksi berdasarkan tanggal tertentu (menggunakan waktu lokal)
const getTransactionsByDate = async (req, res) => {
  try {
    const { date, page = 1, limit = 10 } = req.query;

    if (!date) {
      return res.status(400).json({
        message: 'Parameter date wajib diisi (format: YYYY-MM-DD)'
      });
    }

    // Parse date - create local date boundaries using server's local timezone
    // The date parameter is in YYYY-MM-DD format (local date)
    const [year, month, day] = date.split('-').map(Number);
    const startOfDay = new Date(year, month - 1, day, 0, 0, 0, 0);
    const endOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);

    const whereClause = {
      status: 'completed',
      start: {
        [Op.between]: [startOfDay, endOfDay]
      }
    };

    const offset = (page - 1) * parseInt(limit);

    const { count, rows: transactions } = await Transaction.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: Device,
          include: [{ model: Category }]
        },
        {
          model: Member,
          as: 'member',
          attributes: ['id', 'username', 'email', 'deposit'],
          required: false
        },
        {
          model: TransactionProduct,
          as: 'transactionProducts',
          include: [{
            model: Product,
            as: 'product'
          }],
          required: false
        }
      ],
      order: [['start', 'DESC']],
      limit: parseInt(limit),
      offset: offset
    });

    // Calculate summary for this date (from ALL transactions, not just paginated)
    // We need to get total count for summary
    const allTransactionsForDate = await Transaction.findAll({
      where: whereClause,
      include: [
        {
          model: TransactionProduct,
          as: 'transactionProducts',
          include: [{
            model: Product,
            as: 'product'
          }],
          required: false
        }
      ]
    });

    let totalDevice = 0;
    let totalCafe = 0;
    let totalAll = 0;

    allTransactionsForDate.forEach(tx => {
      const txData = tx.toJSON();
      
      const productsTotal = txData.transactionProducts 
        ? txData.transactionProducts.reduce((sum, tp) => sum + (tp.subtotal || 0), 0)
        : 0;
      
      const rentalCost = (txData.cost || 0) - productsTotal;

      totalDevice += rentalCost > 0 ? rentalCost : 0;
      totalCafe += productsTotal;
      totalAll += txData.cost || 0;
    });

    // Map paginated transactions with rental/products breakdown
    const transactionsWithDetails = transactions.map(tx => {
      const txData = tx.toJSON();
      
      const productsTotal = txData.transactionProducts 
        ? txData.transactionProducts.reduce((sum, tp) => sum + (tp.subtotal || 0), 0)
        : 0;
      
      const rentalCost = (txData.cost || 0) - productsTotal;

      return {
        ...txData,
        rentalCost: rentalCost > 0 ? rentalCost : 0,
        productsTotal
      };
    });

    const totalPages = Math.ceil(count / parseInt(limit));

    return res.status(200).json({
      message: 'Success',
      data: {
        date: date,
        summary: {
          pendapatanDevice: totalDevice,
          pendapatanCafe: totalCafe,
          totalPendapatan: totalAll,
          transactionCount: count
        },
        transactions: transactionsWithDetails,
        pagination: {
          totalItems: count,
          totalPages,
          currentPage: parseInt(page),
          itemsPerPage: parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Error getting transactions by date:', error);
    return res.status(500).json({
      message: 'Internal server error',
      error: error.message
    });
  }
};
/**
 * Log BLE disconnect event
 * POST /api/transactions/:transactionId/log-disconnect
 */
const logBleDisconnectEvent = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { disconnectReason, disconnectSource, deviceId } = req.body;

    console.log('📡 BLE DISCONNECT LOG:', { transactionId, disconnectReason, disconnectSource, deviceId });

    // Validasi input
    if (!disconnectReason || !disconnectSource || !deviceId) {
      return res.status(400).json({
        message: 'Missing required fields: disconnectReason, disconnectSource, deviceId'
      });
    }

    // Validasi transaksi exists
    const transaction = await Transaction.findByPk(transactionId);
    if (!transaction) {
      return res.status(404).json({
        message: 'Transaction not found'
      });
    }

    // Log disconnect activity
    const activity = await logBleDisconnect(
      transactionId,
      disconnectReason,
      disconnectSource,
      deviceId
    );

    console.log('✅ BLE disconnect logged:', activity.id);

    return res.status(201).json({
      message: 'BLE disconnect logged successfully',
      data: activity
    });

  } catch (error) {
    console.error('❌ Error logging BLE disconnect:', error);
    return res.status(500).json({
      message: 'Error logging BLE disconnect',
      error: error.message
    });
  }
};

module.exports = {
  createTransaction,
  createRegularTransaction,
  finishRegularTransaction,
  getAllTransactions,
  getTransactionById,
  getTransactionsByUserId,
  updateTransaction,
  deleteTransaction,
  getTransactionSummaryByDate,
  getTransactionsByDate,
  logBleDisconnectEvent,
  // addTime
};

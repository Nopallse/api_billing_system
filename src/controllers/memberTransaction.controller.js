// memberTransactionController.js
// WebSocket DISABLED - Backend hanya simpan status; kontrol relay via BLE langsung dari mobile app
const { Transaction, Device, Category, Member } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');
const { 
    logTransactionStart, 
    logTransactionStop, 
    logTransactionResume, 
    logAddTime, 
    logTransactionEnd,
    getTransactionActivities,
    getTransactionSummary 
} = require('../utils/transactionActivityLogger');

// Membuat transaksi untuk member dengan validasi PIN
const createMemberTransaction = async (req, res) => {
    try {
        const { deviceId, start, duration, memberId, pin } = req.body;
        
        console.log('Creating member transaction with data:', { deviceId, start, duration, memberId, pin: pin ? '***' : null });
        // Validasi input
        if (!deviceId || !duration || !start || !memberId || !pin) {
            return res.status(400).json({
                message: 'deviceId, start, duration, memberId, dan pin wajib diisi'
            });
        }

        // Cek apakah member ada di database
        const member = await Member.findByPk(memberId);
        if (!member) {
            return res.status(404).json({
                message: 'Member tidak ditemukan'
            });
        }

        // Validasi PIN member
        const isPinValid = await bcrypt.compare(pin, member.pin);
        if (!isPinValid) {
            return res.status(401).json({
                message: 'PIN tidak valid'
            });
        }

        // Cek apakah device terdaftar di database
        const device = await Device.findByPk(deviceId);
        if (!device) {
            return res.status(404).json({
                message: 'Device tidak ditemukan di database'
            });
        }

        // Cek apakah ada transaksi aktif di database untuk device ini
        const existingTransaction = await Transaction.findOne({
            where: {
                deviceId: deviceId,
                end: null
            }
        });

        if (existingTransaction) {
            return res.status(400).json({
                message: 'Device masih memiliki transaksi aktif. Harap akhiri atau selesaikan transaksi sebelumnya.'
            });
        }

        // Hitung cost berdasarkan kategori
        // NOTE: duration yang diterima dari frontend adalah dalam SATUAN DETIK
        const category = await Category.findByPk(device.categoryId);
        if (!category) {
            return res.status(400).json({
                message: 'Kategori device tidak ditemukan'
            });
        }

        const durationSeconds = Number(duration);
        if (isNaN(durationSeconds) || durationSeconds <= 0) {
            return res.status(400).json({
                message: 'Duration harus berupa angka detik yang valid (> 0)'
            });
        }

        // Gunakan util perhitungan biaya yang konsisten
        const { calculateCost } = require('../utils/cost');
        const cost = calculateCost(durationSeconds, category);
        if (cost <= 0) {
            return res.status(400).json({
                message: 'Perhitungan biaya menghasilkan nilai tidak valid',
                data: { durationSeconds, periodeMenit: category.periode, costPerPeriode: category.cost }
            });
        }

        // Simpan deposit sebelum perubahan agar bisa ditampilkan & rollback bila gagal
        const previousDeposit = Number(member.deposit);

        // Cek apakah deposit member mencukupi
        if (previousDeposit < cost) {
            return res.status(400).json({
                message: 'Deposit tidak mencukupi',
                data: {
                    currentDeposit: previousDeposit,
                    requiredCost: cost,
                    shortfall: cost - previousDeposit
                }
            });
        }

        const transactionId = uuidv4();
     
        // Update device timer
        await device.update({
            timerStart: start,
            timerDuration: duration,
            timerStatus: 'start'
        });

        // Buat transaksi dengan memberId
        // Hitung deposit baru
        const newDeposit = previousDeposit - cost;
        
        // Gunakan Date object langsung untuk kolom DATETIME
        const startDateTime = new Date(start);
        
        const transaction = await Transaction.create({
            id: transactionId,
            memberId: memberId,
            deviceId,
            start: startDateTime, // DATETIME object
            end: null, // Transaksi aktif tidak boleh memiliki end timestamp
            duration,
            cost: cost,
            isMemberTransaction: true
        });

        // Log aktivitas start transaksi
        await logTransactionStart(transactionId, deviceId, duration, cost, true, {
            memberId: member.id,
            username: member.username,
            email: member.email,
            previousDeposit,
            newDeposit
        });

        // Kurangi deposit member (pastikan tetap integer >= 0)
        await member.update({ deposit: newDeposit });

        // Tidak ada pengiriman command via WebSocket - relay dikontrol via BLE oleh mobile app
        console.log(`✅ Transaction ${transaction.id} created for device ${deviceId}`);
      
        return res.status(201).json({
            message: 'Transaksi member berhasil dibuat',
            data: {
                transaction,
                member: {
                    id: member.id,
                    username: member.username,
                    email: member.email,
                    previousDeposit,
                    newDeposit,
                    deductedAmount: cost
                }
            }
        });
        
    } catch (error) {
        console.error('Error creating member transaction:', error);
        return res.status(500).json({
            message: 'Terjadi kesalahan saat membuat transaksi member',
            error: error.message
        });
    }
};

// Mendapatkan semua transaksi member
const getAllMemberTransactions = async (req, res) => {
    try {
        const { 
            start_date, 
            end_date, 
            page = 1, 
            limit = 10,
            memberId 
        } = req.query;

        // Validasi format tanggal
        const startDate = start_date ? new Date(start_date) : null;
        const endDate = end_date ? new Date(end_date) : null;

        if (start_date && isNaN(startDate.getTime())) {
            return res.status(400).json({
                message: 'Format tanggal mulai tidak valid (gunakan format: YYYY-MM-DD)'
            });
        }

        if (end_date && isNaN(endDate.getTime())) {
            return res.status(400).json({
                message: 'Format tanggal selesai tidak valid (gunakan format: YYYY-MM-DD)'
            });
        }

        // Konfigurasi where clause
        const whereClause = {};
        
        // Filter berdasarkan memberId jika ada
        if (memberId) {
            whereClause.memberId = memberId;
        }

        if (startDate && endDate) {
            // Jika tanggal sama, set waktu end_date ke akhir hari
            if (startDate.toDateString() === endDate.toDateString()) {
                const endOfDay = new Date(endDate);
                endOfDay.setHours(23, 59, 59, 999);
                whereClause.createdAt = {
                    [Op.between]: [startDate, endOfDay]
                };
            } else {
                whereClause.createdAt = {
                    [Op.between]: [startDate, endDate]
                };
            }
        } else if (startDate) {
            whereClause.createdAt = {
                [Op.gte]: startDate
            };
        } else if (endDate) {
            whereClause.createdAt = {
                [Op.lte]: endDate
            };
        }

        // Hitung offset untuk pagination
        const offset = (page - 1) * limit;

        // Query dengan pagination dan filter
        const { count, rows: transactions } = await Transaction.findAndCountAll({
            where: whereClause,
            order: [['createdAt', 'DESC']],
            include: [
                {
                    model: Device,
                    include: [{
                        model: Category
                    }]
                },
                {
                    model: Member,
                    as: 'member',
                    attributes: ['id', 'username', 'email', 'deposit']
                }
            ],
            limit: parseInt(limit),
            offset: offset
        });

        // Hitung total halaman
        const totalPages = Math.ceil(count / limit);
        
        return res.status(200).json({
            message: 'Success',
            data: {
                transactions,
                pagination: {
                    totalItems: count,
                    totalPages,
                    currentPage: parseInt(page),
                    itemsPerPage: parseInt(limit),
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1
                }
            }
        });
    } catch (error) {
        console.error('Error getting member transactions:', error);
        return res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Mendapatkan transaksi member berdasarkan ID
const getMemberTransactionById = async (req, res) => {
    const { id } = req.params;
    
    try {
        const transaction = await Transaction.findByPk(id, {
            include: [
                {
                    model: Device,
                    include: [{
                        model: Category
                    }]
                },
                {
                    model: Member,
                    as: 'member',
                    attributes: ['id', 'username', 'email', 'deposit']
                }
            ]
        });
        
        if (!transaction) {
            return res.status(404).json({
                message: 'Transaction not found'
            });
        }

        // Dapatkan aktivitas dan ringkasan transaksi
        const activities = await getTransactionActivities(id);
        const summary = await getTransactionSummary(id);
        
        return res.status(200).json({
            message: 'Success',
            data: {
                ...transaction.toJSON(),
                activities,
                activitySummary: summary
            }
        });
    } catch (error) {
        console.error('Error getting member transaction:', error);
        return res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Mendapatkan transaksi berdasarkan memberId
const getMemberTransactionsByMemberId = async (req, res) => {
    const { memberId } = req.params;
    const { 
        start_date, 
        end_date, 
        page = 1, 
        limit = 10 
    } = req.query;
    
    try {
        // Validasi format tanggal
        const startDate = start_date ? new Date(start_date) : null;
        const endDate = end_date ? new Date(end_date) : null;

        if (start_date && isNaN(startDate.getTime())) {
            return res.status(400).json({
                message: 'Format tanggal mulai tidak valid (gunakan format: YYYY-MM-DD)'
            });
        }

        if (end_date && isNaN(endDate.getTime())) {
            return res.status(400).json({
                message: 'Format tanggal selesai tidak valid (gunakan format: YYYY-MM-DD)'
            });
        }

        // Konfigurasi where clause
        const whereClause = { memberId };
        if (startDate && endDate) {
            whereClause.createdAt = {
                [Op.between]: [startDate, endDate]
            };
        } else if (startDate) {
            whereClause.createdAt = {
                [Op.gte]: startDate
            };
        } else if (endDate) {
            whereClause.createdAt = {
                [Op.lte]: endDate
            };
        }

        // Hitung offset untuk pagination
        const offset = (page - 1) * limit;

        const { count, rows: transactions } = await Transaction.findAndCountAll({
            where: whereClause,
            order: [['createdAt', 'DESC']],
            include: [
                {
                    model: Device,
                    include: [{
                        model: Category
                    }]
                },
                {
                    model: Member,
                    as: 'member',
                    attributes: ['id', 'username', 'email', 'deposit']
                }
            ],
            limit: parseInt(limit),
            offset: offset
        });

        // Hitung total halaman
        const totalPages = Math.ceil(count / limit);
        
        return res.status(200).json({
            message: 'Success',
            data: {
                transactions,
                pagination: {
                    totalItems: count,
                    totalPages,
                    currentPage: parseInt(page),
                    itemsPerPage: parseInt(limit),
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1
                }
            }
        });
    } catch (error) {
        console.error('Error getting member transactions by member ID:', error);
        return res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Update transaksi member
const updateMemberTransaction = async (req, res) => {
    const { id } = req.params;
    const { start, end, duration, cost } = req.body;
    
    try {
        const transaction = await Transaction.findByPk(id);
        
        if (!transaction) {
            return res.status(404).json({
                message: 'Transaction not found'
            });
        }
        
        await transaction.update({
            start,
            end,
            duration,
            cost
        });
        
        return res.status(200).json({
            message: 'Transaction updated successfully',
            data: transaction
        });
    } catch (error) {
        console.error('Error updating member transaction:', error);
        return res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Delete transaksi member
const deleteMemberTransaction = async (req, res) => {
    const { id } = req.params;
    
    try {
        const transaction = await Transaction.findByPk(id);
        
        if (!transaction) {
            return res.status(404).json({
                message: 'Transaction not found'
            });
        }
        
        await transaction.destroy();
        
        return res.status(200).json({
            message: 'Transaction deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting member transaction:', error);
        return res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Menambah waktu pada transaksi member yang sedang aktif
const addTimeToMemberTransaction = async (req, res) => {
    try {
        const { transactionId, additionalDuration, paymentMethod = 'deposit', pin } = req.body;
        
        // Validasi input
        if (!transactionId || !additionalDuration) {
            return res.status(400).json({
                message: 'transactionId dan additionalDuration wajib diisi'
            });
        }

        // Cek transaksi
        const transaction = await Transaction.findByPk(transactionId, {
            include: [
                {
                    model: Device,
                    include: [{ model: Category }]
                },
                {
                    model: Member,
                    as: 'member'
                }
            ]
        });

        if (!transaction) {
            return res.status(404).json({
                message: 'Transaksi tidak ditemukan'
            });
        }

        if (transaction.end !== null) {
            return res.status(400).json({
                message: 'Transaksi sudah selesai, tidak bisa menambah waktu'
            });
        }

        // Validasi PIN jika menggunakan deposit
        if (paymentMethod === 'deposit') {
            if (!pin) {
                return res.status(400).json({
                    message: 'PIN diperlukan untuk pembayaran menggunakan deposit'
                });
            }

            const isPinValid = await bcrypt.compare(pin, transaction.member.pin);
            if (!isPinValid) {
                return res.status(401).json({
                    message: 'PIN tidak valid'
                });
            }
        }

        // Hitung biaya tambahan
        const additionalDurationSeconds = Number(additionalDuration);
        if (isNaN(additionalDurationSeconds) || additionalDurationSeconds <= 0) {
            return res.status(400).json({
                message: 'Additional duration harus berupa angka detik yang valid (> 0)'
            });
        }

        const { calculateCost } = require('../utils/cost');
        const additionalCost = calculateCost(additionalDurationSeconds, transaction.Device.Category);

        let memberBalanceInfo = null;

        // Proses pembayaran
        if (paymentMethod === 'deposit') {
            const previousBalance = Number(transaction.member.deposit);
            
            if (previousBalance < additionalCost) {
                return res.status(400).json({
                    message: 'Deposit tidak mencukupi untuk menambah waktu',
                    data: {
                        currentDeposit: previousBalance,
                        requiredCost: additionalCost,
                        shortfall: additionalCost - previousBalance
                    }
                });
            }

            const newBalance = previousBalance - additionalCost;
            await transaction.member.update({ deposit: newBalance });

            memberBalanceInfo = {
                previousBalance,
                newBalance
            };
        }

        // Update durasi dan biaya transaksi
        const newTotalDuration = transaction.duration + additionalDurationSeconds;
        const newTotalCost = transaction.cost + additionalCost;

        await transaction.update({
            duration: newTotalDuration,
            cost: newTotalCost
        });

        // Update device timer di database saja; kontrol fisik dilakukan via BLE oleh client
        await transaction.Device.update({
            timerDuration: newTotalDuration
        });

        // Log aktivitas penambahan waktu
        await logAddTime(
            transactionId, 
            additionalDurationSeconds, 
            additionalCost, 
            paymentMethod, 
            memberBalanceInfo
        );

        return res.status(200).json({
            message: 'Waktu berhasil ditambahkan',
            data: {
                transactionId,
                additionalDuration: additionalDurationSeconds,
                additionalCost,
                paymentMethod,
                newTotalDuration,
                newTotalCost,
                memberBalance: memberBalanceInfo?.newBalance
            }
        });

    } catch (error) {
        console.error('Error adding time to member transaction:', error);
        return res.status(500).json({
            message: 'Terjadi kesalahan saat menambah waktu transaksi',
            error: error.message
        });
    }
};

// Stop transaksi member
const stopMemberTransaction = async (req, res) => {
    try {
        const { transactionId, reason = 'Manual stop by user' } = req.body;

        if (!transactionId) {
            return res.status(400).json({
                message: 'transactionId wajib diisi'
            });
        }

        const transaction = await Transaction.findByPk(transactionId, {
            include: [{ model: Device }]
        });

        if (!transaction) {
            return res.status(404).json({
                message: 'Transaksi tidak ditemukan'
            });
        }

        if (transaction.end !== null) {
            return res.status(400).json({
                message: 'Transaksi sudah selesai'
            });
        }

        // Update device status ke pause
        await transaction.Device.update({
            timerStatus: 'pause',
            lastPausedAt: new Date()
        });

        // Log aktivitas stop
        await logTransactionStop(transactionId, reason);

        return res.status(200).json({
            message: 'Transaksi berhasil dihentikan sementara',
            data: {
                transactionId,
                reason,
                status: 'paused'
            }
        });

    } catch (error) {
        console.error('Error stopping member transaction:', error);
        return res.status(500).json({
            message: 'Terjadi kesalahan saat menghentikan transaksi',
            error: error.message
        });
    }
};

// Resume transaksi member
const resumeMemberTransaction = async (req, res) => {
    try {
        const { transactionId, reason = 'Manual resume by user' } = req.body;

        if (!transactionId) {
            return res.status(400).json({
                message: 'transactionId wajib diisi'
            });
        }

        const transaction = await Transaction.findByPk(transactionId, {
            include: [{ model: Device }]
        });

        if (!transaction) {
            return res.status(404).json({
                message: 'Transaksi tidak ditemukan'
            });
        }

        if (transaction.end !== null) {
            return res.status(400).json({
                message: 'Transaksi sudah selesai'
            });
        }

        // Update device status ke active
        await transaction.Device.update({
            timerStatus: 'start',
            lastPausedAt: null
        });

        // Log aktivitas resume
        await logTransactionResume(transactionId, reason);

        return res.status(200).json({
            message: 'Transaksi berhasil dilanjutkan',
            data: {
                transactionId,
                reason,
                status: 'active'
            }
        });

    } catch (error) {
        console.error('Error resuming member transaction:', error);
        return res.status(500).json({
            message: 'Terjadi kesalahan saat melanjutkan transaksi',
            error: error.message
        });
    }
};

module.exports = {
    createMemberTransaction,
    getAllMemberTransactions,
    getMemberTransactionById,
    getMemberTransactionsByMemberId,
    updateMemberTransaction,
    deleteMemberTransaction,
    addTimeToMemberTransaction,
    stopMemberTransaction,
    resumeMemberTransaction
};


// memberTransactionController.js
const { Transaction, Device, Category, Member } = require('../models');
const { sendToESP32, getConnectionStatus, onDeviceDisconnect, notifyMobileClients, sendAddTime } = require('../wsClient');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');

// Register disconnect callback untuk semua device
const registerDisconnectHandlers = () => {
    onDeviceDisconnect('*', async (deviceId, reason) => {
        console.log(`Device ${deviceId} disconnected with reason: ${reason}`);
        
        try {
            // Cari device di database
            const device = await Device.findByPk(deviceId);
            if (!device) return;

            // Jika device sedang memiliki timer aktif, jangan ubah status transaksi
            // Biarkan transaksi tetap aktif agar bisa dilanjutkan
            if (device.timerStatus === 'start') {
                const now = new Date();
                const elapsedTime = Math.floor((now - device.timerStart) / 1000);
                
                // Jangan update timerStatus, biarkan tetap 'start'
                // Hanya update elapsed time dan lastPausedAt
                await device.update({
                    timerElapsed: elapsedTime,
                    lastPausedAt: now
                });

                // Cari transaksi aktif untuk device ini
                const activeTransaction = await Transaction.findOne({
                    where: {
                        deviceId: deviceId,
                        end: null // Transaksi belum selesai
                    },
                    order: [['createdAt', 'DESC']]
                });

                if (activeTransaction) {
                    // Jangan update transaksi, biarkan tetap aktif
                    // Hanya update status menjadi 'paused' jika ada field status
                    if (activeTransaction.status) {
                        await activeTransaction.update({
                            status: 'paused'
                        });
                    }

                    console.log(`Transaction ${activeTransaction.id} paused for device ${deviceId} due to disconnect`);
                }

                // Notify mobile clients
                notifyMobileClients({
                    type: 'timer_paused_disconnect',
                    deviceId: deviceId,
                    timestamp: now.toISOString(),
                    reason: reason,
                    elapsedTime: elapsedTime,
                    transactionId: activeTransaction?.id,
                    canResume: true
                });
            }
        } catch (error) {
            console.error(`Error handling disconnect for device ${deviceId}:`, error);
        }
    });
};

// Initialize disconnect handlers
registerDisconnectHandlers();

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

        // Cek apakah device terkoneksi ke WebSocket
        const connectedDevices = getConnectionStatus();
        console.log('Checking connection for device:', deviceId);
        console.log('Connected devices:', connectedDevices.devices);
        
        // Cek apakah device ada dalam daftar yang terkoneksi
        const isConnected = connectedDevices.devices.some(device => 
            device.deviceId === deviceId || device.deviceId === deviceId
        );
        
        if (!isConnected) {
            return res.status(400).json({
                message: 'Device tidak terkoneksi ke server WebSocket'
            });
        }

        // Cek apakah device sudah memiliki timer yang aktif atau di-pause
        const { isTimerActive, isTimerPaused } = require('../wsClient');
        
        if (isTimerActive(deviceId)) {
            return res.status(400).json({
                message: 'Device masih memiliki timer yang aktif. Harap tunggu timer selesai atau gunakan command stop terlebih dahulu.'
            });
        }
        
        if (isTimerPaused(deviceId)) {
            return res.status(400).json({
                message: 'Device memiliki timer yang di-pause. Gunakan command start untuk melanjutkan timer yang ada, atau command end untuk mengakhiri timer.'
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
        const transaction = await Transaction.create({
            id: transactionId,
            memberId: memberId,
            deviceId,
            start,
            end: null, // Transaksi aktif tidak boleh memiliki end timestamp
            duration,
            cost: cost,
            isMemberTransaction: true
        });

    // Kurangi deposit member (pastikan tetap integer >= 0)
    const newDeposit = previousDeposit - cost;
    await member.update({ deposit: newDeposit });

        // Kirim data ke ESP32
        const result = sendToESP32({
            deviceId,
            timer: Number(duration) // Pastikan timer adalah number
        });

        // Cek hasil pengiriman
        if (!result.success) {
            // Jika gagal mengirim, hapus transaksi dan rollback deposit
            await transaction.destroy();
            await member.update({ deposit: previousDeposit });
            console.error(`Failed to send command to device ${deviceId}:`, result.message);
            return res.status(500).json({
                message: `Gagal mengirim data ke device: ${result.message}`
            });
        }
        console.log(`✅ Transaction ${transaction.id} created and command sent to device ${deviceId}`);
      
        return res.status(201).json({
            message: 'Transaksi member berhasil dibuat',
            data: {
                transaction,
                deviceCommand: result.data,
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
        
        return res.status(200).json({
            message: 'Success',
            data: transaction
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

module.exports = {
    createMemberTransaction,
    getAllMemberTransactions,
    getMemberTransactionById,
    getMemberTransactionsByMemberId,
    updateMemberTransaction,
    deleteMemberTransaction
};


// transactionController.js
const { Transaction, Device, Category, Member } = require('../models');
const { sendToESP32, getConnectionStatus, onDeviceDisconnect, notifyMobileClients, sendAddTime } = require('../wsClient');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const { 
    logTransactionStart, 
    logTransactionEnd,
    getTransactionActivities,
    getTransactionSummary 
} = require('../utils/transactionActivityLogger');

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




const createTransaction = async (req, res) => {
    try {
        const {deviceId, start, duration} = req.body;
        
        // Validasi input
        if (!deviceId || !duration || !start) {
            return res.status(400).json({
                message: ' deviceId, start, dan duration wajib diisi'
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

        // Cek apakah device memiliki timer yang aktif di database
        // if (device.timerStatus === 'start') {
        //     return res.status(400).json({
        //         message: 'Device masih memiliki timer yang aktif di database. Harap tunggu timer selesai atau gunakan command end terlebih dahulu.'
        //     });
        // }

        // Hitung cost (duration dari frontend diasumsikan DETIK)
        const category = await Category.findByPk(device.categoryId);
        if (!category) {
            return res.status(400).json({ message: 'Kategori device tidak ditemukan' });
        }
        const { calculateCost } = require('../utils/cost');
        const durationSeconds = Number(duration);
        if (isNaN(durationSeconds) || durationSeconds <= 0) {
            return res.status(400).json({ message: 'Duration harus berupa angka detik yang valid (> 0)' });
        }
        const cost = calculateCost(durationSeconds, category);
        if (cost <= 0) {
            return res.status(400).json({
                message: 'Perhitungan biaya menghasilkan nilai tidak valid',
                data: { durationSeconds, periodeMenit: category.periode, costPerPeriode: category.cost }
            });
        }

        const transactionId = uuidv4();
     
        await device.update({
            timerStart: start,
            timerDuration: duration,
            timerStatus: 'start'
        });




        //
        // Buat transaksi - end harus null untuk transaksi yang sedang aktif
        const transaction = await Transaction.create({
            id: transactionId,
            userId: req.user.id,
            deviceId,
            start,
            end: null, // Transaksi aktif tidak boleh memiliki end timestamp
            duration,
            cost: cost,
            isMemberTransaction: false
        });

        // Log aktivitas start transaksi
        await logTransactionStart(transactionId, deviceId, duration, cost, false, {
            userId: req.user.id
        });

        // Kirim data ke ESP32
        const result = sendToESP32({
            deviceId,
            timer: Number(duration) // Pastikan timer adalah number
        });

        // Cek hasil pengiriman
        if (!result.success) {
            // Jika gagal mengirim, hapus transaksi
            await transaction.destroy();
            return res.status(500).json({
                message: `Gagal mengirim data ke device: ${result.message}`
            });
        }
      
        return res.status(201).json({
            message: 'Transaksi berhasil dibuat',
            data: {
                transaction,
                deviceCommand: result.data
            }
        });
        
    } catch (error) {
        console.error('Error creating transaction:', error);
        return res.status(500).json({
            message: 'Terjadi kesalahan saat membuat transaksi',
            error: error.message
        });
    }
};

const getAllTransactions = async (req, res) => {
    try {
        const { 
            start_date, 
            end_date, 
            page = 1, 
            limit = 10 
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
                    attributes: ['id', 'username', 'email', 'deposit'],
                    required: false
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
        console.error('Error getting transactions:', error);
        return res.status(500).json({
            message: 'Internal server error',
            error: error.message
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
                    include: [{
                        model: Category,
                    }]
                },
                {
                    model: Member,
                    as: 'member',
                    attributes: ['id', 'username', 'email', 'deposit'],
                    required: false
                }
            ],
        });
        
        if (!transaction) {
            return res.status(404).json({
                message: 'Transaction not found'
            });
        }

        // Format data untuk response
        const transactionData = transaction.toJSON();
        
        // Hitung informasi receipt
        let receiptInfo = null;
        if (transactionData.Device && transactionData.Device.Category) {
            const category = transactionData.Device.Category;
            const durationSeconds = transactionData.duration;
            const durationMinutes = Math.ceil(durationSeconds / 60);
            
            // Parse start time untuk mendapatkan tanggal dan waktu mulai
            let startDateTime = null;
            let endDateTime = null;
            
            if (transactionData.createdAt) {
                startDateTime = new Date(transactionData.createdAt);
                
                // Hitung end time berdasarkan start + duration
                if (transactionData.end) {
                    // Jika ada end time, gunakan created date dengan end time
                    const endTimeParts = transactionData.end.split(':');
                    endDateTime = new Date(startDateTime);
                    endDateTime.setHours(parseInt(endTimeParts[0]), parseInt(endTimeParts[1]), parseInt(endTimeParts[2] || 0));
                } else {
                    // Jika tidak ada end time, hitung dari start + duration
                    endDateTime = new Date(startDateTime.getTime() + (durationSeconds * 1000));
                }
            }

            receiptInfo = {
                deviceName: transactionData.Device.name,
                categoryName: category.categoryName,
                startTime: startDateTime?.toISOString(),
                endTime: endDateTime?.toISOString(),
                durationSeconds: durationSeconds,
                durationMinutes: durationMinutes,
                costPerPeriod: category.cost,
                periodMinutes: category.periode,
                totalCost: transactionData.cost,
                isMemberTransaction: transactionData.isMemberTransaction || false,
                member: transactionData.member || null,
                transactionStatus: transactionData.end ? 'completed' : 'active'
            };
        }

        // Dapatkan aktivitas dan ringkasan transaksi
        const activities = await getTransactionActivities(id);
        const activitySummary = await getTransactionSummary(id);
        
        return res.status(200).json({
            message: 'Success',
            data: {
                ...transactionData,
                receipt: receiptInfo,
                activities,
                activitySummary
            }
        });
    } catch (error) {
        console.error('Error getting transaction:', error);
        return res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
};

const getTransactionsByUserId = async (req, res) => {
    const { userId } = req.params;
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
        const whereClause = { userId };
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
        console.error('Error getting user transactions:', error);
        return res.status(500).json({
            message: 'Internal server error',
            error: error.message
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
        console.error('Error updating transaction:', error);
        return res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
};

const deleteTransaction = async (req, res) => {
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
        console.error('Error deleting transaction:', error);
        return res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Fungsi untuk menambah waktu pada transaksi yang sedang aktif


module.exports = {
    createTransaction,
    getAllTransactions,
    getTransactionById,
    getTransactionsByUserId,
    updateTransaction,
    deleteTransaction,
    // addTime
};
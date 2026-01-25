const{ Device, User, Category, Transaction, Member, TransactionProduct, Product } = require('../models');
const { v4: uuidv4 } = require('uuid');
// WebSocket DISABLED - Relay control via BLE
// Stub functions untuk backward compatibility
const getConnectionStatus = () => ({ devices: [], totalDevices: 0 });
const isTimerActive = () => false;
const sendCommand = () => ({ success: true, message: 'Relay via BLE' });
const sendAddTime = () => ({ success: true, message: 'Relay via BLE' });
const notifyMobileClients = () => {}; // No-op
const { 
    logAddTime, 
    logTransactionStop, 
    logTransactionResume, 
    logTransactionEnd,
    syncOfflineActivities,
    getTransactionActivities
} = require('../utils/transactionActivityLogger');
const { getAnyActiveShift, createPaymentRecord } = require('./shift.controller');

// Import helpers from transaction controller for usage calculation
const { 
    parseLocalDateTime, 
    computeUsageSecondsFromActivities 
} = require('./transaction.controller.helpers');

// Grace period sebelum auto-finish (untuk handle offline scenario)
// Nilai dalam detik - beri waktu untuk client reconnect dan sync
const AUTO_FINISH_GRACE_PERIOD = 300; // 5 menit grace period

// Fungsi untuk mengecek dan mengakhiri transaksi yang expired
const checkAndEndExpiredTransactions = async () => {
    try {
        const now = new Date();
        
        // Cari semua device dengan timer aktif
        const activeDevices = await Device.findAll({
            where: {
                timerStatus: 'start',
                timerStart: { [require('sequelize').Op.not]: null },
                timerDuration: { [require('sequelize').Op.not]: null }
            },
            include: [{
                model: Transaction,
                where: { end: null },
                required: false
            }]
        });

        for (const device of activeDevices) {
            const startTime = new Date(device.timerStart);
            const elapsedSeconds = Math.floor((now - startTime) / 1000);
            
            // PENTING: Tambah grace period untuk handle offline scenario
            // Client mungkin sudah add time tapi belum sync ke server
            const expiredWithGrace = elapsedSeconds >= (device.timerDuration + AUTO_FINISH_GRACE_PERIOD);
            
            if (expiredWithGrace) {
                console.log(`⏰ Timer expired (with grace period) for device ${device.id}, ending transaction...`);
                console.log(`   → Elapsed: ${elapsedSeconds}s, Duration: ${device.timerDuration}s, Grace: ${AUTO_FINISH_GRACE_PERIOD}s`);
                
                // End active transaction if exists
                const activeTransaction = device.Transactions && device.Transactions[0];
                if (activeTransaction) {
                    let refundInfo = null;
                    
                    // Jika ini adalah member transaction, tidak perlu refund karena waktu sudah habis
                    // Tapi kita tetap perlu update member info untuk logging
                    if (activeTransaction.isMemberTransaction && activeTransaction.memberId) {
                        const member = await Member.findByPk(activeTransaction.memberId);
                        if (member) {
                            refundInfo = {
                                memberId: member.id,
                                memberName: member.username,
                                originalDuration: activeTransaction.duration,
                                usedTime: device.timerDuration, // Full time used
                                remainingTime: 0, // No remaining time
                                refundAmount: 0, // No refund for expired timer
                                message: 'Timer expired - no refund'
                            };
                            console.log(`⏰ Member ${member.username} used full time - no refund needed`);
                        }
                    }
                    
                    const endTime = new Date(startTime.getTime() + (device.timerDuration * 1000));
                    await activeTransaction.update({
                        end: endTime, // Gunakan Date object langsung, bukan toTimeString()
                        duration: device.timerDuration, // Pastikan duration sesuai waktu yang digunakan
                        status: 'completed' // Mark as completed
                    });
                    
                    console.log(`✅ Transaction ${activeTransaction.id} ended automatically (status: completed)`);
                    
                    // Notify mobile clients
                    notifyMobileClients({
                        type: 'transaction_auto_ended',
                        transactionId: activeTransaction.id,
                        deviceId: device.id,
                        reason: 'timer_expired',
                        refundInfo: refundInfo,
                        timestamp: now.toISOString()
                    });
                }
                
                // Update device status
                await device.update({
                    timerStatus: 'end',
                    timerElapsed: device.timerDuration
                });
                
                // Send off command to device if connected
                try {
                    await sendCommand({
                        deviceId: device.id,
                        command: 'off'
                    });
                    console.log(`📱 Sent OFF command to device ${device.id}`);
                } catch (error) {
                    console.log(`⚠️ Could not send OFF command to device ${device.id}:`, error.message);
                }
            }
        }
    } catch (error) {
        console.error('Error checking expired transactions:', error);
    }
};

// Jalankan pengecekan setiap 30 detik
setInterval(checkAndEndExpiredTransactions, 30000);

//create device
const createDevice = async (req, res) => {
    const {name, categoryId, id, relayNumber} = req.body;

    try{
        // Validasi input
        if (!id) {
            return res.status(400).json({
                message: 'Device ID harus diisi'
            });
        }

        if (!name || !categoryId) {
            return res.status(400).json({
                message: 'Name dan Category ID harus diisi'
            });
        }

        // Validasi relay number (1-4)
        const validRelayNumber = relayNumber && relayNumber >= 1 && relayNumber <= 4 ? relayNumber : null;

        // NOTE: Tidak perlu cek WebSocket lagi karena relay control sekarang via BLE
        // Device akan dikontrol langsung dari mobile app via BLE ke ESP32

        // Cek apakah device sudah terdaftar
        const existingDevice = await Device.findOne({
            where: {
                id: id
            },
            include: [{
                model: Category,
                as: 'Category'
            }]
        });

        if(existingDevice){
            return res.status(400).json({
                message: 'Device sudah terdaftar di database'
            });
        }

        // Buat device baru dengan relay number
        const device = await Device.create({
            id: id,
            name,
            categoryId,
            relayNumber: validRelayNumber
        });

        // Ambil data device dengan kategori
        const deviceWithCategory = await Device.findOne({
            where: { id: device.id },
            include: [{
                model: Category,
                // as: 'Category'
            }]
        });

        return res.status(201).json({
            message: 'Device berhasil didaftarkan',
            data: deviceWithCategory
        });
    } catch(error) {
        return res.status(500).json({
            message: error.message
        });
    }
}

const getAllDevices = async (req, res) => {
    try {
        // Ambil semua device dari database dengan transaksi aktif terbaru
        const devices = await Device.findAll({
            include: [
                {
                    model: Category,
                    as: 'Category'
                },
                {
                    model: Transaction,
                    where: { end: null }, // Hanya transaksi yang masih aktif
                    required: false,
                    include: [{
                        model: Member,
                        as: 'member',
                        attributes: ['id', 'username', 'email', 'deposit'],
                        required: false
                    }],
                    order: [['createdAt', 'DESC']], // Ambil transaksi terbaru
                    limit: 1 // Hanya ambil 1 transaksi terbaru
                }
            ]
        });

        // WebSocket disabled - getConnectionStatus returns empty
        const connectedStatus = getConnectionStatus();

        const now = new Date();

        // Map device data dengan status dari database saja
        const devicesWithStatus = await Promise.all(devices.map(async (device) => {
            const deviceData = device.toJSON();
            const activeTransaction = deviceData.Transactions && deviceData.Transactions[0];
            
            // Update timerElapsed jika timer sedang berjalan
            if (device.timerStart && device.timerStatus === 'start') {
                const startTime = new Date(device.timerStart);
                const elapsedSeconds = Math.floor((now - startTime) / 1000);
                
                // Update timerElapsed di database untuk real-time tracking
                await device.update({ timerElapsed: elapsedSeconds });
                deviceData.timerElapsed = elapsedSeconds;
            }
            
            // Tentukan apakah ini member transaction berdasarkan memberId atau flag
            const isMemberTransaction = activeTransaction ? 
                (activeTransaction.isMemberTransaction === true || activeTransaction.memberId !== null) : false;
            
            // Periksa apakah timer sudah expired
            let isTimerExpired = false;
            if (device.timerStart && device.timerDuration && device.timerStatus === 'start') {
                const startTime = new Date(device.timerStart);
                const elapsedSeconds = Math.floor((now - startTime) / 1000);
                isTimerExpired = elapsedSeconds >= device.timerDuration;
                
                console.log(`Device ${device.id}: elapsed=${elapsedSeconds}, duration=${device.timerDuration}, expired=${isTimerExpired}`);
            }
            
            // Jika timerStatus adalah 'end' atau timer expired, maka tidak ada transaksi aktif
            const hasActiveTransaction = activeTransaction && device.timerStatus !== 'end' && !isTimerExpired;
            
            // Tentukan status device berdasarkan database timer status
            let deviceStatus = 'off';
            if (device.timerStatus === 'start' && !isTimerExpired) {
                deviceStatus = 'running';
            } else if (device.timerStatus === 'stop') {
                deviceStatus = 'paused';
            }
            
            return {
                ...deviceData,
                isConnected: false, // Always false (WebSocket disabled)
                status: deviceStatus,
                activeTransaction: hasActiveTransaction ? {
                    id: activeTransaction.id,
                    start: activeTransaction.start,
                    duration: activeTransaction.duration,
                    cost: activeTransaction.cost,
                    isMemberTransaction: isMemberTransaction,
                    paymentType: activeTransaction.paymentType || 'upfront', // Add paymentType for unlimited mode detection
                    member: activeTransaction.member || null
                } : null
            };
        }));

        return res.status(200).json({
            message: 'Berhasil mendapatkan daftar device',
            data: devicesWithStatus
        });
    } catch (error) {
        console.error('Get all devices error:', error);
        return res.status(500).json({
            message: error.message
        });
    }
};

const getDeviceById = async (req, res) => {
    const { id } = req.params;
    try {
        const device = await Device.findOne({
            where: { id },
            include: [
                {
                    model: Category,
                    // as: 'category'
                },
                {
                    model: Transaction,
                    where: { end: null }, // Hanya transaksi yang masih aktif
                    required: false,
                    include: [{
                        model: Member,
                        as: 'member',
                        attributes: ['id', 'username', 'email', 'deposit'],
                        required: false
                    }],
                    order: [['createdAt', 'DESC']], // Ambil transaksi terbaru
                    limit: 1 // Hanya ambil 1 transaksi terbaru
                }
            ]
        });

        if (!device) {
            return res.status(404).json({
                message: 'Device tidak ditemukan'
            });
        }

        const now = new Date();

        // Update timerElapsed jika timer sedang berjalan
        if (device.timerStart && device.timerStatus === 'start') {
            const startTime = new Date(device.timerStart);
            const elapsedSeconds = Math.floor((now - startTime) / 1000);
            
            // Update timerElapsed di database untuk real-time tracking
            await device.update({ timerElapsed: elapsedSeconds });
        }

        // WebSocket disabled - no connection info
        const connectedStatus = getConnectionStatus();

        const deviceData = device.toJSON();
        const activeTransaction = deviceData.Transactions && deviceData.Transactions[0];
        
        // Tentukan apakah ini member transaction berdasarkan memberId atau flag
        const isMemberTransaction = activeTransaction ? 
            (activeTransaction.isMemberTransaction === true || activeTransaction.memberId !== null) : false;
        
        // Periksa apakah timer sudah expired
        let isTimerExpired = false;
        if (device.timerStart && device.timerDuration && device.timerStatus === 'start') {
            const startTime = new Date(device.timerStart);
            const elapsedSeconds = Math.floor((now - startTime) / 1000);
            isTimerExpired = elapsedSeconds >= device.timerDuration;
            
            console.log(`Device ${device.id} detail: elapsed=${elapsedSeconds}, duration=${device.timerDuration}, expired=${isTimerExpired}`);
        }
        
        // Jika timerStatus adalah 'end' atau timer expired, maka tidak ada transaksi aktif
        const hasActiveTransaction = activeTransaction && device.timerStatus !== 'end' && !isTimerExpired;
        
        // Tentukan status device berdasarkan timer status saja (tidak ada WebSocket)
        let deviceStatus = 'off';
        if (device.timerStatus === 'start' && !isTimerExpired) {
            deviceStatus = 'running';
        } else if (device.timerStatus === 'stop') {
            deviceStatus = 'paused';
        }
        
        const response = {
            ...deviceData,
            isConnected: false, // Always false (WebSocket disabled)
            status: deviceStatus,
            activeTransaction: hasActiveTransaction ? {
                id: activeTransaction.id,
                start: activeTransaction.start,
                duration: activeTransaction.duration,
                cost: activeTransaction.cost,
                isMemberTransaction: isMemberTransaction,
                paymentType: activeTransaction.paymentType || 'upfront', // Add paymentType for unlimited mode detection
                member: activeTransaction.member || null
            } : null
        };

        return res.status(200).json({
            message: 'Device ditemukan',
            data: response
        });
    } catch (error) {
        console.error('Get device by id error:', error);
        return res.status(500).json({
            message: error.message
        });
    }
};

const updateDevice = async (req, res) => {
    const {id} = req.params;
    const {name, categoryId} = req.body;
    try{
        const device = await Device.findOne({
            where: {
                id
            }
        })
        if(!device){
            return res.status(404).json({
                message: 'Device not found'
            })
        }
        device.name = name;
        device.categoryId = categoryId;
        await device.save();
    }catch(error){
        return res.status(500).json({
            message: error.message
        })
    }
}

const deleteDevice = async (req, res) => {
    const {id} = req.params;
    try{
        const device = await Device.findOne({
            where: {
                id
            }
        })
        if(!device){
            return res.status(404).json({
                message: 'Device not found'
            })
        }
        await device.destroy();
        return res.status(200).json({
            message: 'Device deleted'
        })
    }catch(error){
        return res.status(500).json({
            message: error.message
        })
    }
}

const sendDeviceCommand = async (req, res) => {
    const { id } = req.params;
    const { command, skipActivityLog = false } = req.body;

    try {
        // Validasi device exists di database
        const device = await Device.findOne({
            where: { id }
        });

        if (!device) {
            return res.status(404).json({
                message: 'Device tidak ditemukan'
            });
        }

        const now = new Date();
        let refundInfo = null; // Deklarasi variabel untuk menyimpan informasi refund
        let activeTransaction = null; // Deklarasi variabel untuk active transaction

        // Handle timer status berdasarkan command
        if (command === 'start') {
            // Validasi shift aktif - hanya jika bukan resume dari pause
            if (device.timerStatus !== 'stop' && !device.lastPausedAt) {
                const activeShift = await getAnyActiveShift();
                if (!activeShift) {
                    return res.status(400).json({
                        message: 'Tidak dapat memulai transaksi. Shift belum aktif. Silakan mulai shift terlebih dahulu.'
                    });
                }
            }
            
            // Cari transaksi aktif untuk logging
            const activeTransactionForResume = await Transaction.findOne({
                where: { 
                    deviceId: id, 
                    end: null 
                },
                order: [['createdAt', 'DESC']]
            });

            if (device.timerStatus === 'stop') {
                // RESUME dari pause - reset timerStart ke NOW, timerDuration sudah berisi sisa waktu
                await device.update({
                    timerStart: now, // Reset ke sekarang
                    timerStatus: 'start',
                    lastPausedAt: null,
                    timerElapsed: 0 // Reset elapsed karena mulai dari awal lagi
                });

                // Log aktivitas resume (skip jika dari offline sync)
                if (activeTransactionForResume && !skipActivityLog) {
                    await logTransactionResume(activeTransactionForResume.id, 'manual_resume');
                    console.log(`📝 Activity logged: resume for transaction ${activeTransactionForResume.id}`);
                } else if (skipActivityLog) {
                    console.log(`⏭️ Resume activity log skipped (offline sync will handle it)`);
                }
            } else if (device.timerStatus === 'start' && device.lastPausedAt) {
                // Jika timer sedang berjalan tapi di-pause (disconnect), resume timer
                await device.update({
                    timerStart: now, // Reset ke sekarang untuk sync
                    lastPausedAt: null
                });

                // Log aktivitas resume (dari disconnect) - skip jika dari offline sync
                if (activeTransactionForResume && !skipActivityLog) {
                    await logTransactionResume(activeTransactionForResume.id, 'resume_from_disconnect');
                    console.log(`📝 Activity logged: resume (from disconnect) for transaction ${activeTransactionForResume.id}`);
                } else if (skipActivityLog) {
                    console.log(`⏭️ Resume activity log skipped (offline sync will handle it)`);
                }
            } else {
                // Timer baru dimulai
                await device.update({
                    timerStart: now,
                    timerStatus: 'start',
                    timerElapsed: 0,
                    lastPausedAt: null
                });
                // Note: Untuk start baru, logging sudah dilakukan di endpoint startDevice/createTransaction
            }
        } else if (command === 'stop') {
            if (device.timerStatus === 'start') {
                // Cari transaksi aktif untuk cek payment type
                activeTransaction = await Transaction.findOne({
                    where: { 
                        deviceId: id, 
                        end: null 
                    },
                    order: [['createdAt', 'DESC']]
                });

                // Hitung elapsed time dan sisa waktu
                const elapsedTime = Math.floor((now - device.timerStart) / 1000);
                const remainingTime = Math.max(0, device.timerDuration - elapsedTime);
                
                // PENTING: Untuk unlimited mode (bayar di akhir), timerDuration harus tetap NULL
                // Untuk timed mode, simpan sisa waktu di timerDuration
                const isUnlimitedTransaction = activeTransaction && activeTransaction.paymentType === 'end';
                const newTimerDuration = isUnlimitedTransaction ? null : remainingTime;
                
                await device.update({
                    timerStatus: 'stop',
                    timerElapsed: elapsedTime,
                    timerDuration: newTimerDuration, // null untuk unlimited, sisa waktu untuk timed
                    lastPausedAt: now
                });

                // Log aktivitas stop (skip jika dari offline sync)
                if (activeTransaction && !skipActivityLog) {
                    await logTransactionStop(activeTransaction.id, 'manual_stop');
                    console.log(`📝 Activity logged: stop for transaction ${activeTransaction.id}`);
                } else if (skipActivityLog) {
                    console.log(`⏭️ Stop activity log skipped (offline sync will handle it)`);
                }
            }
        } else if (command === 'end') {
            // Cari transaksi aktif untuk device ini
            activeTransaction = await Transaction.findOne({
                where: { 
                    deviceId: id, 
                    end: null 
                },
                include: [{
                    model: Member,
                    as: 'member',
                    required: false
                }],
                order: [['createdAt', 'DESC']]
            });
            
            // PENTING: Hitung real usage dari activities DULU sebelum refund calculation
            let realUsedTime = 0;
            if (activeTransaction) {
                const activities = await getTransactionActivities(activeTransaction.id);
                realUsedTime = computeUsageSecondsFromActivities(
                    activities,
                    activeTransaction.start,
                    now
                );
                console.log(`📊 Real usage from activities: ${realUsedTime}s`);
            }
            
            // Jika ada transaksi aktif dan ini adalah member transaction
            if (activeTransaction && activeTransaction.isMemberTransaction && activeTransaction.member) {
                const member = activeTransaction.member;
                const originalDuration = activeTransaction.duration; // dalam detik
                
                // Gunakan realUsedTime dari activities, bukan elapsed time
                const usedTime = realUsedTime;
                const remainingTime = Math.max(0, originalDuration - usedTime);
                
                console.log(`Member transaction end - Original: ${originalDuration}s, Used: ${usedTime}s, Remaining: ${remainingTime}s`);
                
                if (remainingTime > 0) {
                    // Hitung biaya untuk waktu yang tidak terpakai
                    const category = await Category.findByPk(device.categoryId);
                    if (category) {
                        const { calculateCost } = require('../utils/cost');
                        const refundAmount = calculateCost(remainingTime, category);
                        
                        if (refundAmount > 0) {
                            // Kembalikan deposit
                            const currentDeposit = Number(member.deposit);
                            const newDeposit = currentDeposit + refundAmount;
                            
                            await member.update({ deposit: newDeposit });
                            
                            refundInfo = {
                                memberId: member.id,
                                memberName: member.username,
                                originalDuration: originalDuration,
                                usedTime: usedTime,
                                remainingTime: remainingTime,
                                refundAmount: refundAmount,
                                previousDeposit: currentDeposit,
                                newDeposit: newDeposit
                            };
                            
                            console.log(`✅ Refund processed for member ${member.username}: Rp${refundAmount} from ${remainingTime} seconds remaining`);
                        }
                    }
                }
                
                // Update transaksi dengan waktu selesai
                // Gunakan Date object langsung untuk kolom DATETIME
                const endDateTime = new Date();
                
                console.log(`🐛 DEBUG endTime generation:`);
                console.log(`- endDateTime:`, endDateTime);
                console.log(`- endDateTime.toISOString():`, endDateTime.toISOString());
                
                const finalCost = activeTransaction.cost - (refundInfo?.refundAmount || 0);
                
                console.log(`🐛 DEBUG transaction update data:`);
                console.log(`- Transaction ID:`, activeTransaction.id);
                console.log(`- end value (DATETIME):`, endDateTime);
                console.log(`- duration:`, usedTime);
                console.log(`- cost:`, finalCost);
                
                await activeTransaction.update({
                    end: endDateTime, // DATETIME object
                    duration: usedTime, // Update duration ke waktu yang benar-benar digunakan
                    cost: finalCost, // Kurangi biaya sesuai refund
                    status: 'completed' // Mark as completed
                });
                
                console.log(`✅ Transaction updated - Final cost: Rp${finalCost}, Duration: ${usedTime}s, End: ${endDateTime.toISOString()}, Status: completed`);
            } else if (activeTransaction) {
                // REGULAR TRANSACTION (non-member) - also update end time
                // Gunakan realUsedTime yang sudah dihitung di atas
                const usedTime = realUsedTime;
                
                const endDateTime = new Date();
                
                console.log(`🐛 DEBUG Regular transaction end:`);
                console.log(`- Transaction ID:`, activeTransaction.id);
                console.log(`- end value (DATETIME):`, endDateTime);
                console.log(`- duration:`, usedTime);
                console.log(`- paymentType:`, activeTransaction.paymentType);
                console.log(`- original cost:`, activeTransaction.cost);
                
                // Calculate cost for "bayar di akhir" (paymentType = 'end') transactions
                let finalCost = activeTransaction.cost;
                if (activeTransaction.paymentType === 'end') {
                    // Hitung cost berdasarkan durasi yang digunakan
                    const category = await Category.findByPk(device.categoryId);
                    if (category) {
                        const { calculateCost } = require('../utils/cost');
                        finalCost = calculateCost(usedTime, category);
                        console.log(`💰 Calculated cost for pay-at-end transaction: Rp${finalCost} for ${usedTime}s`);
                    }
                }
                
                await activeTransaction.update({
                    end: endDateTime, // DATETIME object
                    duration: usedTime,
                    cost: finalCost, // Update cost (calculated for pay-at-end, unchanged for upfront)
                    status: 'completed' // Mark as completed
                });
                
                console.log(`✅ Regular transaction updated - Final cost: Rp${finalCost}, Duration: ${usedTime}s, End: ${endDateTime.toISOString()}, Status: completed`);
            }
            
            // Reset semua status timer
            await device.update({
                timerStatus: 'end',
                timerElapsed: 0,
                timerStart: null,
                lastPausedAt: null,
                timerDuration: 0
            });

            // Log aktivitas END transaksi jika ada transaksi aktif (skip jika dari offline sync)
            if (activeTransaction && !skipActivityLog) {
                const finalCost = activeTransaction.cost - (refundInfo?.refundAmount || 0);
                
                // realUsedTime sudah dihitung di awal blok 'end' command
                console.log(`📊 Usage calculation for end: elapsed=${device.timerElapsed}s, realUsage=${realUsedTime}s`);

                await logTransactionEnd(
                    activeTransaction.id, 
                    realUsedTime,  // ✅ gunakan real usage dari activities
                    finalCost, 
                    'manual_end',
                    refundInfo
                );
                console.log(`📝 Activity logged: end for transaction ${activeTransaction.id} with usedTime=${realUsedTime}s`);
                
                // Ambil semua produk dalam transaksi
                const transactionProducts = await TransactionProduct.findAll({
                    where: { transactionId: activeTransaction.id },
                    include: [{ model: Product, as: 'product' }]
                });
                
                const productsTotal = transactionProducts.reduce((sum, tp) => sum + tp.subtotal, 0);
                const activeShift = await getAnyActiveShift();
                
                // Untuk transaksi bayar di awal (upfront), cek apakah ada produk yang perlu dibayar
                if (activeTransaction.paymentType === 'upfront') {
                    if (productsTotal > 0 && activeShift) {
                        // Buat payment record untuk produk saja (biaya main sudah dibayar di awal)
                        await createPaymentRecord({
                            shiftId: activeShift.id,
                            userId: req.user.id,
                            transactionId: activeTransaction.id,
                            amount: productsTotal,
                            type: 'FNB',
                            paymentMethod: 'CASH',
                            note: `Produk F&B - ${transactionProducts.length} item`
                        });
                        console.log(`💰 Payment record created for products: Rp${productsTotal} (${transactionProducts.length} items)`);
                    }
                }
                // Untuk transaksi bayar di akhir (end), buat payment record untuk biaya main + produk
                else if (activeTransaction.paymentType === 'end') {
                    if (activeShift) {
                        const playCost = activeTransaction.cost || 0;
                        const totalAmount = playCost + productsTotal;
                        
                        // Buat payment record untuk biaya main
                        if (playCost > 0) {
                            await createPaymentRecord({
                                shiftId: activeShift.id,
                                userId: req.user.id,
                                transactionId: activeTransaction.id,
                                amount: playCost,
                                type: 'RENTAL',
                                paymentMethod: 'CASH',
                                note: `Bayar di akhir - ${Math.floor(realUsedTime / 60)} menit`
                            });
                            console.log(`💰 Payment record created for play cost (pay-at-end): Rp${playCost}`);
                        }
                        
                        // Buat payment record untuk produk jika ada
                        if (productsTotal > 0) {
                            await createPaymentRecord({
                                shiftId: activeShift.id,
                                userId: req.user.id,
                                transactionId: activeTransaction.id,
                                amount: productsTotal,
                                type: 'FNB',
                                paymentMethod: 'CASH',
                                note: `Produk F&B - ${transactionProducts.length} item`
                            });
                            console.log(`💰 Payment record created for products: Rp${productsTotal} (${transactionProducts.length} items)`);
                        }
                        
                        console.log(`💵 Total payment for pay-at-end transaction: Rp${totalAmount} (play: ${playCost}, products: ${productsTotal})`);
                    }
                }
            } else if (skipActivityLog) {
                console.log(`⏭️ End activity log skipped (offline sync will handle it)`);
            }
            
            // Notify mobile clients tentang refund jika ada
            if (refundInfo) {
                notifyMobileClients({
                    type: 'member_refund_processed',
                    deviceId: id,
                    refundInfo: refundInfo,
                    timestamp: now.toISOString()
                });
            }
        }

        // NOTE: Relay commands sekarang dikirim langsung via BLE dari mobile app ke ESP32
        // Backend hanya update status database, tidak mengirim command ke WebSocket
        // Ini karena flow baru: Data → API Server, Relay Control → BLE ke ESP32

        // Get updated device data
        const updatedDevice = await Device.findByPk(id);

        const responseData = {
            command: command,
            device: {
                id: updatedDevice.id,
                timerStatus: updatedDevice.timerStatus,
                timerStart: updatedDevice.timerStart,
                timerDuration: updatedDevice.timerDuration,
                timerElapsed: updatedDevice.timerElapsed,
                lastPausedAt: updatedDevice.lastPausedAt
            }
        };

        // Tambahkan informasi refund jika ada
        if (refundInfo) {
            responseData.refund = refundInfo;
        }

        // Tambahkan transaction ID jika ada active transaction yang sudah diakhiri
        if (command === 'end' && activeTransaction) {
            responseData.transaction = {
                id: activeTransaction.id,
                deviceId: activeTransaction.deviceId,
                start: activeTransaction.start,
                end: activeTransaction.end || now,
                duration: activeTransaction.duration,
                cost: activeTransaction.cost,
                isMemberTransaction: activeTransaction.isMemberTransaction,
                memberId: activeTransaction.memberId
            };
            console.log(`✅ Transaction included in response: ${activeTransaction.id}`);
        }

        return res.status(200).json({
            message: `Berhasil update status ${command} untuk device${refundInfo ? ` dengan refund Rp${refundInfo.refundAmount}` : ''}`,
            data: responseData
        });

    } catch (error) {
        console.error('Send command error:', error);
        return res.status(500).json({
            message: error.message
        });
    }
};

const addTime = async (req, res) => {
    const { deviceId } = req.params;
    const { additionalTime, useDeposit = true, paymentMethod, skipActivityLog = false } = req.body;

    console.log('➕ ADD TIME request:', { deviceId, additionalTime, useDeposit, paymentMethod, skipActivityLog });

    try {
        const now = new Date();
        
        if (!additionalTime || typeof additionalTime !== 'number' || additionalTime === 0) {
            console.warn('❌ Validation error: additionalTime invalid');
            return res.status(400).json({
                message: 'Additional time harus berupa angka menit yang tidak nol'
            });
        }

        console.log('📦 Fetching device...');
        const device = await Device.findByPk(deviceId, {
            include: [{ model: Category }]
        });
        
        if (!device) {
            console.warn(`❌ Device not found: ${deviceId}`);
            return res.status(404).json({ message: 'Device tidak ditemukan' });
        }
        
        if (!device.Category) {
            console.warn(`❌ Category not found for device: ${deviceId}`);
            return res.status(400).json({ message: 'Kategori device tidak ditemukan' });
        }

        if (device.timerStatus !== 'start') {
            console.warn(`❌ Timer not running: ${device.timerStatus}`);
            return res.status(400).json({
                message: 'Device tidak memiliki timer yang aktif'
            });
        }

        console.log('📝 Fetching active transaction...');
        const activeTransaction = await Transaction.findOne({
            where: { deviceId, end: null },
            order: [['createdAt', 'DESC']]
        });
        
        if (!activeTransaction) {
            console.warn(`❌ No active transaction for device: ${deviceId}`);
            return res.status(404).json({ message: 'Tidak ada transaksi aktif' });
        }

        const additionalSeconds = additionalTime * 60;
        const newDurationSeconds = Number(activeTransaction.duration) + additionalSeconds;

        if (newDurationSeconds < 0) {
            console.warn(`❌ Duration negative: ${newDurationSeconds}`);
            return res.status(400).json({
                message: 'Durasi tidak boleh kurang dari 0'
            });
        }

        console.log('💰 Calculating cost...');
        const { calculateCost } = require('../utils/cost');
        const totalCost = calculateCost(newDurationSeconds, device.Category);
        
        if (totalCost < 0) {
            console.warn(`❌ Cost negative: ${totalCost}`);
            return res.status(400).json({
                message: 'Perhitungan biaya menghasilkan nilai negatif'
            });
        }

        const incrementalCost = totalCost - activeTransaction.cost;
        console.log(`📊 Cost calculation: old=${activeTransaction.cost}, new=${totalCost}, increment=${incrementalCost}`);

        let previousDeposit = null;
        let newDeposit = null;
        let memberData = null;
        
        if (activeTransaction.memberId && useDeposit) {
            console.log('💳 Checking member deposit...');
            const member = await Member.findByPk(activeTransaction.memberId);
            if (!member) {
                console.warn(`❌ Member not found: ${activeTransaction.memberId}`);
                return res.status(400).json({ message: 'Member tidak ditemukan' });
            }
            
            previousDeposit = Number(member.deposit);
            
            if (incrementalCost > 0 && previousDeposit < incrementalCost) {
                console.warn(`❌ Insufficient deposit: have=${previousDeposit}, need=${incrementalCost}`);
                return res.status(400).json({
                    message: 'Deposit tidak mencukupi'
                });
            }
            
            newDeposit = previousDeposit - incrementalCost;
            console.log(`💳 Updating member deposit: ${previousDeposit} → ${newDeposit}`);
            await member.update({ deposit: newDeposit });
            memberData = { id: member.id, username: member.username, email: member.email, previousDeposit, newDeposit };
        }

        console.log(`📝 Updating transaction ${activeTransaction.id}...`);
        await activeTransaction.update({
            duration: newDurationSeconds,
            cost: totalCost
        });
        console.log(`✅ Transaction updated: duration=${newDurationSeconds}`);

        // PENTING: Hitung REMAINING TIME yang benar untuk device.timerDuration
        // device.timerDuration adalah REMAINING TIME (sisa waktu), bukan total duration!
        // 
        // Cara hitung remaining time setelah add time:
        // 1. Hitung berapa sisa waktu sebelum add time
        // 2. Tambahkan additionalSeconds ke sisa waktu
        
        const timerStartDate = new Date(device.timerStart);
        const elapsedSeconds = Math.floor((now - timerStartDate) / 1000);
        const previousRemaining = Math.max(0, device.timerDuration - elapsedSeconds);
        const newRemainingSeconds = previousRemaining + additionalSeconds;
        
        console.log(`⏱️ Timer calculation:`);
        console.log(`   Previous timerStart: ${timerStartDate.toISOString()}`);
        console.log(`   Previous timerDuration: ${device.timerDuration}s`);
        console.log(`   Elapsed since start: ${elapsedSeconds}s`);
        console.log(`   Previous remaining: ${previousRemaining}s`);
        console.log(`   Additional: ${additionalSeconds}s`);
        console.log(`   New remaining: ${newRemainingSeconds}s`);

        console.log(`⏱️ Updating device ${deviceId}...`);
        await device.update({ 
            timerDuration: newRemainingSeconds,  // Simpan REMAINING time, bukan total!
            timerStart: now                       // Reset timerStart ke NOW
        });
        console.log(`✅ Device updated: timerDuration=${newRemainingSeconds}s, timerStart=${now.toISOString()}`);
        console.log(`   → Frontend calculation: NOW + ${newRemainingSeconds}s = end time`);

        // Notify clients (WebSocket disabled, so no-op)
        notifyMobileClients({
            type: 'transaction_time_modified',
            transactionId: activeTransaction.id,
            deviceId: device.id,
            additionalTime: additionalTime,
            newDuration: newDurationSeconds,
            totalCost: totalCost,
            incrementalCost: incrementalCost,
            timestamp: new Date().toISOString()
        });

        // Log ke TransactionActivities (skip jika dari offline sync untuk mencegah double logging)
        if (!skipActivityLog) {
            try {
                // Determine payment method for logging
                let logPaymentMethod;
                if (activeTransaction.memberId && useDeposit) {
                    logPaymentMethod = 'deposit';
                } else {
                    // Use provided paymentMethod or default to CASH
                    logPaymentMethod = paymentMethod || 'CASH';
                }
                
                const memberBalanceInfo = memberData ? {
                    previousBalance: memberData.previousDeposit,
                    newBalance: memberData.newDeposit
                } : null;
                
                await logAddTime(
                    activeTransaction.id,
                    additionalSeconds,
                    incrementalCost,
                    logPaymentMethod,
                    memberBalanceInfo
                );
                console.log(`📝 Activity logged: add_time for transaction ${activeTransaction.id}`);
            } catch (logError) {
                console.error('⚠️ Failed to log add_time activity:', logError.message);
                // Jangan gagalkan request jika logging gagal
            }
        } else {
            console.log(`⏭️ Activity log skipped (offline sync will handle it)`);
        }

        // Create payment record for incremental cost (if not using member deposit)
        // Member deposit sudah dideduct di atas, jadi hanya catat pembayaran untuk non-member atau member yang tidak pakai deposit
        if (incrementalCost > 0 && activeShift && !(activeTransaction.memberId && useDeposit)) {
            try {
                const paymentMethodToUse = paymentMethod || 'CASH';
                await createPaymentRecord(
                    activeShift.id,
                    req.user.id,
                    activeTransaction.id,
                    incrementalCost,
                    'RENTAL',
                    paymentMethodToUse,
                    `Tambah waktu ${additionalTime} menit - Device: ${device.name}`
                );
                console.log(`💰 Payment record created: ${incrementalCost} via ${paymentMethodToUse}`);
            } catch (paymentError) {
                console.error('⚠️ Failed to create payment record:', paymentError.message);
                // Jangan gagalkan request jika payment record gagal
            }
        }

        console.log(`✅ ADD TIME completed successfully`);
        
        return res.status(200).json({
            message: `Berhasil menambah waktu ${additionalTime} menit`,
            data: {
                transaction: {
                    id: activeTransaction.id,
                    duration: newDurationSeconds,
                    cost: totalCost
                },
                device: {
                    id: device.id,
                    timerDuration: newDurationSeconds,
                    timerStart: now
                },
                member: memberData
            }
        });
        
    } catch (error) {
        console.error('❌ ADD TIME ERROR:', error.message);
        console.error('❌ Stack:', error.stack);
        return res.status(500).json({ 
            message: error.message,
            error: error.stack
        });
    }
};

/**
 * Sync offline activities untuk device
 * Endpoint untuk batch sync aktivitas yang dilakukan saat offline
 */
const syncDeviceActivities = async (req, res) => {
    const { deviceId } = req.params;
    const { activities } = req.body;

    console.log('📥 SYNC OFFLINE ACTIVITIES request:', { deviceId, activitiesCount: activities?.length });

    try {
        // Validasi input
        if (!activities || !Array.isArray(activities) || activities.length === 0) {
            return res.status(400).json({
                message: 'Activities array is required'
            });
        }

        // Cari device
        const device = await Device.findByPk(deviceId);
        if (!device) {
            return res.status(404).json({
                message: 'Device tidak ditemukan'
            });
        }

        // Cari transaksi aktif ATAU transaksi terakhir untuk device ini
        let transaction = await Transaction.findOne({
            where: {
                deviceId: deviceId,
                end: null
            },
            order: [['createdAt', 'DESC']]
        });

        // Jika tidak ada transaksi aktif, cari transaksi terakhir
        // (untuk kasus offline sync setelah transaksi sudah selesai)
        if (!transaction) {
            transaction = await Transaction.findOne({
                where: { deviceId: deviceId },
                order: [['createdAt', 'DESC']]
            });
        }

        if (!transaction) {
            return res.status(404).json({
                message: 'Tidak ada transaksi untuk device ini'
            });
        }

        // Sync activities
        const results = await syncOfflineActivities(transaction.id, activities);

        // Hitung sukses/gagal
        const successCount = results.filter(r => r.success).length;
        const failedCount = results.filter(r => !r.success).length;

        return res.status(200).json({
            message: `Synced ${successCount}/${activities.length} activities`,
            data: {
                transactionId: transaction.id,
                totalActivities: activities.length,
                successCount,
                failedCount,
                results
            }
        });

    } catch (error) {
        console.error('Error syncing offline activities:', error);
        return res.status(500).json({
            message: 'Terjadi kesalahan saat sync aktivitas',
            error: error.message
        });
    }
};

module.exports = {
    createDevice,
    getAllDevices,
    getDeviceById,
    updateDevice,
    deleteDevice,
    sendDeviceCommand,
    addTime,
    syncDeviceActivities
}
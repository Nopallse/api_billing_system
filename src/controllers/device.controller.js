const{ Device, User, Category, Transaction, Member } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { getConnectionStatus, isTimerActive, sendCommand, sendAddTime, notifyMobileClients } = require('../wsClient');

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
            
            if (elapsedSeconds >= device.timerDuration) {
                console.log(`⏰ Timer expired for device ${device.id}, ending transaction...`);
                
                // Update device status
                await device.update({
                    timerStatus: 'end',
                    timerElapsed: device.timerDuration
                });
                
                // End active transaction if exists
                const activeTransaction = device.Transactions && device.Transactions[0];
                if (activeTransaction) {
                    const endTime = new Date(startTime.getTime() + (device.timerDuration * 1000));
                    await activeTransaction.update({
                        end: endTime.toTimeString().split(' ')[0] // Format HH:MM:SS
                    });
                    
                    console.log(`✅ Transaction ${activeTransaction.id} ended automatically`);
                    
                    // Notify mobile clients
                    notifyMobileClients({
                        type: 'transaction_auto_ended',
                        transactionId: activeTransaction.id,
                        deviceId: device.id,
                        reason: 'timer_expired',
                        timestamp: now.toISOString()
                    });
                }
                
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
    const {name, categoryId, id} = req.body;

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

        // Cek koneksi websocket terlebih dahulu
        const connectedDevices = getConnectionStatus();
        const isConnected = connectedDevices.devices.some(device => 
            device.deviceId === id || device.deviceId === id
        );
        
        if (!isConnected) {
            return res.status(400).json({
                message: 'Device belum terkoneksi ke server WebSocket'
            });
        }

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

        // Buat device baru
        const device = await Device.create({
            id: id,
            name,
            categoryId
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

        // Ambil status koneksi
        const connectedStatus = getConnectionStatus();
        const connectedDevices = new Map(
            connectedStatus.devices.map(device => [device.deviceId, device])
        );

        // Gabungkan data database dengan status koneksi
        const devicesWithStatus = devices.map(device => {
            const deviceData = device.toJSON();
            const connectionInfo = connectedDevices.get(device.id);
            const activeTransaction = deviceData.Transactions && deviceData.Transactions[0];
            
            // Tentukan apakah ini member transaction berdasarkan memberId atau flag
            const isMemberTransaction = activeTransaction ? 
                (activeTransaction.isMemberTransaction === true || activeTransaction.memberId !== null) : false;
            
            // Periksa apakah timer sudah expired
            let isTimerExpired = false;
            if (device.timerStart && device.timerDuration && device.timerStatus === 'start') {
                const now = new Date();
                const startTime = new Date(device.timerStart);
                const elapsedSeconds = Math.floor((now - startTime) / 1000);
                isTimerExpired = elapsedSeconds >= device.timerDuration;
                
                console.log(`Device ${device.id}: elapsed=${elapsedSeconds}, duration=${device.timerDuration}, expired=${isTimerExpired}`);
            }
            
            // Jika timerStatus adalah 'end' atau timer expired, maka tidak ada transaksi aktif
            const hasActiveTransaction = activeTransaction && device.timerStatus !== 'end' && !isTimerExpired;
            
            // Tentukan status device
            let deviceStatus = 'off';
            if (connectionInfo) {
                if (isTimerExpired && device.timerStatus === 'start') {
                    deviceStatus = 'off'; // Timer habis, paksa status ke off
                } else {
                    deviceStatus = connectionInfo.status;
                }
            }
            
            return {
                ...deviceData,
                isConnected: !!connectionInfo && connectionInfo.status !== 'pause_disconnected',
                status: deviceStatus,
                activeTransaction: hasActiveTransaction ? {
                    id: activeTransaction.id,
                    start: activeTransaction.start,
                    duration: activeTransaction.duration,
                    cost: activeTransaction.cost,
                    isMemberTransaction: isMemberTransaction,
                    member: activeTransaction.member || null
                } : null
            };
        });

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

        // Ambil status koneksi
        const connectedStatus = getConnectionStatus();
        const connectionInfo = connectedStatus.devices.find(d => d.deviceId === id);

        const deviceData = device.toJSON();
        const activeTransaction = deviceData.Transactions && deviceData.Transactions[0];
        
        // Tentukan apakah ini member transaction berdasarkan memberId atau flag
        const isMemberTransaction = activeTransaction ? 
            (activeTransaction.isMemberTransaction === true || activeTransaction.memberId !== null) : false;
        
        // Periksa apakah timer sudah expired
        let isTimerExpired = false;
        if (device.timerStart && device.timerDuration && device.timerStatus === 'start') {
            const now = new Date();
            const startTime = new Date(device.timerStart);
            const elapsedSeconds = Math.floor((now - startTime) / 1000);
            isTimerExpired = elapsedSeconds >= device.timerDuration;
            
            console.log(`Device ${device.id} detail: elapsed=${elapsedSeconds}, duration=${device.timerDuration}, expired=${isTimerExpired}`);
        }
        
        // Jika timerStatus adalah 'end' atau timer expired, maka tidak ada transaksi aktif
        const hasActiveTransaction = activeTransaction && device.timerStatus !== 'end' && !isTimerExpired;
        
        // Tentukan status device
        let deviceStatus = 'off';
        if (connectionInfo) {
            if (isTimerExpired && device.timerStatus === 'start') {
                deviceStatus = 'off'; // Timer habis, paksa status ke off
            } else {
                deviceStatus = connectionInfo.status;
            }
        }
        
        const response = {
            ...deviceData,
            isConnected: !!connectionInfo && connectionInfo.status !== 'pause_disconnected',
            status: deviceStatus,
            activeTransaction: hasActiveTransaction ? {
                id: activeTransaction.id,
                start: activeTransaction.start,
                duration: activeTransaction.duration,
                cost: activeTransaction.cost,
                isMemberTransaction: isMemberTransaction,
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
    const { command } = req.body;

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

        // Handle timer status berdasarkan command
        if (command === 'start') {
            if (device.timerStatus === 'start' && device.lastPausedAt) {
                // Jika timer sedang berjalan tapi di-pause (disconnect), resume timer
                const pauseDuration = now - device.lastPausedAt;
                // Update timer start dengan menambahkan durasi pause
                await device.update({
                    timerStart: new Date(device.timerStart.getTime() + pauseDuration),
                    lastPausedAt: null
                });
            } else if (device.timerStatus === 'stop') {
                // Jika timer di-pause manual, hitung elapsed time
                if (device.lastPausedAt) {
                    const pauseDuration = now - device.lastPausedAt;
                    // Update timer start dengan menambahkan durasi pause
                    await device.update({
                        timerStart: new Date(device.timerStart.getTime() + pauseDuration),
                        timerStatus: 'start',
                        lastPausedAt: null
                    });
                }
            } else {
                // Timer baru dimulai
                await device.update({
                    timerStart: now,
                    timerStatus: 'start',
                    timerElapsed: 0,
                    lastPausedAt: null
                });
            }
        } else if (command === 'stop') {
            if (device.timerStatus === 'start') {
                // Hitung elapsed time saat ini dalam detik
                const elapsedTime = Math.floor((now - device.timerStart) / 1000);
                await device.update({
                    timerStatus: 'stop',
                    timerElapsed: elapsedTime,
                    lastPausedAt: now
                });
            }
        } else if (command === 'end') {
            // Reset semua status timer
            await device.update({
                timerStatus: 'end',
                timerElapsed: 0,
                timerStart: null,
                lastPausedAt: null,
                timerDuration: 0
            });
        }

        // Kirim command ke device
        const result = await sendCommand({
            deviceId: id,
            command
        });

        if (!result.success) {
            return res.status(400).json({
                message: result.message
            });
        }

        // Get updated device data
        const updatedDevice = await Device.findByPk(id);

        return res.status(200).json({
            message: `Berhasil mengirim perintah ${command} ke device`,
            data: {
                command: result.data,
                device: {
                    id: updatedDevice.id,
                    timerStatus: updatedDevice.timerStatus,
                    timerStart: updatedDevice.timerStart,
                    timerDuration: updatedDevice.timerDuration,
                    timerElapsed: updatedDevice.timerElapsed,
                    lastPausedAt: updatedDevice.lastPausedAt
                }
            }
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
    const { additionalTime } = req.body; // minutes to add (existing behavior)

    console.log('Add time request:', { deviceId, additionalTime });

    try {
        if (!additionalTime || typeof additionalTime !== 'number' || additionalTime <= 0) {
            return res.status(400).json({
                message: 'Additional time harus berupa angka menit positif (> 0)'
            });
        }

        const device = await Device.findByPk(deviceId, {
            include: [{ model: Category }]
        });
        if (!device) {
            return res.status(404).json({ message: 'Device tidak ditemukan' });
        }
        if (!device.Category) {
            return res.status(400).json({ message: 'Kategori device tidak ditemukan' });
        }

        if (device.timerStatus !== 'start') {
            return res.status(400).json({
                message: 'Device tidak memiliki timer yang aktif. Timer mungkin sudah selesai atau belum dimulai.'
            });
        }

        const { isTimerPaused } = require('../wsClient');
        if (isTimerPaused(device.id)) {
            return res.status(400).json({
                message: 'Device memiliki timer yang di-pause. Harap resume timer terlebih dahulu sebelum menambah waktu.'
            });
        }

        // Temukan transaksi aktif (seharusnya hanya 1 dengan end null)
        const activeTransaction = await Transaction.findOne({
            where: { deviceId, end: null },
            order: [['createdAt', 'DESC']]
        });
        if (!activeTransaction) {
            return res.status(404).json({ message: 'Tidak ada transaksi aktif untuk device ini' });
        }

        const additionalSeconds = additionalTime * 60;
        const newDurationSeconds = Number(activeTransaction.duration) + additionalSeconds;

        const { calculateCost } = require('../utils/cost');
        const totalCost = calculateCost(newDurationSeconds, device.Category);
        if (totalCost <= 0) {
            return res.status(400).json({
                message: 'Perhitungan biaya menghasilkan nilai tidak valid',
                data: { newDurationSeconds, periodeMenit: device.Category.periode, costPerPeriode: device.Category.cost }
            });
        }
        const incrementalCost = totalCost - activeTransaction.cost;

        let previousDeposit = null;
        let newDeposit = null;
        let memberData = null;
        if (activeTransaction.memberId) {
            const member = await Member.findByPk(activeTransaction.memberId);
            if (!member) {
                return res.status(400).json({ message: 'Member untuk transaksi ini tidak ditemukan' });
            }
            previousDeposit = Number(member.deposit);
            if (previousDeposit < incrementalCost) {
                return res.status(400).json({
                    message: 'Deposit tidak mencukupi untuk menambah waktu',
                    data: {
                        currentDeposit: previousDeposit,
                        requiredAdditional: incrementalCost,
                        shortfall: incrementalCost - previousDeposit
                    }
                });
            }
            newDeposit = previousDeposit - incrementalCost;
            // Kurangi deposit terlebih dahulu (akan di-rollback jika sendAddTime gagal)
            await member.update({ deposit: newDeposit });
            memberData = { id: member.id, username: member.username, email: member.email, previousDeposit, newDeposit, deductedAdditional: incrementalCost };
        }

        // Update transaksi (durasi & total biaya)
        await activeTransaction.update({
            duration: newDurationSeconds,
            cost: totalCost
        });

        // Update device
        await device.update({ timerDuration: newDurationSeconds });

        // Kirim perintah add time ke device (detik)
        const result = await sendAddTime({
            deviceId: device.id,
            additionalTime: additionalSeconds
        });

        if (!result.success) {
            // Rollback perubahan jika gagal
            await activeTransaction.update({
                duration: activeTransaction.duration - additionalSeconds,
                cost: activeTransaction.cost - incrementalCost
            });
            await device.update({ timerDuration: device.timerDuration - additionalSeconds });
            if (activeTransaction.memberId && previousDeposit !== null) {
                const member = await Member.findByPk(activeTransaction.memberId);
                if (member) await member.update({ deposit: previousDeposit });
            }
            return res.status(500).json({ message: `Gagal mengirim perintah ke device: ${result.message}` });
        }

        notifyMobileClients({
            type: 'transaction_time_added',
            transactionId: activeTransaction.id,
            deviceId: device.id,
            additionalTime: additionalTime, // minutes
            newDuration: newDurationSeconds,
            totalCost: totalCost,
            incrementalCost: incrementalCost,
            timestamp: new Date().toISOString()
        });

        return res.status(200).json({
            message: `Berhasil menambah waktu ${additionalTime} menit ke device`,
            data: {
                transaction: {
                    id: activeTransaction.id,
                    deviceId: activeTransaction.deviceId,
                    duration: newDurationSeconds,
                    cost: totalCost,
                    start: activeTransaction.start,
                    end: activeTransaction.end,
                    incrementalCost
                },
                device: {
                    id: device.id,
                    name: device.name,
                    timerStatus: device.timerStatus,
                    timerDuration: device.timerDuration
                },
                addedTimeMinutes: additionalTime,
                member: memberData
            }
        });
    } catch (error) {
        console.error('Add time to transaction error:', error);
        return res.status(500).json({ message: error.message });
    }
};

module.exports = {
    createDevice,
    getAllDevices,
    getDeviceById,
    updateDevice,
    deleteDevice,
    sendDeviceCommand,
    addTime
}
// transactionActivityLogger.js
const { TransactionActivity } = require('../models');

/**
 * Log aktivitas transaksi
 * @param {string} transactionId - ID transaksi
 * @param {string} activityType - Jenis aktivitas: 'start', 'stop', 'resume', 'add_time', 'end'
 * @param {Object} options - Opsi tambahan
 * @param {string} options.description - Deskripsi aktivitas
 * @param {number} options.durationAdded - Durasi yang ditambahkan (detik)
 * @param {number} options.costAdded - Biaya tambahan
 * @param {string} options.paymentMethod - Metode pembayaran: 'deposit', 'cash', 'direct'
 * @param {number} options.previousBalance - Saldo sebelum aktivitas
 * @param {number} options.newBalance - Saldo setelah aktivitas
 * @param {string} options.deviceStatus - Status device saat aktivitas
 * @param {Object} options.metadata - Metadata tambahan
 */
const logTransactionActivity = async (transactionId, activityType, options = {}) => {
    try {
        const {
            description,
            durationAdded = null,
            costAdded = null,
            paymentMethod = null,
            previousBalance = null,
            newBalance = null,
            deviceStatus = null,
            metadata = null
        } = options;

        const activity = await TransactionActivity.create({
            transactionId,
            activityType,
            description,
            durationAdded,
            costAdded,
            paymentMethod,
            previousBalance,
            newBalance,
            deviceStatus,
            metadata,
            timestamp: new Date()
        });

        console.log(`✅ Activity logged: ${activityType} for transaction ${transactionId}`);
        return activity;
    } catch (error) {
        console.error(`❌ Error logging activity ${activityType} for transaction ${transactionId}:`, error);
        throw error;
    }
};

/**
 * Log aktivitas start transaksi
 */
const logTransactionStart = async (transactionId, deviceId, duration, cost, isMemberTransaction = false, memberInfo = null) => {
    const description = isMemberTransaction ? 
        `Transaksi member dimulai untuk device ${deviceId} dengan durasi ${duration} detik, biaya ${cost}` :
        `Transaksi dimulai untuk device ${deviceId} dengan durasi ${duration} detik, biaya ${cost}`;
    
    const metadata = {
        deviceId,
        initialDuration: duration,
        initialCost: cost,
        isMemberTransaction,
        memberInfo
    };

    return await logTransactionActivity(transactionId, 'start', {
        description,
        deviceStatus: 'active',
        metadata
    });
};

/**
 * Log aktivitas stop transaksi
 */
const logTransactionStop = async (transactionId, reason = 'Manual stop') => {
    const description = `Transaksi dihentikan: ${reason}`;
    
    return await logTransactionActivity(transactionId, 'stop', {
        description,
        deviceStatus: 'paused',
        metadata: { reason }
    });
};

/**
 * Log aktivitas resume transaksi
 */
const logTransactionResume = async (transactionId, reason = 'Manual resume') => {
    const description = `Transaksi dilanjutkan: ${reason}`;
    
    return await logTransactionActivity(transactionId, 'resume', {
        description,
        deviceStatus: 'active',
        metadata: { reason }
    });
};

/**
 * Log aktivitas penambahan waktu
 */
const logAddTime = async (transactionId, durationAdded, costAdded, paymentMethod, memberBalanceInfo = null) => {
    const durationMinutes = Math.ceil(durationAdded / 60);
    let description = `Menambah waktu ${durationMinutes} menit (${durationAdded} detik) dengan biaya ${costAdded}`;
    
    if (paymentMethod === 'deposit' && memberBalanceInfo) {
        description += `, dibayar menggunakan deposit (saldo: ${memberBalanceInfo.previousBalance} → ${memberBalanceInfo.newBalance})`;
    } else if (paymentMethod === 'cash') {
        description += ', dibayar tunai';
    } else if (paymentMethod === 'direct') {
        description += ', dibayar langsung';
    }

    const options = {
        description,
        durationAdded,
        costAdded,
        paymentMethod,
        deviceStatus: 'active'
    };

    if (memberBalanceInfo) {
        options.previousBalance = memberBalanceInfo.previousBalance;
        options.newBalance = memberBalanceInfo.newBalance;
    }

    return await logTransactionActivity(transactionId, 'add_time', options);
};

/**
 * Log aktivitas end transaksi
 */
const logTransactionEnd = async (transactionId, totalDuration, totalCost, reason = 'Timer completed', refundInfo = null) => {
    const totalMinutes = Math.ceil(totalDuration / 60);
    let description = `Transaksi selesai: ${reason}. Total durasi ${totalMinutes} menit (${totalDuration} detik), total biaya ${totalCost}`;
    
    if (refundInfo) {
        description += `. Refund: Rp${refundInfo.refundAmount} dari ${refundInfo.remainingSeconds} detik tidak terpakai`;
    }
    
    const metadata = {
        reason,
        totalDuration,
        totalCost
    };

    if (refundInfo) {
        metadata.refundInfo = refundInfo;
    }
    
    return await logTransactionActivity(transactionId, 'end', {
        description,
        deviceStatus: 'completed',
        metadata
    });
};

/**
 * Log BLE disconnect event
 */
const logBleDisconnect = async (transactionId, disconnectReason, disconnectSource, deviceId) => {
    const sourceText = disconnectSource === 'esp32' ? 'ESP32 terputus' : 
                       disconnectSource === 'mobile' ? 'Aplikasi memutuskan koneksi' : 
                       disconnectSource === 'timeout' ? 'Timeout (tidak ada heartbeat)' : 
                       'Koneksi terputus';
    
    const description = `BLE terputus: ${sourceText}. Alasan: ${disconnectReason}`;
    
    const metadata = {
        disconnectReason,
        disconnectSource,
        deviceId,
        timestamp: new Date().toISOString()
    };
    
    return await logTransactionActivity(transactionId, 'ble_disconnect', {
        description,
        deviceStatus: 'disconnected',
        metadata
    });
};

/**
 * Mendapatkan semua aktivitas untuk transaksi
 */
const getTransactionActivities = async (transactionId) => {
    try {
        const activities = await TransactionActivity.findAll({
            where: { transactionId },
            order: [['timestamp', 'ASC']]
        });
        
        return activities;
    } catch (error) {
        console.error(`Error getting activities for transaction ${transactionId}:`, error);
        throw error;
    }
};

/**
 * Mendapatkan ringkasan aktivitas transaksi
 */
const getTransactionSummary = async (transactionId) => {
    try {
        const activities = await getTransactionActivities(transactionId);
        
        const summary = {
            totalActivities: activities.length,
            timeAdditions: [],
            stopResumeCount: 0,
            totalAddedDuration: 0,
            totalAddedCost: 0,
            paymentMethods: {},
            timeline: []
        };

        for (const activity of activities) {
            // Timeline
            summary.timeline.push({
                timestamp: activity.timestamp,
                type: activity.activityType,
                description: activity.description
            });

            // Count time additions
            if (activity.activityType === 'add_time') {
                summary.timeAdditions.push({
                    timestamp: activity.timestamp,
                    durationAdded: activity.durationAdded,
                    costAdded: activity.costAdded,
                    paymentMethod: activity.paymentMethod,
                    previousBalance: activity.previousBalance,
                    newBalance: activity.newBalance
                });
                
                summary.totalAddedDuration += activity.durationAdded || 0;
                summary.totalAddedCost += activity.costAdded || 0;
                
                // Count payment methods
                const method = activity.paymentMethod || 'unknown';
                summary.paymentMethods[method] = (summary.paymentMethods[method] || 0) + 1;
            }

            // Count stop/resume activities
            if (activity.activityType === 'stop' || activity.activityType === 'resume') {
                summary.stopResumeCount++;
            }
        }

        return summary;
    } catch (error) {
        console.error(`Error getting transaction summary for ${transactionId}:`, error);
        throw error;
    }
};

/**
 * Batch sync offline activities
 * Untuk handle aktivitas yang dilakukan saat offline
 * @param {string} transactionId - ID transaksi
 * @param {Array} activities - Array of offline activities
 * Format: [{ activityType, timestamp, params }]
 */
const syncOfflineActivities = async (transactionId, activities) => {
    const results = [];
    
    try {
        console.log(`📥 Syncing ${activities.length} offline activities for transaction ${transactionId}`);
        
        // Sort by timestamp to ensure correct order
        const sortedActivities = [...activities].sort((a, b) => 
            new Date(a.timestamp) - new Date(b.timestamp)
        );
        
        for (const activity of sortedActivities) {
            try {
                const { activityType, timestamp, params = {} } = activity;
                
                // Create activity with original timestamp
                const loggedActivity = await TransactionActivity.create({
                    transactionId,
                    activityType,
                    description: params.description || `Offline ${activityType}`,
                    durationAdded: params.durationAdded || null,
                    costAdded: params.costAdded || null,
                    paymentMethod: params.paymentMethod || null,
                    previousBalance: params.previousBalance || null,
                    newBalance: params.newBalance || null,
                    deviceStatus: params.deviceStatus || null,
                    metadata: {
                        ...params.metadata,
                        syncedFromOffline: true,
                        originalTimestamp: timestamp,
                        syncedAt: new Date().toISOString()
                    },
                    timestamp: new Date(timestamp) // Use original timestamp
                });
                
                results.push({
                    success: true,
                    activityId: loggedActivity.id,
                    activityType
                });
                
                console.log(`  ✅ Synced: ${activityType} at ${timestamp}`);
            } catch (error) {
                results.push({
                    success: false,
                    activityType: activity.activityType,
                    error: error.message
                });
                console.error(`  ❌ Failed: ${activity.activityType}:`, error.message);
            }
        }
        
        console.log(`📊 Sync complete: ${results.filter(r => r.success).length}/${activities.length} succeeded`);
        return results;
    } catch (error) {
        console.error(`Error syncing offline activities:`, error);
        throw error;
    }
};

module.exports = {
    logTransactionActivity,
    logTransactionStart,
    logTransactionStop,
    logTransactionResume,
    logAddTime,
    logTransactionEnd,
        logBleDisconnect,
    getTransactionActivities,
    getTransactionSummary,
    syncOfflineActivities
};
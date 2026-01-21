// shift.controller.js
const { Shift, Payment, User, Transaction, Device, Category, TransactionProduct, Product, Member } = require("../models");
const { v4: uuidv4 } = require("uuid");
const { Op } = require("sequelize");

// Mendapatkan shift aktif untuk user tertentu
const getActiveShift = async (userId) => {
    return await Shift.findOne({
        where: {
            userId: userId,
            status: 'open'
        }
    });
};

// Mendapatkan shift aktif global (untuk validasi transaksi)
const getAnyActiveShift = async () => {
    return await Shift.findOne({
        where: {
            status: 'open'
        },
        include: [{
            model: User,
            as: 'user',
            attributes: ['id', 'username', 'email']
        }]
    });
};

// Mulai shift baru
const startShift = async (req, res) => {
    try {
        const userId = req.user.id;
        const { initialCash = 0 } = req.body;

        // Cek apakah ada shift yang masih terbuka untuk user ini
        const existingShift = await getActiveShift(userId);
        if (existingShift) {
            return res.status(400).json({
                message: 'Anda masih memiliki shift yang aktif. Silakan tutup shift terlebih dahulu.',
                data: existingShift
            });
        }

        // Cek apakah ada shift yang masih terbuka secara global (opsional: bisa dinonaktifkan jika multi-kasir)
        const anyOpenShift = await getAnyActiveShift();
        if (anyOpenShift) {
            return res.status(400).json({
                message: `Shift masih dibuka oleh ${anyOpenShift.user?.username || 'user lain'}. Silakan tutup shift tersebut terlebih dahulu.`,
                data: anyOpenShift
            });
        }

        const shift = await Shift.create({
            id: uuidv4(),
            userId: userId,
            startTime: new Date(),
            initialCash: initialCash,
            status: 'open'
        });

        return res.status(201).json({
            message: 'Shift berhasil dimulai',
            data: shift
        });
    } catch (error) {
        console.error('Error starting shift:', error);
        return res.status(500).json({
            message: 'Terjadi kesalahan saat memulai shift',
            error: error.message
        });
    }
};

// Tutup shift
const endShift = async (req, res) => {
    try {
        const userId = req.user.id;
        const { finalCash, note } = req.body;

        // Cari shift aktif user ini
        const shift = await getActiveShift(userId);
        if (!shift) {
            return res.status(404).json({
                message: 'Tidak ada shift aktif untuk ditutup'
            });
        }

        // Hitung expected cash dari payments di shift ini
        const cashPayments = await Payment.sum('amount', {
            where: {
                shiftId: shift.id,
                paymentMethod: 'CASH'
            }
        });

        const expectedCash = shift.initialCash + (cashPayments || 0);

        // Update shift
        await shift.update({
            endTime: new Date(),
            finalCash: finalCash,
            expectedCash: expectedCash,
            status: 'closed',
            note: note
        });

        // Hitung selisih
        const difference = finalCash - expectedCash;

        return res.status(200).json({
            message: 'Shift berhasil ditutup',
            data: {
                shift: shift,
                summary: {
                    initialCash: shift.initialCash,
                    cashPayments: cashPayments || 0,
                    expectedCash: expectedCash,
                    actualCash: finalCash,
                    difference: difference,
                    status: difference === 0 ? 'BALANCED' : (difference > 0 ? 'SURPLUS' : 'DEFICIT')
                }
            }
        });
    } catch (error) {
        console.error('Error ending shift:', error);
        return res.status(500).json({
            message: 'Terjadi kesalahan saat menutup shift',
            error: error.message
        });
    }
};

// Cek status shift saat ini
const getShiftStatus = async (req, res) => {
    try {
        const activeShift = await getAnyActiveShift();

        if (!activeShift) {
            return res.status(200).json({
                message: 'Tidak ada shift aktif',
                data: {
                    hasActiveShift: false,
                    shift: null
                }
            });
        }

        // Hitung total pembayaran di shift ini
        const payments = await Payment.findAll({
            where: { shiftId: activeShift.id },
            attributes: ['paymentMethod', 'type', 'amount']
        });

        const summary = {
            totalCash: 0,
            totalNonCash: 0,
            byType: {},
            byMethod: {}
        };

        payments.forEach(p => {
            if (p.paymentMethod === 'CASH') {
                summary.totalCash += p.amount;
            } else {
                summary.totalNonCash += p.amount;
            }
            summary.byType[p.type] = (summary.byType[p.type] || 0) + p.amount;
            summary.byMethod[p.paymentMethod] = (summary.byMethod[p.paymentMethod] || 0) + p.amount;
        });

        return res.status(200).json({
            message: 'Shift aktif ditemukan',
            data: {
                hasActiveShift: true,
                shift: activeShift,
                summary: {
                    ...summary,
                    expectedCashInDrawer: activeShift.initialCash + summary.totalCash
                }
            }
        });
    } catch (error) {
        console.error('Error getting shift status:', error);
        return res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Laporan shift (detail)
const getShiftReport = async (req, res) => {
    try {
        const { shiftId } = req.params;

        const shift = await Shift.findByPk(shiftId, {
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'username', 'email']
                },
                {
                    model: Payment,
                    as: 'payments',
                    include: [{
                        model: Transaction,
                        as: 'transaction',
                        attributes: ['id', 'deviceId', 'start', 'end', 'duration', 'cost']
                    }]
                }
            ]
        });

        if (!shift) {
            return res.status(404).json({
                message: 'Shift tidak ditemukan'
            });
        }

        // Aggregate payments
        const summary = {
            totalRevenue: 0,
            totalCash: 0,
            totalNonCash: 0,
            byType: {},
            byMethod: {},
            transactionCount: 0
        };

        const uniqueTransactions = new Set();

        shift.payments.forEach(p => {
            summary.totalRevenue += p.amount;
            if (p.paymentMethod === 'CASH') {
                summary.totalCash += p.amount;
            } else {
                summary.totalNonCash += p.amount;
            }
            summary.byType[p.type] = (summary.byType[p.type] || 0) + p.amount;
            summary.byMethod[p.paymentMethod] = (summary.byMethod[p.paymentMethod] || 0) + p.amount;
            if (p.transactionId) {
                uniqueTransactions.add(p.transactionId);
            }
        });

        summary.transactionCount = uniqueTransactions.size;

        return res.status(200).json({
            message: 'Success',
            data: {
                shift: {
                    id: shift.id,
                    user: shift.user,
                    startTime: shift.startTime,
                    endTime: shift.endTime,
                    initialCash: shift.initialCash,
                    finalCash: shift.finalCash,
                    expectedCash: shift.expectedCash,
                    status: shift.status
                },
                summary: summary,
                payments: shift.payments
            }
        });
    } catch (error) {
        console.error('Error getting shift report:', error);
        return res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Mendapatkan riwayat shift
const getShiftHistory = async (req, res) => {
    try {
        const { page = 1, limit = 10, start_date, end_date, status, date } = req.query;

        const whereClause = {};

        // Filter by single date (untuk mendapatkan shifts pada tanggal tertentu)
        if (date) {
            const startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);
            
            whereClause.startTime = {
                [Op.between]: [startOfDay, endOfDay]
            };
        } else if (start_date && end_date) {
            whereClause.startTime = {
                [Op.between]: [new Date(start_date), new Date(end_date + 'T23:59:59')]
            };
        }

        // Filter by status if provided
        if (status) {
            whereClause.status = status;
        }

        const offset = (page - 1) * limit;

        const { count, rows: shifts } = await Shift.findAndCountAll({
            where: whereClause,
            include: [{
                model: User,
                as: 'user',
                attributes: ['id', 'username', 'email']
            }, {
                model: Payment,
                as: 'payments',
                attributes: ['amount', 'type', 'paymentMethod']
            }],
            order: [['startTime', 'DESC']],
            limit: parseInt(limit),
            offset: offset
        });

        // Calculate summary for each shift
        const shiftsWithSummary = shifts.map(shift => {
            const shiftData = shift.toJSON();
            
            // Aggregate payments
            let pendapatanDevice = 0;
            let pendapatanCafe = 0;
            let totalPendapatan = 0;
            const transactionIds = new Set();

            if (shiftData.payments && Array.isArray(shiftData.payments)) {
                shiftData.payments.forEach(payment => {
                    totalPendapatan += payment.amount || 0;
                    
                    if (payment.type === 'RENTAL') {
                        pendapatanDevice += payment.amount || 0;
                    } else if (payment.type === 'FNB') {
                        pendapatanCafe += payment.amount || 0;
                    }
                    
                    if (payment.transactionId) {
                        transactionIds.add(payment.transactionId);
                    }
                });
            }

            return {
                ...shiftData,
                summary: {
                    pendapatanDevice,
                    pendapatanCafe,
                    totalPendapatan,
                    transactionCount: transactionIds.size
                }
            };
        });

        const totalPages = Math.ceil(count / limit);

        return res.status(200).json({
            message: 'Success',
            data: {
                shifts: shiftsWithSummary,
                pagination: {
                    totalItems: count,
                    totalPages,
                    currentPage: parseInt(page),
                    itemsPerPage: parseInt(limit)
                }
            }
        });
    } catch (error) {
        console.error('Error getting shift history:', error);
        return res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Mendapatkan transaksi dalam shift tertentu
const getShiftTransactions = async (req, res) => {
    try {
        const { shiftId } = req.params;

        // Cek apakah shift ada
        const shift = await Shift.findByPk(shiftId, {
            include: [{
                model: User,
                as: 'user',
                attributes: ['id', 'username', 'email']
            }]
        });

        if (!shift) {
            return res.status(404).json({
                message: 'Shift tidak ditemukan'
            });
        }

        // Ambil semua payment dalam shift ini
        const payments = await Payment.findAll({
            where: { shiftId: shiftId },
            attributes: ['transactionId', 'amount', 'type', 'paymentMethod', 'createdAt']
        });

        // Ambil unique transaction IDs
        const transactionIds = [...new Set(payments.map(p => p.transactionId).filter(id => id !== null))];

        if (transactionIds.length === 0) {
            return res.status(200).json({
                message: 'Success',
                data: {
                    shift: {
                        id: shift.id,
                        startTime: shift.startTime,
                        endTime: shift.endTime,
                        user: shift.user
                    },
                    transactions: [],
                    summary: {
                        pendapatanDevice: 0,
                        pendapatanCafe: 0,
                        totalPendapatan: 0,
                        transactionCount: 0
                    }
                }
            });
        }

        // Ambil semua transactions dengan detail lengkap
        const transactions = await Transaction.findAll({
            where: {
                id: { [Op.in]: transactionIds }
            },
            include: [
                {
                    model: Device,
                    include: [{
                        model: Category,
                        attributes: ['id', 'categoryName', 'cost', 'periode']
                    }],
                    attributes: ['id', 'name']
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
                        as: 'product',
                        attributes: ['id', 'name', 'description', 'price']
                    }],
                    required: false
                }
            ],
            order: [['createdAt', 'DESC']]
        });

        // Map transactions dengan payment info dan calculate products total
        const transactionsWithDetails = transactions.map(transaction => {
            const transactionData = transaction.toJSON();
            
            // Get payments for this transaction
            const transactionPayments = payments.filter(p => p.transactionId === transaction.id);
            
            // Calculate products total
            let productsTotal = 0;
            if (transactionData.transactionProducts && Array.isArray(transactionData.transactionProducts)) {
                productsTotal = transactionData.transactionProducts.reduce((sum, tp) => sum + (tp.subtotal || 0), 0);
            }
            
            // Calculate rental cost (total cost - products cost)
            const rentalCost = (transactionData.cost || 0) - productsTotal;
            
            return {
                ...transactionData,
                productsTotal,
                rentalCost,
                payments: transactionPayments.map(p => ({
                    amount: p.amount,
                    type: p.type,
                    paymentMethod: p.paymentMethod,
                    createdAt: p.createdAt
                }))
            };
        });

        // Calculate summary
        let pendapatanDevice = 0;
        let pendapatanCafe = 0;
        let totalPendapatan = 0;

        payments.forEach(payment => {
            totalPendapatan += payment.amount || 0;
            if (payment.type === 'RENTAL') {
                pendapatanDevice += payment.amount || 0;
            } else if (payment.type === 'FNB') {
                pendapatanCafe += payment.amount || 0;
            }
        });

        return res.status(200).json({
            message: 'Success',
            data: {
                shift: {
                    id: shift.id,
                    startTime: shift.startTime,
                    endTime: shift.endTime,
                    status: shift.status,
                    user: shift.user
                },
                transactions: transactionsWithDetails,
                summary: {
                    pendapatanDevice,
                    pendapatanCafe,
                    totalPendapatan,
                    transactionCount: transactions.length
                }
            }
        });
    } catch (error) {
        console.error('Error getting shift transactions:', error);
        return res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Helper: Buat payment record (digunakan oleh controller lain)
const createPaymentRecord = async ({ shiftId, userId, transactionId, amount, type, paymentMethod, note }) => {
    return await Payment.create({
        id: uuidv4(),
        shiftId,
        userId,
        transactionId,
        amount,
        type: type || 'RENTAL',
        paymentMethod: paymentMethod || 'CASH',
        note
    });
};

// Mendapatkan summary pendapatan per tanggal
const getIncomeSummaryByDate = async (req, res) => {
    try {
        const { page = 1, limit = 10, start_date, end_date } = req.query;

        const whereClause = {};

        if (start_date && end_date) {
            whereClause.startTime = {
                [Op.between]: [new Date(start_date), new Date(end_date + 'T23:59:59')]
            };
        }

        // Get all shifts with payments
        const shifts = await Shift.findAll({
            where: whereClause,
            include: [{
                model: User,
                as: 'user',
                attributes: ['id', 'username', 'email']
            }, {
                model: Payment,
                as: 'payments',
                attributes: ['amount', 'type', 'paymentMethod']
            }],
            order: [['startTime', 'DESC']]
        });

        // Group shifts by date and aggregate payments
        const dateMap = new Map();

        shifts.forEach(shift => {
            const shiftData = shift.toJSON();
            const dateKey = new Date(shiftData.startTime).toISOString().split('T')[0]; // YYYY-MM-DD

            if (!dateMap.has(dateKey)) {
                dateMap.set(dateKey, {
                    date: dateKey,
                    pendapatanDevice: 0,
                    pendapatanCafe: 0,
                    totalPendapatan: 0,
                    shiftCount: 0
                });
            }

            const dateSummary = dateMap.get(dateKey);
            dateSummary.shiftCount += 1;

            // Aggregate payments
            if (shiftData.payments && Array.isArray(shiftData.payments)) {
                shiftData.payments.forEach(payment => {
                    dateSummary.totalPendapatan += payment.amount || 0;
                    
                    if (payment.type === 'RENTAL') {
                        dateSummary.pendapatanDevice += payment.amount || 0;
                    } else if (payment.type === 'FNB') {
                        dateSummary.pendapatanCafe += payment.amount || 0;
                    }
                });
            }
        });

        // Convert map to array and sort by date descending
        const allDates = Array.from(dateMap.values()).sort((a, b) => 
            new Date(b.date).getTime() - new Date(a.date).getTime()
        );

        // Apply pagination
        const totalItems = allDates.length;
        const totalPages = Math.ceil(totalItems / limit);
        const offset = (page - 1) * limit;
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
        console.error('Error getting income summary by date:', error);
        return res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Mark shifts as withdrawn
const markShiftsAsWithdrawn = async (req, res) => {
    try {
        const { shiftIds } = req.body;

        if (!shiftIds || !Array.isArray(shiftIds) || shiftIds.length === 0) {
            return res.status(400).json({
                message: 'shiftIds harus berupa array yang tidak kosong'
            });
        }

        // Update all specified shifts to mark them as withdrawn
        const [updatedCount] = await Shift.update(
            { isWithdrawn: true },
            {
                where: {
                    id: { [Op.in]: shiftIds },
                    status: 'closed', // Only mark closed shifts
                    isWithdrawn: false // Only mark shifts that haven't been withdrawn yet
                }
            }
        );

        return res.status(200).json({
            message: `${updatedCount} shift berhasil ditandai sebagai sudah ditarik`,
            data: {
                updatedCount,
                shiftIds
            }
        });
    } catch (error) {
        console.error('Error marking shifts as withdrawn:', error);
        return res.status(500).json({
            message: 'Terjadi kesalahan saat menandai shift sebagai sudah ditarik',
            error: error.message
        });
    }
};

module.exports = {
    startShift,
    endShift,
    getShiftStatus,
    getShiftReport,
    getShiftHistory,
    getShiftTransactions,
    getIncomeSummaryByDate,
    markShiftsAsWithdrawn,
    getActiveShift,
    getAnyActiveShift,
    createPaymentRecord
};

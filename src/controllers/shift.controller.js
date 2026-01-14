// shift.controller.js
const { Shift, Payment, User, Transaction } = require("../models");
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
        const { page = 1, limit = 10, start_date, end_date } = req.query;

        const whereClause = {};

        if (start_date && end_date) {
            whereClause.startTime = {
                [Op.between]: [new Date(start_date), new Date(end_date)]
            };
        }

        const offset = (page - 1) * limit;

        const { count, rows: shifts } = await Shift.findAndCountAll({
            where: whereClause,
            include: [{
                model: User,
                as: 'user',
                attributes: ['id', 'username', 'email']
            }],
            order: [['startTime', 'DESC']],
            limit: parseInt(limit),
            offset: offset
        });

        const totalPages = Math.ceil(count / limit);

        return res.status(200).json({
            message: 'Success',
            data: {
                shifts,
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

module.exports = {
    startShift,
    endShift,
    getShiftStatus,
    getShiftReport,
    getShiftHistory,
    getActiveShift,
    getAnyActiveShift,
    createPaymentRecord
};

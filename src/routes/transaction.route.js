const express = require("express");
const router = express.Router();
const { 
    createTransaction,
    getAllTransactions,
    getTransactionById,
    getTransactionsByUserId,
    updateTransaction,
    deleteTransaction,
} = require("../controllers/transaction.controller");
const { tokenValidation, verifyAdmin } = require("../middlewares/auth.middleware");

// Create transaction (memerlukan auth)
router.post("/create", tokenValidation, createTransaction);

// Get all transactions (admin only)
router.get("/", tokenValidation,  getAllTransactions);

// Get transactions by user ID (memerlukan auth)
router.get("/user/:userId", tokenValidation, getTransactionsByUserId);

// Get transaction by ID (memerlukan auth)
router.get("/:id", tokenValidation, getTransactionById);

// Update transaction (admin only)
router.put("/:id", tokenValidation, updateTransaction);

// Delete transaction (admin only)
router.delete("/:id", tokenValidation,  deleteTransaction);



// Debug endpoint untuk melihat semua transaksi (temporary)
router.get("/debug/all", tokenValidation, async (req, res) => {
    try {
        const { Transaction, Device, Category } = require("../models");
        
        const transactions = await Transaction.findAll({
            include: [{
                model: Device,
                include: [{
                    model: Category
                }]
            }],
            order: [['createdAt', 'DESC']]
        });
        
        const simplifiedTransactions = transactions.map(t => ({
            id: t.id,
            deviceId: t.deviceId,
            start: t.start,
            end: t.end,
            duration: t.duration,
            cost: t.cost,
            createdAt: t.createdAt,
            device: {
                id: t.Device?.id,
                name: t.Device?.name,
                timerStatus: t.Device?.timerStatus,
                timerStart: t.Device?.timerStart,
                timerDuration: t.Device?.timerDuration,
                timerElapsed: t.Device?.timerElapsed,
                lastPausedAt: t.Device?.lastPausedAt
            }
        }));
        
        res.json({
            message: 'All transactions for debugging',
            count: transactions.length,
            data: simplifiedTransactions
        });
        
    } catch (error) {
        console.error('Debug error:', error);
        res.status(500).json({
            message: 'Error getting transactions',
            error: error.message
        });
    }
});



module.exports = router;
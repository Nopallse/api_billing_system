const express = require('express');
const router = express.Router();
const {
    createMemberTransaction,
    getAllMemberTransactions,
    getMemberTransactionById,
    getMemberTransactionsByMemberId,
    updateMemberTransaction,
    deleteMemberTransaction,
    addTimeToMemberTransaction,
    stopMemberTransaction,
    resumeMemberTransaction
} = require('../controllers/memberTransaction.controller');
const { tokenValidation } = require('../middlewares/auth.middleware');

// POST /api/member-transactions - Create new member transaction with PIN validation
router.post('/', tokenValidation, createMemberTransaction);

// GET /api/member-transactions - Get all member transactions with optional filters
router.get('/', tokenValidation, getAllMemberTransactions);

// GET /api/member-transactions/:id - Get member transaction by ID
router.get('/:id', tokenValidation, getMemberTransactionById);

// GET /api/member-transactions/member/:memberId - Get transactions by member ID
router.get('/member/:memberId', tokenValidation, getMemberTransactionsByMemberId);

// PUT /api/member-transactions/:id - Update member transaction
router.put('/:id', tokenValidation, updateMemberTransaction);

// DELETE /api/member-transactions/:id - Delete member transaction
router.delete('/:id', tokenValidation, deleteMemberTransaction);

// POST /api/member-transactions/add-time - Add time to active member transaction
router.post('/add-time', tokenValidation, addTimeToMemberTransaction);

// POST /api/member-transactions/stop - Stop/pause member transaction
router.post('/stop', tokenValidation, stopMemberTransaction);

// POST /api/member-transactions/resume - Resume member transaction
router.post('/resume', tokenValidation, resumeMemberTransaction);

module.exports = router;


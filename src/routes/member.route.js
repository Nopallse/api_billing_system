const express = require('express');
const router = express.Router();
const memberController = require('../controllers/member.controller');
const { tokenValidation } = require('../middlewares/auth.middleware');

// All routes are protected (require authentication)
router.use(tokenValidation);

// GET /api/members - Get all members with pagination and search
router.get('/', memberController.getAllMembers);

// GET /api/members/:id - Get member by ID
router.get('/:id', memberController.getMemberById);

// POST /api/members - Create new member
router.post('/', memberController.createMember);

// PUT /api/members/:id - Update member
router.put('/:id', memberController.updateMember);

// DELETE /api/members/:id - Delete member
router.delete('/:id', memberController.deleteMember);

// POST /api/members/:id/topup - Top up member deposit
router.post('/:id/topup', memberController.topUpDeposit);

// POST /api/members/:id/deduct - Deduct from member deposit
router.post('/:id/deduct', memberController.deductDeposit);

module.exports = router;

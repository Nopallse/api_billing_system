const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { tokenValidation, verifyAdmin } = require('../middlewares/auth.middleware');

// Apply auth middleware to all routes


// Get all users
router.get('/', tokenValidation, verifyAdmin,userController.getAllUsers);

// Get user by ID
router.get('/:userId', tokenValidation, verifyAdmin,userController.getUserById);

// Create new user
router.post('/', tokenValidation, verifyAdmin,  userController.createUser);

// Block/Unblock user
router.patch('/:userId/block', tokenValidation, verifyAdmin, userController.blockUser);

module.exports = router;

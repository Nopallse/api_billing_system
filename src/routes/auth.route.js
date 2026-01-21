const express = require('express');
const router = express.Router();

const { login, refreshToken, getProfile } = require('../controllers/auth.controller');
const { tokenValidation } = require('../middlewares/auth.middleware');

router.post('/login', login);
router.post('/refresh-token', refreshToken);
router.get('/profile', tokenValidation, getProfile);

module.exports = router;
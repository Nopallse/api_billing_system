const express = require('express');
const router = express.Router();
const { dashboard, adminDashboard } = require('../controllers/dashboard.controller');
const { tokenValidation, verifyAdmin } = require('../middlewares/auth.middleware');

router.get('/', dashboard);
router.get('/admin', tokenValidation, verifyAdmin, adminDashboard);

module.exports = router;
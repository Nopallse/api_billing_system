const express = require('express');
const router = express.Router();
const{ 
    createDevice, 
    getAllDevices, 
    getDeviceById, 
    updateDevice, 
    deleteDevice,
    sendDeviceCommand,
    addTime,
    syncDeviceActivities
} = require('../controllers/device.controller');

const{ tokenValidation, verifyAdmin} = require('../middlewares/auth.middleware');

// Basic CRUD routes
router.post('/create', tokenValidation, createDevice);
router.get('/', tokenValidation, getAllDevices);
router.get('/:id', tokenValidation, getDeviceById);
router.put('/update/:id', tokenValidation,  updateDevice);
router.delete('/delete/:id', tokenValidation, deleteDevice);

// Command routes
router.post('/:id/command', tokenValidation, sendDeviceCommand);

// Add time to device (memerlukan auth)
router.post('/:deviceId/add-time', tokenValidation, addTime);

// Sync offline activities (untuk handle offline scenario)
router.post('/:deviceId/sync-activities', tokenValidation, syncDeviceActivities);




module.exports = router;
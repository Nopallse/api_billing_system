const express = require("express");
const router = express.Router();
const { getConnectionStatus, isTimerActive, isTimerPaused, canResumeTimer } = require("../wsClient");
const { getUnregisteredDevices, getDisconnectedDevices } = require("../controllers/connection.controller");

// Get connection status
router.get("/status", (req, res) => {
    const status = getConnectionStatus();
    res.json(status);
});

// Get unregistered devices
router.get("/unregistered", getUnregisteredDevices);

// Get disconnected devices
router.get("/disconnected", getDisconnectedDevices);

// Get detailed timer status for all devices
router.get("/timer-status", (req, res) => {
    const status = getConnectionStatus();
    
    // Tambahkan informasi detail untuk setiap device
    const detailedDevices = status.devices.map(device => {
        return {
            ...device,
            isTimerActive: isTimerActive(device.deviceId),
            isTimerPaused: isTimerPaused(device.deviceId),
            canResume: canResumeTimer(device.deviceId)
        };
    });
    
    res.json({
        message: "Detailed timer status",
        data: {
            totalClients: status.totalClients,
            registeredDevices: status.registeredDevices,
            devices: detailedDevices
        }
    });
});

// Get detailed timer status for specific device
router.get("/device/:deviceId/timer-status", async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { Device } = require("../models");
        
        // Cek apakah device ada di database
        const device = await Device.findByPk(deviceId);
        if (!device) {
            return res.status(404).json({
                message: "Device tidak ditemukan"
            });
        }
        
        // Ambil status dari WebSocket
        const isConnected = getConnectionStatus().devices.some(d => d.deviceId === deviceId);
        const isTimerActiveStatus = isTimerActive(deviceId);
        const isTimerPausedStatus = isTimerPaused(deviceId);
        const canResumeStatus = canResumeTimer(deviceId);
        
        // Tentukan device status
        let deviceStatus = 'off';
        if (isTimerActiveStatus) {
            deviceStatus = 'on';
        } else if (isTimerPausedStatus) {
            deviceStatus = isConnected ? 'pause' : 'pause_disconnected';
        }
        
        // Ambil informasi WebSocket dari wsClient
        const wsClient = require("../wsClient");
        
        const response = {
            deviceId: deviceId,
            isConnected: isConnected,
            isTimerActive: isTimerActiveStatus,
            isTimerPaused: isTimerPausedStatus,
            canResume: canResumeStatus,
            deviceStatus: deviceStatus,
            databaseInfo: {
                timerStatus: device.timerStatus,
                timerStart: device.timerStart,
                timerDuration: device.timerDuration,
                timerElapsed: device.timerElapsed,
                lastPausedAt: device.lastPausedAt
            },
            websocketInfo: {
                inActiveTimers: wsClient.activeTimers.has(deviceId),
                inPausedDevices: wsClient.pausedDevices.has(deviceId),
                lastActivityTime: wsClient.lastActivityTime.get(deviceId) ? new Date(wsClient.lastActivityTime.get(deviceId)).toISOString() : null
            },
            message: getStatusMessage(deviceStatus, isTimerActiveStatus, isTimerPausedStatus, canResumeStatus)
        };
        
        res.json(response);
        
    } catch (error) {
        console.error('Timer status error:', error);
        res.status(500).json({
            message: 'Terjadi kesalahan saat mengecek status timer',
            error: error.message
        });
    }
});

// Helper function untuk generate status message
function getStatusMessage(deviceStatus, isTimerActive, isTimerPaused, canResume) {
    if (isTimerActive) {
        return "Device memiliki timer yang sedang aktif";
    } else if (isTimerPaused && canResume) {
        return "Device memiliki timer yang di-pause dan bisa di-resume";
    } else if (isTimerPaused && !canResume) {
        return "Device memiliki timer yang di-pause tapi tidak bisa di-resume";
    } else {
        return "Device tidak memiliki timer yang aktif";
    }
}



module.exports = router;
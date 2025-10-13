const wsClient = require('../wsClient');
const { Device } = require('../models');
//import Op from sequelize
const { Op } = require('sequelize');

const getConnectionStatus = (req, res) => {
    try {
        const status = wsClient.getConnectionStatus();
        
        // Tambahkan informasi tambahan untuk debugging
        console.log('🔌📊 Connection status requested');
        console.log('🔌📊 WebSocket server active:', !!wsClient.wss);
        console.log('🔌📊 Total WebSocket clients:', status.totalClients);
        console.log('🔌📊 Registered devices:', status.registeredDevices);
        console.log('🔌📊 Mobile clients:', status.mobileClients);
        console.log('🔌📊 Online users:', status.onlineUsers);
        
        res.status(200).json({
            ...status,
            timestamp: new Date().toISOString(),
            serverInfo: {
                nodeEnv: process.env.NODE_ENV || 'development',
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage()
            }
        });
    } catch (error) {
        console.error('🔌❌ Error getting connection status:', error);
        res.status(500).json({ message: 'Failed to get connection status', error: error.message });
    }
};

const getDisconnectedDevices = async (req, res) => {
    try {
        const connectedDevices = wsClient.getConnectionStatus().devices;
        const connectedIds = connectedDevices.map(device => device.deviceId);

        const devices = await Device.findAll({
            where: {
                id: {
                    [Op.notIn]: connectedIds
                }
            }
        });

        res.status(200).json({
            message: 'Berhasil mendapatkan daftar device yang tidak terkoneksi',
            data: devices
        });
    } catch (error) {
        console.error('Error getting unregistered devices:', error);
        res.status(500).json({ message: 'Failed to get unregistered devices', error: error.message });
    }
};

// sudah terhubung ke socket tapi belum terdaftar di database
const getUnregisteredDevices = async (req, res) => {
    try {
        // Ambil semua device yang terkoneksi ke WebSocket
        const connectedDevices = wsClient.getConnectionStatus().devices;
        const connectedIds = connectedDevices.map(device => device.deviceId);

        // Ambil semua device yang sudah terdaftar di database
        const registeredDevices = await Device.findAll();
        const registeredIds = registeredDevices.map(device => device.id);

        // Filter device yang terkoneksi tapi belum terdaftar
        const unregisteredDevices = connectedDevices.filter(device => 
            !registeredIds.includes(device.deviceId)
        );

        res.status(200).json({
            message: 'Berhasil mendapatkan daftar device yang terkoneksi tapi belum terdaftar',
            data: unregisteredDevices
        });
    } catch (error) {
        console.error('Error getting unregistered devices:', error);
        res.status(500).json({ message: 'Failed to get unregistered devices', error: error.message });
    }
};

// Endpoint untuk mobile client mendapatkan notifikasi real-time
const getMobileNotifications = (req, res) => {
    try {
        // Set headers untuk SSE (Server-Sent Events)
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Cache-Control'
        });

        // Send initial connection message
        res.write(`data: ${JSON.stringify({
            type: 'connection_established',
            timestamp: new Date().toISOString()
        })}\n\n`);

        // Store response object for later use
        const clientId = Date.now();
        wsClient.addMobileClient(clientId, res);

        // Handle client disconnect
        req.on('close', () => {
            wsClient.removeMobileClient(clientId);
            console.log(`Mobile client ${clientId} disconnected`);
        });

    } catch (error) {
        console.error('Error setting up mobile notifications:', error);
        res.status(500).json({ message: 'Failed to setup notifications', error: error.message });
    }
};

module.exports = {
    getConnectionStatus,
    getUnregisteredDevices,
    getDisconnectedDevices,
    getMobileNotifications
};
// server.js
const express = require('express');
const http = require('http'); // ⭐ PENTING: Import http
const bodyParser = require('body-parser');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');
const cors = require('cors');

//good
// Import routes
const authRoutes = require('./routes/auth.route');
const categoryRoutes = require('./routes/category.route');
const transactionRoutes = require("./routes/transaction.route");
const deviceRoutes = require("./routes/device.route");
const connectionRoutes = require('./routes/connection.route');
const dashboardRoutes = require('./routes/dashboard.route');
const userRoutes = require('./routes/user.route');
const memberRoutes = require('./routes/member.route');
const memberTransactionRoutes = require('./routes/memberTransaction.route');
const shiftRoutes = require('./routes/shift.route');

// Import WebSocket functions - DISABLED (Relay control via BLE)
// const { initWebSocketServer, sendToESP32, getConnectionStatus } = require('./wsClient');

// Load Swagger YAML file
const swaggerDocument = YAML.load(path.join(__dirname, '../swagger.yaml'));

// Create Express app
const app = express();

// Middleware
//
//allow all origin
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
// app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/category', categoryRoutes);
app.use('/api/device', deviceRoutes);
app.use('/api/transaction', transactionRoutes);
app.use('/api/connection', connectionRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/user', userRoutes);
app.use('/api/member', memberRoutes);
app.use('/api/member-transactions', memberTransactionRoutes);
app.use('/api/shift', shiftRoutes);

// ⭐ LANGKAH PENTING: Buat HTTP Server dari Express app
const server = http.createServer(app);

// ⭐ SEKARANG: WebSocket DISABLED - Relay control via BLE langsung dari mobile
// initWebSocketServer(server);

// ⭐ TERAKHIR: Listen menggunakan HTTP server (bukan app.listen)
const PORT = process.env.PORT;
server.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    console.log(`📚 API Documentation: http://localhost:${PORT}/api-docs`);
    console.log(`🔌 WebSocket DISABLED - Relay control via BLE`);
    console.log(`📱 Mobile app controls relay directly via Bluetooth`);
});

// Export untuk testing atau penggunaan lain
module.exports = { app, server };